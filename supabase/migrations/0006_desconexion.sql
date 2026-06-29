-- Mamones con Mamones — Lote 6: manejo de desconexión y abandono.

-- Repara el estado de la sala según quién está CONECTADO (jugadores_sala.conectado):
--  1) migra el host si se fue;  2) si quedan <2 activos, pausa a 'lobby';
--  3) reasigna el Juez si se desconectó (devolviéndole su carta si había jugado);
--  4) si ya jugaron todos los activos no-Juez, pasa a 'juzgando' (desbloquea).
create or replace function public.reparar_sala(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sala salas; v_activos int; v_new uuid; v_no_juez int; v_jugaron int; r record;
begin
  select * into v_sala from salas where id = p_sala;
  if not found then return; end if;

  -- 1) Host: si ya no está conectado, promover al activo de menor 'orden'.
  if not exists (select 1 from jugadores_sala where sala_id = p_sala and uid = v_sala.host_uid and conectado) then
    select uid into v_new from jugadores_sala where sala_id = p_sala and conectado order by orden limit 1;
    if v_new is not null then
      update salas set host_uid = v_new where id = p_sala;
      v_sala.host_uid := v_new;
    end if;
  end if;

  select count(*) into v_activos from jugadores_sala where sala_id = p_sala and conectado;
  if v_activos = 0 then return; end if;

  if v_sala.fase in ('jugando', 'juzgando') then
    -- 2) Muy pocos para jugar: pausar a lobby (se conservan los puntos).
    if v_activos < 2 then
      update salas set fase = 'lobby', ronda = 0, juez_uid = null, carta_verde = null where id = p_sala;
      return;
    end if;

    -- 3) Juez desconectado: reasignar al activo de menor 'orden'.
    if not exists (select 1 from jugadores_sala where sala_id = p_sala and uid = v_sala.juez_uid and conectado) then
      select uid into v_new from jugadores_sala where sala_id = p_sala and conectado order by orden limit 1;
      -- el Juez no compite: si ya había jugado, devolvemos su carta a la mano.
      for r in select carta from mesa_juego where sala_id = p_sala and ronda = v_sala.ronda and jugador_uid = v_new loop
        insert into cartas_mano (sala_id, uid, carta) values (p_sala, v_new, r.carta);
      end loop;
      delete from mesa_juego where sala_id = p_sala and ronda = v_sala.ronda and jugador_uid = v_new;
      update salas set juez_uid = v_new where id = p_sala;
      v_sala.juez_uid := v_new;
    end if;

    -- 4) Desbloquear: si ya jugaron todos los activos que no son Juez.
    if v_sala.fase = 'jugando' then
      select count(*) into v_no_juez from jugadores_sala
        where sala_id = p_sala and conectado and uid <> v_sala.juez_uid;
      select count(*) into v_jugaron from mesa_juego where sala_id = p_sala and ronda = v_sala.ronda;
      if v_no_juez > 0 and v_jugaron >= v_no_juez then
        update salas set fase = 'juzgando' where id = p_sala;
      end if;
    end if;
  end if;
end $$;

-- Reporta la lista de conectados (la manda un cliente desde Presence) y repara.
create or replace function public.marcar_conectados(p_sala uuid, p_conectados uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from jugadores_sala where sala_id = p_sala and uid = auth.uid()) then
    raise exception 'No estás en la sala';
  end if;
  update jugadores_sala set conectado = (uid = any (p_conectados)) where sala_id = p_sala;
  perform reparar_sala(p_sala);
end $$;

grant execute on function public.marcar_conectados(uuid, uuid[]) to authenticated;

-- Abandono explícito: el jugador se va y se limpia su rastro; luego se repara.
create or replace function public.abandonar_sala(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_ronda int;
begin
  select ronda into v_ronda from salas where id = p_sala;
  delete from cartas_mano where sala_id = p_sala and uid = v_uid;
  delete from mesa_juego where sala_id = p_sala and ronda = v_ronda and jugador_uid = v_uid;
  delete from jugadores_sala where sala_id = p_sala and uid = v_uid;

  -- Si la sala quedó vacía, se elimina (cascade limpia lo demás).
  if not exists (select 1 from jugadores_sala where sala_id = p_sala) then
    delete from salas where id = p_sala;
    return;
  end if;
  perform reparar_sala(p_sala);
end $$;

grant execute on function public.abandonar_sala(uuid) to authenticated;
