-- Mamones con Mamones — Lote 14: evita "record v_sala has no field ..." al leer
-- columnas nuevas del rowtype cacheado (pgbouncer). Se leen como escalares.

create or replace function public.cerrar_jugadas(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sala salas; v_last uuid; v_jugadores int; v_max timestamptz; v_inicio timestamptz; v_piensa boolean;
begin
  select * into v_sala from salas where id = p_sala;
  -- columnas nuevas como escalares (no como campo del record cacheado)
  select coalesce((config->>'piensaRapido')::boolean, false), ronda_inicio
    into v_piensa, v_inicio from salas where id = p_sala;

  if v_piensa then
    select count(distinct jugador_uid), max(jugada_en) into v_jugadores, v_max
      from mesa_juego where sala_id = p_sala and ronda = v_sala.ronda;
    if v_jugadores >= 2 and v_inicio is not null and (v_max - v_inicio) >= interval '5 seconds' then
      select jugador_uid into v_last from mesa_juego
        where sala_id = p_sala and ronda = v_sala.ronda order by jugada_en desc limit 1;
      insert into cartas_mano (sala_id, uid, carta)
        select sala_id, jugador_uid, carta from mesa_juego
        where sala_id = p_sala and ronda = v_sala.ronda and jugador_uid = v_last;
      delete from mesa_juego where sala_id = p_sala and ronda = v_sala.ronda and jugador_uid = v_last;
    end if;
  end if;

  update salas set fase = 'juzgando', mejor_mesa_id = null where id = p_sala;
end $$;

create or replace function public.avanzar_ronda(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sala salas; v_next uuid; v_verde text; v_penal uuid; r record;
begin
  select * into v_sala from salas where id = p_sala;
  select penalizado_uid into v_penal from salas where id = p_sala;  -- escalar

  delete from mesa_juego where sala_id = p_sala;
  update jugadores_sala set efecto_ronda = null, congelado_hasta = null, cartas_a_jugar = 1
    where sala_id = p_sala;

  select uid into v_next from jugadores_sala
   where sala_id = p_sala and conectado
     and orden > (select orden from jugadores_sala where sala_id = p_sala and uid = v_sala.juez_uid)
   order by orden limit 1;
  if v_next is null then
    select uid into v_next from jugadores_sala where sala_id = p_sala and conectado order by orden limit 1;
  end if;
  if v_next is null then v_next := v_sala.juez_uid; end if;

  for r in select uid, efecto_activo from jugadores_sala where sala_id = p_sala and efecto_activo is not null loop
    if r.uid = v_next then
      update jugadores_sala set efecto_activo = null where sala_id = p_sala and uid = r.uid;
    else
      update jugadores_sala set
        efecto_ronda = r.efecto_activo, efecto_activo = null,
        cartas_a_jugar = case when r.efecto_activo = 'jugada_doble' then 2 else 1 end,
        congelado_hasta = case when r.efecto_activo = 'mano_congelada' then now() + interval '10 seconds' else null end
      where sala_id = p_sala and uid = r.uid;
    end if;
  end loop;

  if v_penal is not null and v_penal <> v_next then
    update jugadores_sala set cartas_a_jugar = 0, efecto_ronda = 'sin_turno'
      where sala_id = p_sala and uid = v_penal;
  end if;

  for r in select uid from jugadores_sala where sala_id = p_sala loop
    perform repartir_mano(p_sala, r.uid);
  end loop;

  v_verde := nueva_verde(p_sala);
  update salas set fase = 'jugando', ronda = ronda + 1, juez_uid = v_next, carta_verde = v_verde,
                   mejor_mesa_id = null, peor_uid = null, ruleta_efecto = null, penalizado_uid = null,
                   fase_hasta = now() + interval '60 seconds', ronda_inicio = now()
  where id = p_sala;
end $$;
