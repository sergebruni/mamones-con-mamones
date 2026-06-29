-- Mamones con Mamones — Lote 1: cartas (canónico) + salas/lobby.
-- Autoridad: RPC SECURITY DEFINER + RLS. Los clientes NO escriben las tablas;
-- solo leen (según RLS) e invocan funciones validadas.

-- =========================================================================
-- Cartas (fuente de verdad para repartir en el servidor)
-- =========================================================================
create table if not exists public.cartas (
  id bigint generated always as identity primary key,
  color text not null check (color in ('verde', 'roja')),  -- mazo: verde=adjetivo, roja=sustantivo
  tipo text,                           -- categoría: personajes, dichos, etc. (libre, puede ir null)
  texto text not null,                 -- título de la carta
  flavor text,                         -- frase/chiste al pie (puede ir vacío)
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  unique (color, texto)
);

alter table public.cartas enable row level security;

-- Lectura pública (las cartas no son secretas). Escritura solo por dashboard/service_role.
drop policy if exists cartas_select on public.cartas;
create policy cartas_select on public.cartas
  for select to anon, authenticated using (true);

-- =========================================================================
-- Salas
-- =========================================================================
do $$ begin
  create type public.fase_sala as enum ('lobby', 'jugando', 'juzgando', 'resultado', 'terminado');
exception when duplicate_object then null; end $$;

create table if not exists public.salas (
  id uuid primary key default gen_random_uuid(),
  codigo text unique not null,
  fase public.fase_sala not null default 'lobby',
  ronda int not null default 0,
  host_uid uuid not null,
  juez_uid uuid,
  carta_verde text,
  config jsonb not null default '{"modo":"clasica","piensaRapido":false}'::jsonb,
  mazo_rojo jsonb not null default '[]'::jsonb,   -- mazo restante (server-side)
  mazo_verde jsonb not null default '[]'::jsonb,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

alter table public.salas enable row level security;
-- Slice: lectura a usuarios autenticados (incluye anónimos). Escritura solo vía RPC.
drop policy if exists salas_select on public.salas;
create policy salas_select on public.salas
  for select to authenticated using (true);

-- =========================================================================
-- Jugadores en sala (información pública: nombre, puntos)
-- =========================================================================
create table if not exists public.jugadores_sala (
  id uuid primary key default gen_random_uuid(),
  sala_id uuid not null references public.salas(id) on delete cascade,
  uid uuid not null,
  nombre text not null,
  puntos int not null default 0,
  orden int not null,                       -- para rotar el Juez
  conectado boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (sala_id, uid)
);

alter table public.jugadores_sala enable row level security;
drop policy if exists jugadores_select on public.jugadores_sala;
create policy jugadores_select on public.jugadores_sala
  for select to authenticated using (true);

-- =========================================================================
-- Cartas en mano (PRIVADAS: solo ves la tuya)
-- =========================================================================
create table if not exists public.cartas_mano (
  id uuid primary key default gen_random_uuid(),
  sala_id uuid not null references public.salas(id) on delete cascade,
  uid uuid not null,
  carta text not null,
  creado_en timestamptz not null default now()
);

alter table public.cartas_mano enable row level security;
drop policy if exists mano_select_propia on public.cartas_mano;
create policy mano_select_propia on public.cartas_mano
  for select to authenticated using (uid = auth.uid());

-- =========================================================================
-- Realtime (postgres_changes) — idempotente
-- =========================================================================
do $$
declare t text;
begin
  foreach t in array array['salas', 'jugadores_sala', 'cartas_mano'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- =========================================================================
-- RPCs de lobby
-- =========================================================================
create or replace function public.crear_sala(p_nombre text)
returns table (sala_id uuid, codigo text)
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_alfabeto text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- sin O,0,I,1,L (ambiguos)
  v_codigo text;
  v_sala uuid;
  i int;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  loop
    v_codigo := '';
    for i in 1..6 loop
      v_codigo := v_codigo || substr(v_alfabeto, 1 + floor(random() * length(v_alfabeto))::int, 1);
    end loop;
    exit when not exists (select 1 from public.salas s where s.codigo = v_codigo);
  end loop;

  insert into public.salas (codigo, host_uid) values (v_codigo, v_uid)
  returning id into v_sala;

  insert into public.jugadores_sala (sala_id, uid, nombre, orden)
  values (v_sala, v_uid, p_nombre, 0);

  return query select v_sala, v_codigo;
end $$;

grant execute on function public.crear_sala(text) to authenticated;

create or replace function public.unirse_sala(p_codigo text, p_nombre text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sala public.salas;
  v_orden int;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  select * into v_sala from public.salas where codigo = upper(p_codigo);
  if not found then raise exception 'Sala no encontrada'; end if;
  if v_sala.fase <> 'lobby' then raise exception 'La partida ya empezó'; end if;

  -- Reingreso: si ya estaba, solo reconectar y actualizar nombre.
  update public.jugadores_sala
     set conectado = true, nombre = p_nombre
   where sala_id = v_sala.id and uid = v_uid;
  if found then return v_sala.id; end if;

  select coalesce(max(orden) + 1, 0) into v_orden
    from public.jugadores_sala where sala_id = v_sala.id;
  if v_orden >= 8 then raise exception 'Sala llena'; end if;

  insert into public.jugadores_sala (sala_id, uid, nombre, orden)
  values (v_sala.id, v_uid, p_nombre, v_orden);

  return v_sala.id;
end $$;

grant execute on function public.unirse_sala(text, text) to authenticated;
