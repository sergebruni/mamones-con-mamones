-- Mamones con Mamones — Lote 19: historial de la partida para el recap final.
-- Guarda una entrada por ronda decidida (verde, roja ganadora, ganador) en
-- salas.historial. El cliente lo lee al terminar para mostrar el recap.
-- Idempotente: recrea a su versión final las funciones que deciden ganador y
-- las que empiezan/reinician partida (para resetear el historial).

-- Historial acumulado de la partida (una entrada por ronda ganada).
alter table public.salas add column if not exists historial jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- Dependencias de la meta (re-aseguradas aquí para que 0019 sea autosuficiente:
-- elegir_ganadora y resolver_timeout llaman meta_ganar, y algunas BD nunca
-- corrieron la 0012 que la define). cartas_para_ganar es de la 0003.
-- ---------------------------------------------------------------------------
create or replace function public.cartas_para_ganar(n int)
returns int language sql immutable as $$
  select case
    when n >= 8 then 4
    when n = 7 then 5
    when n = 6 then 6
    when n = 5 then 7
    else 8            -- 4 jugadores (mínimo)
  end;
$$;

-- Meta efectiva de la sala: config.meta si está fijada, si no la automática.
create or replace function public.meta_ganar(p_sala uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(s.config->>'meta', '')::int,
    cartas_para_ganar((select count(*) from jugadores_sala j where j.sala_id = s.id))
  )
  from salas s where s.id = p_sala;
$$;

grant execute on function public.meta_ganar(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- elegir_ganadora: además de sumar el punto, anexa la ronda al historial.
-- (Base: 0012 + el append.)
-- ---------------------------------------------------------------------------
create or replace function public.elegir_ganadora(p_sala uuid, p_mesa_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_sala salas; v_ganador uuid; v_pts int; v_amarga boolean;
        v_carta text; v_nombre text;
begin
  select * into v_sala from salas where id = p_sala;
  if v_sala.fase <> 'juzgando' then raise exception 'No es momento de juzgar'; end if;
  if v_sala.juez_uid <> v_uid then raise exception 'Solo el Juez elige'; end if;
  v_amarga := (v_sala.config->>'modo') = 'amarga';
  if v_amarga and v_sala.mejor_mesa_id is not null then raise exception 'Ahora elige la PEOR carta'; end if;

  select jugador_uid, carta into v_ganador, v_carta
    from mesa_juego where id = p_mesa_id and sala_id = p_sala and ronda = v_sala.ronda;
  if v_ganador is null then raise exception 'Jugada inválida'; end if;

  update mesa_juego set es_ganadora = true where id = p_mesa_id;
  update jugadores_sala set puntos = puntos + 1 where sala_id = p_sala and uid = v_ganador returning puntos into v_pts;

  select nombre into v_nombre from jugadores_sala where sala_id = p_sala and uid = v_ganador;
  update salas set historial = coalesce(historial, '[]'::jsonb) || jsonb_build_object(
    'ronda', v_sala.ronda, 'verde', v_sala.carta_verde, 'roja', v_carta,
    'ganador_uid', v_ganador, 'ganador', v_nombre
  ) where id = p_sala;

  if v_pts >= meta_ganar(p_sala) then
    update salas set fase = 'terminado' where id = p_sala;
  elsif v_amarga then
    update salas set mejor_mesa_id = p_mesa_id where id = p_sala;
  else
    update salas set fase = 'resultado' where id = p_sala;
  end if;
end $$;

grant execute on function public.elegir_ganadora(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- resolver_timeout: cuando el timeout de 'jugando' deja una sola carta (gana
-- sola), también anexa la ronda al historial. (Base: 0016 + el append.)
-- ---------------------------------------------------------------------------
create or replace function public.resolver_timeout(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_fase fase_sala; v_hasta timestamptz; v_ronda int; v_juez uuid;
        v_played int; v_mesa_id uuid; v_ganador uuid; v_pts int;
        v_carta text; v_verde text; v_nombre text;
begin
  select fase, fase_hasta, ronda, juez_uid, carta_verde
    into v_fase, v_hasta, v_ronda, v_juez, v_verde
    from salas where id = p_sala for update;
  if v_hasta is null or now() < v_hasta then return; end if;

  if v_fase = 'jugando' then
    select count(*) into v_played from mesa_juego where sala_id = p_sala and ronda = v_ronda;
    if v_played = 0 then
      perform avanzar_ronda(p_sala);
    elsif v_played = 1 then
      select id, jugador_uid, carta into v_mesa_id, v_ganador, v_carta
        from mesa_juego where sala_id = p_sala and ronda = v_ronda;
      update mesa_juego set es_ganadora = true where id = v_mesa_id;
      update jugadores_sala set puntos = puntos + 1 where sala_id = p_sala and uid = v_ganador returning puntos into v_pts;
      select nombre into v_nombre from jugadores_sala where sala_id = p_sala and uid = v_ganador;
      update salas set historial = coalesce(historial, '[]'::jsonb) || jsonb_build_object(
        'ronda', v_ronda, 'verde', v_verde, 'roja', v_carta,
        'ganador_uid', v_ganador, 'ganador', v_nombre
      ) where id = p_sala;
      if v_pts >= meta_ganar(p_sala) then update salas set fase = 'terminado' where id = p_sala;
      else update salas set fase = 'resultado' where id = p_sala; end if;
    else
      update salas set fase = 'juzgando', mejor_mesa_id = null where id = p_sala;
    end if;
  elsif v_fase = 'juzgando' then
    update salas set penalizado_uid = v_juez where id = p_sala;
    perform avanzar_ronda(p_sala);
  elsif v_fase = 'resultado' then
    perform avanzar_ronda(p_sala);
  end if;
end $$;

grant execute on function public.resolver_timeout(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- iniciar_partida / reiniciar_partida: resetear también el historial.
-- (Base: 0018 + el reset de historial.)
-- ---------------------------------------------------------------------------
create or replace function public.iniciar_partida(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_sala salas; v_n int; v_juez uuid; v_verde text; r record;
begin
  select * into v_sala from salas where id = p_sala;
  if not found then raise exception 'Sala no existe'; end if;
  if v_sala.host_uid <> v_uid then raise exception 'Solo el host puede iniciar'; end if;
  if v_sala.fase <> 'lobby' then raise exception 'La partida ya empezó'; end if;

  select count(*) into v_n from jugadores_sala where sala_id = p_sala;
  if v_n < 4 then raise exception 'Se necesitan al menos 4 jugadores (hay %)', v_n; end if;
  if v_n <= 5 then
    update salas set config = jsonb_set(config, '{piensaRapido}', 'false'::jsonb) where id = p_sala;
  end if;

  delete from cartas_mano where sala_id = p_sala;
  delete from mesa_juego where sala_id = p_sala;
  update salas set mazo_verde = '[]'::jsonb, mazo_rojo = '[]'::jsonb, historial = '[]'::jsonb,
                   ronda = 0, penalizado_uid = null
    where id = p_sala;
  update jugadores_sala set efecto_activo = null, efecto_ronda = null, congelado_hasta = null, cartas_a_jugar = 1
    where sala_id = p_sala;

  for r in select uid from jugadores_sala where sala_id = p_sala loop
    perform repartir_mano(p_sala, r.uid);
  end loop;

  select uid into v_juez from jugadores_sala where sala_id = p_sala order by random() limit 1;
  v_verde := nueva_verde(p_sala);

  update salas set fase = 'jugando', ronda = 1, juez_uid = v_juez, carta_verde = v_verde,
                   mejor_mesa_id = null, peor_uid = null, ruleta_efecto = null
  where id = p_sala;
end $$;

grant execute on function public.iniciar_partida(uuid) to authenticated;

create or replace function public.reiniciar_partida(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_sala salas;
begin
  select * into v_sala from salas where id = p_sala;
  if not found then raise exception 'Sala no existe'; end if;
  if v_sala.host_uid <> v_uid then raise exception 'Solo el host reinicia'; end if;

  delete from cartas_mano where sala_id = p_sala;
  delete from mesa_juego where sala_id = p_sala;
  update jugadores_sala set puntos = 0 where sala_id = p_sala;
  update salas set fase = 'lobby', ronda = 0, juez_uid = null,
                   carta_verde = null, mazo_verde = '[]'::jsonb, mazo_rojo = '[]'::jsonb,
                   historial = '[]'::jsonb
  where id = p_sala;
end $$;

grant execute on function public.reiniciar_partida(uuid) to authenticated;

notify pgrst, 'reload schema';
