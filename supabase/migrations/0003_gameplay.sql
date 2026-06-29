-- Mamones con Mamones — Lote 2: jugabilidad (modo Clásico) autoritativa por RPC.
-- Requiere 0001 (tablas salas/jugadores_sala/cartas_mano) y 0002 (cartas sembradas).

-- =========================================================================
-- Mesa de juego (cartas jugadas en la ronda actual)
-- =========================================================================
create table if not exists public.mesa_juego (
  id uuid primary key default gen_random_uuid(),
  sala_id uuid not null references public.salas(id) on delete cascade,
  ronda int not null,
  jugador_uid uuid not null,
  carta text not null,
  es_ganadora boolean not null default false,
  creado_en timestamptz not null default now()
);

alter table public.mesa_juego enable row level security;

-- Anonimato: ves tu propia jugada siempre; las de los demás SOLO al revelar
-- (fase 'resultado'/'terminado'). Así el realtime tampoco filtra autoría antes.
drop policy if exists mesa_own on public.mesa_juego;
create policy mesa_own on public.mesa_juego
  for select to authenticated using (jugador_uid = auth.uid());

drop policy if exists mesa_reveal on public.mesa_juego;
create policy mesa_reveal on public.mesa_juego
  for select to authenticated using (
    exists (select 1 from public.salas s where s.id = sala_id and s.fase in ('resultado', 'terminado'))
  );

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mesa_juego'
  ) then
    alter publication supabase_realtime add table public.mesa_juego;
  end if;
end $$;

-- =========================================================================
-- Helpers
-- =========================================================================

-- Cartas verdes necesarias para ganar, según cantidad de jugadores.
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

-- Repone la mano de un jugador hasta 7 cartas rojas, sin repetir las que ya
-- están en alguna mano de la sala.
create or replace function public.repartir_mano(p_sala uuid, p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare faltan int;
begin
  select 7 - count(*) into faltan from cartas_mano where sala_id = p_sala and uid = p_uid;
  if faltan <= 0 then return; end if;

  insert into cartas_mano (sala_id, uid, carta)
  select p_sala, p_uid, c.texto
  from cartas c
  where c.color = 'roja' and c.activa
    and c.texto not in (select carta from cartas_mano where sala_id = p_sala)
  order by random()
  limit faltan;
end $$;

-- Elige una carta verde no usada en la sala; registra la usada en mazo_verde.
create or replace function public.nueva_verde(p_sala uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_used jsonb; v text;
begin
  select coalesce(mazo_verde, '[]'::jsonb) into v_used from salas where id = p_sala;

  select texto into v from cartas
   where color = 'verde' and activa and not (v_used @> to_jsonb(texto))
   order by random() limit 1;

  if v is null then  -- se agotaron: reiniciar el mazo verde
    v_used := '[]'::jsonb;
    select texto into v from cartas where color = 'verde' and activa order by random() limit 1;
  end if;

  update salas set mazo_verde = v_used || to_jsonb(v) where id = p_sala;
  return v;
end $$;

-- =========================================================================
-- RPCs de jugabilidad
-- =========================================================================

-- Inicia la partida (solo el host, mínimo 4 jugadores).
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

  delete from cartas_mano where sala_id = p_sala;
  delete from mesa_juego where sala_id = p_sala;
  update salas set mazo_verde = '[]'::jsonb, ronda = 0 where id = p_sala;

  for r in select uid from jugadores_sala where sala_id = p_sala loop
    perform repartir_mano(p_sala, r.uid);
  end loop;

  select uid into v_juez from jugadores_sala where sala_id = p_sala order by random() limit 1;
  v_verde := nueva_verde(p_sala);  -- calcular ANTES (hace su propio update de mazo_verde)

  update salas set fase = 'jugando', ronda = 1, juez_uid = v_juez, carta_verde = v_verde
  where id = p_sala;
end $$;

grant execute on function public.iniciar_partida(uuid) to authenticated;

-- Juega una carta de tu mano (los que no son Juez).
create or replace function public.jugar_carta(p_sala uuid, p_carta text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_sala salas; v_total int; v_jugaron int;
begin
  select * into v_sala from salas where id = p_sala;
  if v_sala.fase <> 'jugando' then raise exception 'No es momento de jugar'; end if;
  if v_sala.juez_uid = v_uid then raise exception 'El Juez no juega carta'; end if;
  if not exists (select 1 from jugadores_sala where sala_id = p_sala and uid = v_uid)
    then raise exception 'No estás en la sala'; end if;
  if exists (select 1 from mesa_juego where sala_id = p_sala and ronda = v_sala.ronda and jugador_uid = v_uid)
    then raise exception 'Ya jugaste esta ronda'; end if;
  if not exists (select 1 from cartas_mano where sala_id = p_sala and uid = v_uid and carta = p_carta)
    then raise exception 'No tienes esa carta'; end if;

  delete from cartas_mano where sala_id = p_sala and uid = v_uid and carta = p_carta;
  insert into mesa_juego (sala_id, ronda, jugador_uid, carta)
  values (p_sala, v_sala.ronda, v_uid, p_carta);

  select count(*) into v_total from jugadores_sala where sala_id = p_sala;
  select count(*) into v_jugaron from mesa_juego where sala_id = p_sala and ronda = v_sala.ronda;
  if v_jugaron >= v_total - 1 then
    update salas set fase = 'juzgando' where id = p_sala;
  end if;
end $$;

grant execute on function public.jugar_carta(uuid, text) to authenticated;

-- El Juez elige la jugada ganadora (por id de mesa_juego).
create or replace function public.elegir_ganadora(p_sala uuid, p_mesa_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_sala salas; v_ganador uuid; v_pts int; v_n int;
begin
  select * into v_sala from salas where id = p_sala;
  if v_sala.fase <> 'juzgando' then raise exception 'No es momento de juzgar'; end if;
  if v_sala.juez_uid <> v_uid then raise exception 'Solo el Juez elige'; end if;

  select jugador_uid into v_ganador from mesa_juego
   where id = p_mesa_id and sala_id = p_sala and ronda = v_sala.ronda;
  if v_ganador is null then raise exception 'Jugada inválida'; end if;

  update mesa_juego set es_ganadora = true where id = p_mesa_id;
  update jugadores_sala set puntos = puntos + 1
   where sala_id = p_sala and uid = v_ganador returning puntos into v_pts;

  select count(*) into v_n from jugadores_sala where sala_id = p_sala;
  if v_pts >= cartas_para_ganar(v_n) then
    update salas set fase = 'terminado' where id = p_sala;
  else
    update salas set fase = 'resultado' where id = p_sala;
  end if;
end $$;

grant execute on function public.elegir_ganadora(uuid, uuid) to authenticated;

-- Avanza a la siguiente ronda (host o Juez): repone manos y rota el Juez.
create or replace function public.siguiente_ronda(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_sala salas; v_next uuid; v_verde text; r record;
begin
  select * into v_sala from salas where id = p_sala;
  if v_sala.fase <> 'resultado' then raise exception 'Aún no termina la ronda'; end if;
  if v_uid <> v_sala.host_uid and v_uid <> v_sala.juez_uid
    then raise exception 'Solo el host o el Juez avanzan'; end if;

  delete from mesa_juego where sala_id = p_sala;
  for r in select uid from jugadores_sala where sala_id = p_sala loop
    perform repartir_mano(p_sala, r.uid);
  end loop;

  -- Rotar Juez: siguiente por 'orden' (cíclico).
  select uid into v_next from jugadores_sala
   where sala_id = p_sala
     and orden > (select orden from jugadores_sala where sala_id = p_sala and uid = v_sala.juez_uid)
   order by orden limit 1;
  if v_next is null then
    select uid into v_next from jugadores_sala where sala_id = p_sala order by orden limit 1;
  end if;

  v_verde := nueva_verde(p_sala);  -- calcular ANTES (evita update anidado sobre salas)

  update salas set fase = 'jugando', ronda = ronda + 1, juez_uid = v_next, carta_verde = v_verde
  where id = p_sala;
end $$;

grant execute on function public.siguiente_ronda(uuid) to authenticated;

-- Devuelve las jugadas de la ronda actual. Oculta la autoría salvo en
-- 'resultado'/'terminado' (anonimato para el Juez durante 'juzgando').
create or replace function public.mesa_actual(p_sala uuid)
returns table (id uuid, carta text, es_ganadora boolean, jugador_uid uuid, nombre text)
language plpgsql security definer set search_path = public as $$
declare v_fase fase_sala; v_ronda int; v_ver_carta boolean; v_ver_autor boolean;
begin
  select fase, ronda into v_fase, v_ronda from salas where id = p_sala;
  v_ver_carta := v_fase in ('juzgando', 'resultado', 'terminado'); -- textos al juzgar
  v_ver_autor := v_fase in ('resultado', 'terminado');             -- autoría al revelar
  return query
    select m.id,
           case when v_ver_carta then m.carta else null end,
           m.es_ganadora,
           case when v_ver_autor then m.jugador_uid else null end,
           case when v_ver_autor then j.nombre else null end
    from mesa_juego m
    left join jugadores_sala j on j.sala_id = m.sala_id and j.uid = m.jugador_uid
    where m.sala_id = p_sala and m.ronda = v_ronda
    order by md5(m.id::text);  -- orden anónimo estable
end $$;

grant execute on function public.mesa_actual(uuid) to authenticated;

-- =========================================================================
-- Subir el tope de jugadores a 10 (la tabla de victoria llega hasta 10).
-- =========================================================================
create or replace function public.unirse_sala(p_codigo text, p_nombre text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_sala salas; v_orden int;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  select * into v_sala from salas where codigo = upper(p_codigo);
  if not found then raise exception 'Sala no encontrada'; end if;
  if v_sala.fase <> 'lobby' then raise exception 'La partida ya empezó'; end if;

  update jugadores_sala set conectado = true, nombre = p_nombre
   where sala_id = v_sala.id and uid = v_uid;
  if found then return v_sala.id; end if;

  select coalesce(max(orden) + 1, 0) into v_orden from jugadores_sala where sala_id = v_sala.id;
  if v_orden >= 10 then raise exception 'Sala llena (máximo 10)'; end if;

  insert into jugadores_sala (sala_id, uid, nombre, orden)
  values (v_sala.id, v_uid, p_nombre, v_orden);
  return v_sala.id;
end $$;

grant execute on function public.unirse_sala(text, text) to authenticated;
