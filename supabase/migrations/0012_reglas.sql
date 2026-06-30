-- Mamones con Mamones — Lote 12: ajustes de reglas (timeouts, piensa rápido, meta).

-- ---------------------------------------------------------------------------
-- Columnas nuevas
-- ---------------------------------------------------------------------------
alter table public.salas add column if not exists ronda_inicio timestamptz;   -- inicio de la fase "jugando"
alter table public.salas add column if not exists penalizado_uid uuid;        -- ex-juez que pierde el próximo envío

-- ---------------------------------------------------------------------------
-- Trigger: además del deadline, marca el inicio de la ronda de juego.
-- ---------------------------------------------------------------------------
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
    if NEW.fase = 'jugando' then NEW.ronda_inicio := now(); end if;
  end if;
  return NEW;
end $$;

-- ---------------------------------------------------------------------------
-- Meta efectiva: config.meta si está, si no la tabla por nº de jugadores.
-- ---------------------------------------------------------------------------
create or replace function public.meta_ganar(p_sala uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(s.config->>'meta', '')::int,
    cartas_para_ganar((select count(*) from jugadores_sala j where j.sala_id = s.id))
  )
  from salas s where s.id = p_sala;
$$;

-- ---------------------------------------------------------------------------
-- Config de sala (ahora con meta). Reemplaza la versión de 3 args.
-- ---------------------------------------------------------------------------
drop function if exists public.set_config_sala(uuid, text, boolean);

create or replace function public.set_config_sala(p_sala uuid, p_modo text, p_piensa boolean, p_meta int)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_sala salas; v_n int; v_piensa boolean;
begin
  select * into v_sala from salas where id = p_sala;
  if not found then raise exception 'Sala no existe'; end if;
  if v_sala.host_uid <> v_uid then raise exception 'Solo el host configura la sala'; end if;
  if v_sala.fase <> 'lobby' then raise exception 'La partida ya empezó'; end if;
  if p_modo not in ('clasica', 'amarga') then raise exception 'Modo inválido'; end if;
  if p_meta is not null and (p_meta < 1 or p_meta > 20) then raise exception 'Meta fuera de rango'; end if;

  -- Piensa Rápido solo con más de 5 jugadores
  select count(*) into v_n from jugadores_sala where sala_id = p_sala;
  v_piensa := coalesce(p_piensa, false) and v_n > 5;

  update salas set config = jsonb_build_object(
    'modo', p_modo,
    'piensaRapido', v_piensa,
    'meta', p_meta
  ) where id = p_sala;
end $$;

grant execute on function public.set_config_sala(uuid, text, boolean, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Iniciar partida: clampa Piensa Rápido si hay <=5 jugadores.
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
  update salas set mazo_verde = '[]'::jsonb, ronda = 0, penalizado_uid = null where id = p_sala;
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

-- ---------------------------------------------------------------------------
-- elegir_ganadora: usa la meta efectiva.
-- ---------------------------------------------------------------------------
create or replace function public.elegir_ganadora(p_sala uuid, p_mesa_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_sala salas; v_ganador uuid; v_pts int; v_amarga boolean;
begin
  select * into v_sala from salas where id = p_sala;
  if v_sala.fase <> 'juzgando' then raise exception 'No es momento de juzgar'; end if;
  if v_sala.juez_uid <> v_uid then raise exception 'Solo el Juez elige'; end if;
  v_amarga := (v_sala.config->>'modo') = 'amarga';
  if v_amarga and v_sala.mejor_mesa_id is not null then raise exception 'Ahora elige la PEOR carta'; end if;

  select jugador_uid into v_ganador from mesa_juego where id = p_mesa_id and sala_id = p_sala and ronda = v_sala.ronda;
  if v_ganador is null then raise exception 'Jugada inválida'; end if;

  update mesa_juego set es_ganadora = true where id = p_mesa_id;
  update jugadores_sala set puntos = puntos + 1 where sala_id = p_sala and uid = v_ganador returning puntos into v_pts;

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
-- cerrar_jugadas: Piensa Rápido solo penaliza si la ronda tardó >= 5s.
-- ---------------------------------------------------------------------------
create or replace function public.cerrar_jugadas(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sala salas; v_last uuid; v_jugadores int; v_max timestamptz;
begin
  select * into v_sala from salas where id = p_sala;

  if coalesce((v_sala.config->>'piensaRapido')::boolean, false) then
    select count(distinct jugador_uid), max(jugada_en) into v_jugadores, v_max
      from mesa_juego where sala_id = p_sala and ronda = v_sala.ronda;
    if v_jugadores >= 2
       and v_sala.ronda_inicio is not null
       and (v_max - v_sala.ronda_inicio) >= interval '5 seconds' then
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

-- ---------------------------------------------------------------------------
-- avanzar_ronda: aplica también la penalización del ex-juez (pierde su envío).
-- ---------------------------------------------------------------------------
create or replace function public.avanzar_ronda(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sala salas; v_next uuid; v_verde text; r record;
begin
  select * into v_sala from salas where id = p_sala;
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

  -- El ex-juez que se demoró pierde el envío esta ronda.
  if v_sala.penalizado_uid is not null and v_sala.penalizado_uid <> v_next then
    update jugadores_sala set cartas_a_jugar = 0, efecto_ronda = 'sin_turno'
      where sala_id = p_sala and uid = v_sala.penalizado_uid;
  end if;

  for r in select uid from jugadores_sala where sala_id = p_sala loop
    perform repartir_mano(p_sala, r.uid);
  end loop;

  v_verde := nueva_verde(p_sala);
  update salas set fase = 'jugando', ronda = ronda + 1, juez_uid = v_next, carta_verde = v_verde,
                   mejor_mesa_id = null, peor_uid = null, ruleta_efecto = null, penalizado_uid = null
  where id = p_sala;
end $$;

-- ---------------------------------------------------------------------------
-- resolver_timeout: nuevas reglas de vencimiento.
-- ---------------------------------------------------------------------------
create or replace function public.resolver_timeout(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sala salas; v_played int; v_mesa_id uuid; v_ganador uuid; v_pts int;
begin
  select * into v_sala from salas where id = p_sala for update;
  if v_sala.fase_hasta is null or now() < v_sala.fase_hasta then return; end if;

  if v_sala.fase = 'jugando' then
    -- Los que no enviaron pierden el chance (NO se auto-juega).
    select count(*) into v_played from mesa_juego where sala_id = p_sala and ronda = v_sala.ronda;
    if v_played = 0 then
      perform avanzar_ronda(p_sala);                       -- nadie jugó: saltar ronda
    elsif v_played = 1 then
      select id, jugador_uid into v_mesa_id, v_ganador
        from mesa_juego where sala_id = p_sala and ronda = v_sala.ronda;
      update mesa_juego set es_ganadora = true where id = v_mesa_id;
      update jugadores_sala set puntos = puntos + 1 where sala_id = p_sala and uid = v_ganador returning puntos into v_pts;
      if v_pts >= meta_ganar(p_sala) then
        update salas set fase = 'terminado' where id = p_sala;
      else
        update salas set fase = 'resultado' where id = p_sala;
      end if;
    else
      update salas set fase = 'juzgando', mejor_mesa_id = null where id = p_sala;  -- el Juez elige entre las enviadas
    end if;

  elsif v_sala.fase = 'juzgando' then
    -- El Juez se demoró: saltar ronda, rotar Juez y penalizar al ex-juez.
    update salas set penalizado_uid = v_sala.juez_uid where id = p_sala;
    perform avanzar_ronda(p_sala);

  elsif v_sala.fase = 'resultado' then
    perform avanzar_ronda(p_sala);
  end if;
end $$;

grant execute on function public.resolver_timeout(uuid) to authenticated;
