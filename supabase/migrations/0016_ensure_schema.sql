-- Mamones con Mamones — Lote 16: re-asegura el esquema completo (idempotente) y
-- recrea las funciones del ciclo de ronda a su versión final. Correr este solo
-- deja todo consistente aunque alguna migración previa no se haya aplicado.

-- ---------------------------------------------------------------------------
-- Columnas (todas con IF NOT EXISTS: no rompen si ya están)
-- ---------------------------------------------------------------------------
alter table public.salas add column if not exists fase_hasta timestamptz;
alter table public.salas add column if not exists ronda_inicio timestamptz;
alter table public.salas add column if not exists penalizado_uid uuid;
alter table public.salas add column if not exists mejor_mesa_id uuid;
alter table public.salas add column if not exists peor_uid uuid;
alter table public.salas add column if not exists ruleta_efecto int;

alter table public.jugadores_sala add column if not exists efecto_activo text;
alter table public.jugadores_sala add column if not exists efecto_ronda text;
alter table public.jugadores_sala add column if not exists congelado_hasta timestamptz;
alter table public.jugadores_sala add column if not exists cartas_a_jugar int not null default 1;

alter table public.mesa_juego add column if not exists jugada_en timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- Trigger del deadline / inicio de ronda
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

drop trigger if exists trg_salas_fase_hasta on public.salas;
create trigger trg_salas_fase_hasta
  before update on public.salas
  for each row execute function public.tg_salas_fase_hasta();

-- ---------------------------------------------------------------------------
-- cerrar_jugadas (escalares)
-- ---------------------------------------------------------------------------
create or replace function public.cerrar_jugadas(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_ronda int; v_last uuid; v_jugadores int; v_max timestamptz; v_inicio timestamptz; v_piensa boolean;
begin
  select ronda, ronda_inicio, coalesce((config->>'piensaRapido')::boolean, false)
    into v_ronda, v_inicio, v_piensa from salas where id = p_sala;

  if v_piensa then
    select count(distinct jugador_uid), max(jugada_en) into v_jugadores, v_max
      from mesa_juego where sala_id = p_sala and ronda = v_ronda;
    if v_jugadores >= 2 and v_inicio is not null and (v_max - v_inicio) >= interval '5 seconds' then
      select jugador_uid into v_last from mesa_juego
        where sala_id = p_sala and ronda = v_ronda order by jugada_en desc limit 1;
      insert into cartas_mano (sala_id, uid, carta)
        select sala_id, jugador_uid, carta from mesa_juego
        where sala_id = p_sala and ronda = v_ronda and jugador_uid = v_last;
      delete from mesa_juego where sala_id = p_sala and ronda = v_ronda and jugador_uid = v_last;
    end if;
  end if;

  update salas set fase = 'juzgando', mejor_mesa_id = null where id = p_sala;
end $$;

-- ---------------------------------------------------------------------------
-- avanzar_ronda (escalares + deadline fresco)
-- ---------------------------------------------------------------------------
create or replace function public.avanzar_ronda(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_ronda int; v_juez uuid; v_penal uuid; v_next uuid; v_verde text; r record;
begin
  select ronda, juez_uid, penalizado_uid into v_ronda, v_juez, v_penal from salas where id = p_sala;

  delete from mesa_juego where sala_id = p_sala;
  update jugadores_sala set efecto_ronda = null, congelado_hasta = null, cartas_a_jugar = 1
    where sala_id = p_sala;

  select uid into v_next from jugadores_sala
   where sala_id = p_sala and conectado
     and orden > (select orden from jugadores_sala where sala_id = p_sala and uid = v_juez)
   order by orden limit 1;
  if v_next is null then
    select uid into v_next from jugadores_sala where sala_id = p_sala and conectado order by orden limit 1;
  end if;
  if v_next is null then v_next := v_juez; end if;

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

-- ---------------------------------------------------------------------------
-- resolver_timeout (escalares)
-- ---------------------------------------------------------------------------
create or replace function public.resolver_timeout(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_fase fase_sala; v_hasta timestamptz; v_ronda int; v_juez uuid;
        v_played int; v_mesa_id uuid; v_ganador uuid; v_pts int;
begin
  select fase, fase_hasta, ronda, juez_uid into v_fase, v_hasta, v_ronda, v_juez
    from salas where id = p_sala for update;
  if v_hasta is null or now() < v_hasta then return; end if;

  if v_fase = 'jugando' then
    select count(*) into v_played from mesa_juego where sala_id = p_sala and ronda = v_ronda;
    if v_played = 0 then
      perform avanzar_ronda(p_sala);
    elsif v_played = 1 then
      select id, jugador_uid into v_mesa_id, v_ganador from mesa_juego where sala_id = p_sala and ronda = v_ronda;
      update mesa_juego set es_ganadora = true where id = v_mesa_id;
      update jugadores_sala set puntos = puntos + 1 where sala_id = p_sala and uid = v_ganador returning puntos into v_pts;
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

-- ---------------------------------------------------------------------------
-- siguiente_ronda (delegado) — re-asegurado
-- ---------------------------------------------------------------------------
create or replace function public.siguiente_ronda(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_fase fase_sala; v_host uuid; v_juez uuid;
begin
  select fase, host_uid, juez_uid into v_fase, v_host, v_juez from salas where id = p_sala;
  if v_fase <> 'resultado' then raise exception 'Aún no termina la ronda'; end if;
  if v_uid <> v_host and v_uid <> v_juez then raise exception 'Solo el host o el Juez avanzan'; end if;
  perform avanzar_ronda(p_sala);
end $$;

grant execute on function public.resolver_timeout(uuid) to authenticated;
grant execute on function public.siguiente_ronda(uuid) to authenticated;

notify pgrst, 'reload schema';
