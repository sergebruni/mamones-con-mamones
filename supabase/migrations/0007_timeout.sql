-- Mamones con Mamones — Lote 7: reloj por fase + resolución automática (timeout).

-- Fecha límite de la fase actual (la setea un trigger al cambiar de fase).
alter table public.salas add column if not exists fase_hasta timestamptz;

-- Trigger: al cambiar de fase, fija el deadline según la fase.
create or replace function public.tg_salas_fase_hasta()
returns trigger language plpgsql as $$
begin
  if NEW.fase is distinct from OLD.fase then
    NEW.fase_hasta := case NEW.fase
      when 'jugando' then now() + interval '60 seconds'
      when 'juzgando' then now() + interval '45 seconds'
      when 'resultado' then now() + interval '25 seconds'
      else null
    end;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_salas_fase_hasta on public.salas;
create trigger trg_salas_fase_hasta
  before update on public.salas
  for each row execute function public.tg_salas_fase_hasta();

-- Avanzar de ronda (lógica interna, sin checks de permiso): repone manos,
-- rota el Juez (prefiere conectados) y saca nueva carta verde.
create or replace function public.avanzar_ronda(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sala salas; v_next uuid; v_verde text; r record;
begin
  select * into v_sala from salas where id = p_sala;
  delete from mesa_juego where sala_id = p_sala;
  for r in select uid from jugadores_sala where sala_id = p_sala loop
    perform repartir_mano(p_sala, r.uid);
  end loop;

  select uid into v_next from jugadores_sala
   where sala_id = p_sala and conectado
     and orden > (select orden from jugadores_sala where sala_id = p_sala and uid = v_sala.juez_uid)
   order by orden limit 1;
  if v_next is null then
    select uid into v_next from jugadores_sala where sala_id = p_sala and conectado order by orden limit 1;
  end if;
  if v_next is null then v_next := v_sala.juez_uid; end if;

  v_verde := nueva_verde(p_sala);
  update salas set fase = 'jugando', ronda = ronda + 1, juez_uid = v_next, carta_verde = v_verde
  where id = p_sala;
end $$;

-- siguiente_ronda ahora delega en avanzar_ronda (tras validar permisos).
create or replace function public.siguiente_ronda(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_sala salas;
begin
  select * into v_sala from salas where id = p_sala;
  if v_sala.fase <> 'resultado' then raise exception 'Aún no termina la ronda'; end if;
  if v_uid <> v_sala.host_uid and v_uid <> v_sala.juez_uid
    then raise exception 'Solo el host o el Juez avanzan'; end if;
  perform avanzar_ronda(p_sala);
end $$;

grant execute on function public.siguiente_ronda(uuid) to authenticated;

-- Resuelve el timeout de la fase actual (cualquier cliente lo invoca al vencer).
-- Re-valida now() >= fase_hasta, así no se puede forzar antes de tiempo.
create or replace function public.resolver_timeout(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sala salas; r record; v_card text; v_mesa_id uuid; v_ganador uuid; v_pts int; v_n int;
begin
  select * into v_sala from salas where id = p_sala for update;  -- evita doble resolución
  if v_sala.fase_hasta is null or now() < v_sala.fase_hasta then return; end if;

  if v_sala.fase = 'jugando' then
    -- Auto-jugar una carta al azar por cada activo no-Juez que no jugó.
    for r in
      select j.uid from jugadores_sala j
      where j.sala_id = p_sala and j.conectado and j.uid <> v_sala.juez_uid
        and not exists (
          select 1 from mesa_juego m
          where m.sala_id = p_sala and m.ronda = v_sala.ronda and m.jugador_uid = j.uid
        )
    loop
      select carta into v_card from cartas_mano where sala_id = p_sala and uid = r.uid order by random() limit 1;
      if v_card is not null then
        delete from cartas_mano where sala_id = p_sala and uid = r.uid and carta = v_card;
        insert into mesa_juego (sala_id, ronda, jugador_uid, carta)
        values (p_sala, v_sala.ronda, r.uid, v_card);
      end if;
    end loop;

    if exists (select 1 from mesa_juego where sala_id = p_sala and ronda = v_sala.ronda) then
      update salas set fase = 'juzgando' where id = p_sala;
    else
      update salas set fase_hasta = now() + interval '30 seconds' where id = p_sala; -- nadie pudo jugar
    end if;

  elsif v_sala.fase = 'juzgando' then
    -- Juez AFK: gana una carta al azar.
    select id into v_mesa_id from mesa_juego where sala_id = p_sala and ronda = v_sala.ronda order by random() limit 1;
    if v_mesa_id is not null then
      update mesa_juego set es_ganadora = true where id = v_mesa_id;
      select jugador_uid into v_ganador from mesa_juego where id = v_mesa_id;
      update jugadores_sala set puntos = puntos + 1 where sala_id = p_sala and uid = v_ganador
        returning puntos into v_pts;
      select count(*) into v_n from jugadores_sala where sala_id = p_sala;
      if v_pts >= cartas_para_ganar(v_n) then
        update salas set fase = 'terminado' where id = p_sala;
      else
        update salas set fase = 'resultado' where id = p_sala;
      end if;
    end if;

  elsif v_sala.fase = 'resultado' then
    perform avanzar_ronda(p_sala);
  end if;
end $$;

grant execute on function public.resolver_timeout(uuid) to authenticated;
