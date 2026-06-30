-- Mamones con Mamones — Lote 8: modo Amargo + La Ruleta del Mamón Amargo (online).
-- El Juez elige MEJOR y PEOR; el de la peor gira la ruleta (resuelta en el server).

-- ---------------------------------------------------------------------------
-- Columnas de estado
-- ---------------------------------------------------------------------------
alter table public.salas add column if not exists mejor_mesa_id uuid;     -- mejor ya elegida (paso "peor" pendiente)
alter table public.salas add column if not exists peor_uid uuid;          -- quién gira la ruleta
alter table public.salas add column if not exists ruleta_efecto int;      -- 1..6 (para animar)

alter table public.jugadores_sala add column if not exists efecto_activo text;          -- efecto pendiente (próxima ronda)
alter table public.jugadores_sala add column if not exists efecto_ronda text;           -- efecto activo ESTA ronda (para el cliente)
alter table public.jugadores_sala add column if not exists congelado_hasta timestamptz; -- mano congelada
alter table public.jugadores_sala add column if not exists cartas_a_jugar int not null default 1;

-- ---------------------------------------------------------------------------
-- Ruleta: decide el efecto en el servidor y lo aplica
-- ---------------------------------------------------------------------------
create or replace function public.girar_ruleta_para(p_sala uuid, p_uid uuid, p_depth int)
returns void language plpgsql security definer set search_path = public as $$
declare v_pick int; v_key text; v_piensa boolean;
begin
  select coalesce((config->>'piensaRapido')::boolean, false) into v_piensa from salas where id = p_sala;
  loop
    v_pick := floor(random() * 6)::int + 1;             -- 1..6
    if v_pick = 5 and p_depth >= 3 then continue; end if; -- corta cadenas de "pasa"
    if v_pick = 2 and not v_piensa then continue; end if; -- congelar solo con piensa rápido
    exit;
  end loop;

  v_key := case v_pick
    when 1 then 'pela_el_ojo'
    when 2 then 'mano_congelada'
    when 3 then 'mazo_barajado'
    when 4 then 'jugar_a_ciegas'
    when 5 then 'pasa_mamon'
    when 6 then 'jugada_doble'
  end;

  update salas set ruleta_efecto = v_pick, peor_uid = p_uid where id = p_sala;

  if v_key = 'mazo_barajado' then                    -- inmediato
    delete from cartas_mano where sala_id = p_sala and uid = p_uid;
    perform repartir_mano(p_sala, p_uid);
    update jugadores_sala set efecto_activo = null where sala_id = p_sala and uid = p_uid;
  elsif v_key = 'pasa_mamon' then                    -- pendiente de transferir
    update jugadores_sala set efecto_activo = null where sala_id = p_sala and uid = p_uid;
  else                                               -- efecto para la próxima ronda
    update jugadores_sala set efecto_activo = v_key where sala_id = p_sala and uid = p_uid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Juicio: en Amargo, elegir_ganadora = paso "mejor"; luego elegir_peor.
-- ---------------------------------------------------------------------------
create or replace function public.elegir_ganadora(p_sala uuid, p_mesa_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_sala salas; v_ganador uuid; v_pts int; v_n int; v_amarga boolean;
begin
  select * into v_sala from salas where id = p_sala;
  if v_sala.fase <> 'juzgando' then raise exception 'No es momento de juzgar'; end if;
  if v_sala.juez_uid <> v_uid then raise exception 'Solo el Juez elige'; end if;
  v_amarga := (v_sala.config->>'modo') = 'amarga';
  if v_amarga and v_sala.mejor_mesa_id is not null then raise exception 'Ahora elige la PEOR carta'; end if;

  select jugador_uid into v_ganador from mesa_juego
   where id = p_mesa_id and sala_id = p_sala and ronda = v_sala.ronda;
  if v_ganador is null then raise exception 'Jugada inválida'; end if;

  update mesa_juego set es_ganadora = true where id = p_mesa_id;
  update jugadores_sala set puntos = puntos + 1 where sala_id = p_sala and uid = v_ganador
    returning puntos into v_pts;
  select count(*) into v_n from jugadores_sala where sala_id = p_sala;

  if v_pts >= cartas_para_ganar(v_n) then
    update salas set fase = 'terminado' where id = p_sala;
  elsif v_amarga then
    update salas set mejor_mesa_id = p_mesa_id where id = p_sala;  -- falta elegir la peor
  else
    update salas set fase = 'resultado' where id = p_sala;
  end if;
end $$;

grant execute on function public.elegir_ganadora(uuid, uuid) to authenticated;

create or replace function public.elegir_peor(p_sala uuid, p_mesa_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_sala salas; v_peor uuid;
begin
  select * into v_sala from salas where id = p_sala;
  if (v_sala.config->>'modo') <> 'amarga' then raise exception 'Solo en modo Amargo'; end if;
  if v_sala.fase <> 'juzgando' then raise exception 'No es momento de juzgar'; end if;
  if v_sala.juez_uid <> v_uid then raise exception 'Solo el Juez elige'; end if;
  if v_sala.mejor_mesa_id is null then raise exception 'Primero elige la mejor'; end if;
  if p_mesa_id = v_sala.mejor_mesa_id then raise exception 'Esa es la mejor, no la peor'; end if;

  select jugador_uid into v_peor from mesa_juego
   where id = p_mesa_id and sala_id = p_sala and ronda = v_sala.ronda;
  if v_peor is null then raise exception 'Jugada inválida'; end if;

  perform girar_ruleta_para(p_sala, v_peor, 0);
  update salas set fase = 'resultado' where id = p_sala;
end $$;

grant execute on function public.elegir_peor(uuid, uuid) to authenticated;

-- Pasa el mamón: el penalizado se lo pasa a otro, que gira de inmediato.
create or replace function public.pasar_mamon(p_sala uuid, p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_sala salas;
begin
  select * into v_sala from salas where id = p_sala;
  if v_sala.fase <> 'resultado' then raise exception 'Fuera de tiempo'; end if;
  if v_sala.ruleta_efecto <> 5 then raise exception 'No hay mamón que pasar'; end if;
  if v_sala.peor_uid <> v_uid then raise exception 'No te toca pasarlo'; end if;
  if p_target = v_uid then raise exception 'No puedes pasártelo a ti'; end if;
  if not exists (select 1 from jugadores_sala where sala_id = p_sala and uid = p_target) then
    raise exception 'Jugador inválido';
  end if;
  perform girar_ruleta_para(p_sala, p_target, 3);  -- el receptor no puede volver a "pasar"
end $$;

grant execute on function public.pasar_mamon(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Jugar carta: respeta mano congelada y "jugada doble" (cartas_a_jugar).
-- ---------------------------------------------------------------------------
create or replace function public.jugar_carta(p_sala uuid, p_carta text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_sala salas; v_need int; v_done int; v_expected int; v_jugaron int; v_cong timestamptz;
begin
  select * into v_sala from salas where id = p_sala;
  if v_sala.fase <> 'jugando' then raise exception 'No es momento de jugar'; end if;
  if v_sala.juez_uid = v_uid then raise exception 'El Juez no juega carta'; end if;

  select cartas_a_jugar, congelado_hasta into v_need, v_cong
    from jugadores_sala where sala_id = p_sala and uid = v_uid;
  if v_need is null then raise exception 'No estás en la sala'; end if;
  if v_cong is not null and v_cong > now() then raise exception '🥶 Tienes la mano congelada'; end if;

  select count(*) into v_done from mesa_juego where sala_id = p_sala and ronda = v_sala.ronda and jugador_uid = v_uid;
  if v_done >= v_need then raise exception 'Ya jugaste tus cartas'; end if;
  if not exists (select 1 from cartas_mano where sala_id = p_sala and uid = v_uid and carta = p_carta) then
    raise exception 'No tienes esa carta';
  end if;

  delete from cartas_mano where sala_id = p_sala and uid = v_uid and carta = p_carta;
  insert into mesa_juego (sala_id, ronda, jugador_uid, carta) values (p_sala, v_sala.ronda, v_uid, p_carta);

  select coalesce(sum(cartas_a_jugar), 0) into v_expected from jugadores_sala
    where sala_id = p_sala and conectado and uid <> v_sala.juez_uid;
  select count(*) into v_jugaron from mesa_juego where sala_id = p_sala and ronda = v_sala.ronda;
  if v_expected > 0 and v_jugaron >= v_expected then
    update salas set fase = 'juzgando', mejor_mesa_id = null where id = p_sala;
  end if;
end $$;

grant execute on function public.jugar_carta(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Avanzar de ronda: aplica efectos pendientes y limpia estado de ruleta.
-- ---------------------------------------------------------------------------
create or replace function public.avanzar_ronda(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sala salas; v_next uuid; v_verde text; r record;
begin
  select * into v_sala from salas where id = p_sala;
  delete from mesa_juego where sala_id = p_sala;

  -- reset del estado por-ronda de efectos
  update jugadores_sala set efecto_ronda = null, congelado_hasta = null, cartas_a_jugar = 1
   where sala_id = p_sala;

  -- nuevo Juez (prefiere conectados)
  select uid into v_next from jugadores_sala
   where sala_id = p_sala and conectado
     and orden > (select orden from jugadores_sala where sala_id = p_sala and uid = v_sala.juez_uid)
   order by orden limit 1;
  if v_next is null then
    select uid into v_next from jugadores_sala where sala_id = p_sala and conectado order by orden limit 1;
  end if;
  if v_next is null then v_next := v_sala.juez_uid; end if;

  -- aplicar efectos pendientes (se pierden si el afectado es el nuevo Juez)
  for r in select uid, efecto_activo from jugadores_sala
           where sala_id = p_sala and efecto_activo is not null loop
    if r.uid = v_next then
      update jugadores_sala set efecto_activo = null where sala_id = p_sala and uid = r.uid;
    else
      update jugadores_sala set
        efecto_ronda = r.efecto_activo,
        efecto_activo = null,
        cartas_a_jugar = case when r.efecto_activo = 'jugada_doble' then 2 else 1 end,
        congelado_hasta = case when r.efecto_activo = 'mano_congelada' then now() + interval '10 seconds' else null end
      where sala_id = p_sala and uid = r.uid;
    end if;
  end loop;

  -- reponer manos
  for r in select uid from jugadores_sala where sala_id = p_sala loop
    perform repartir_mano(p_sala, r.uid);
  end loop;

  v_verde := nueva_verde(p_sala);
  update salas set fase = 'jugando', ronda = ronda + 1, juez_uid = v_next, carta_verde = v_verde,
                   mejor_mesa_id = null, peor_uid = null, ruleta_efecto = null
  where id = p_sala;
end $$;

-- ---------------------------------------------------------------------------
-- Timeout: ahora también resuelve el doble juicio del modo Amargo.
-- ---------------------------------------------------------------------------
create or replace function public.resolver_timeout(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sala salas; r record; v_card text; v_mesa_id uuid; v_ganador uuid; v_pts int; v_n int; v_amarga boolean; v_peor uuid;
begin
  select * into v_sala from salas where id = p_sala for update;
  if v_sala.fase_hasta is null or now() < v_sala.fase_hasta then return; end if;
  v_amarga := (v_sala.config->>'modo') = 'amarga';

  if v_sala.fase = 'jugando' then
    for r in
      select j.uid from jugadores_sala j
      where j.sala_id = p_sala and j.conectado and j.uid <> v_sala.juez_uid
        and (select count(*) from mesa_juego m where m.sala_id = p_sala and m.ronda = v_sala.ronda and m.jugador_uid = j.uid) < j.cartas_a_jugar
    loop
      -- auto-jugar hasta completar su cupo
      for v_card in select carta from cartas_mano where sala_id = p_sala and uid = r.uid order by random() loop
        exit when (select count(*) from mesa_juego m where m.sala_id = p_sala and m.ronda = v_sala.ronda and m.jugador_uid = r.uid)
                  >= (select cartas_a_jugar from jugadores_sala where sala_id = p_sala and uid = r.uid);
        delete from cartas_mano where sala_id = p_sala and uid = r.uid and carta = v_card;
        insert into mesa_juego (sala_id, ronda, jugador_uid, carta) values (p_sala, v_sala.ronda, r.uid, v_card);
      end loop;
    end loop;

    if exists (select 1 from mesa_juego where sala_id = p_sala and ronda = v_sala.ronda) then
      update salas set fase = 'juzgando', mejor_mesa_id = null where id = p_sala;
    else
      update salas set fase_hasta = now() + interval '30 seconds' where id = p_sala;
    end if;

  elsif v_sala.fase = 'juzgando' then
    -- elegir mejor (si falta)
    if v_sala.mejor_mesa_id is null then
      select id into v_mesa_id from mesa_juego where sala_id = p_sala and ronda = v_sala.ronda order by random() limit 1;
      if v_mesa_id is not null then
        update mesa_juego set es_ganadora = true where id = v_mesa_id;
        select jugador_uid into v_ganador from mesa_juego where id = v_mesa_id;
        update jugadores_sala set puntos = puntos + 1 where sala_id = p_sala and uid = v_ganador returning puntos into v_pts;
        select count(*) into v_n from jugadores_sala where sala_id = p_sala;
        if v_pts >= cartas_para_ganar(v_n) then
          update salas set fase = 'terminado' where id = p_sala;
          return;
        end if;
        update salas set mejor_mesa_id = v_mesa_id where id = p_sala;
        v_sala.mejor_mesa_id := v_mesa_id;
      end if;
    end if;

    if v_amarga and v_sala.mejor_mesa_id is not null then
      -- elegir peor (distinta de la mejor) y girar ruleta
      select id, jugador_uid into v_mesa_id, v_peor from mesa_juego
        where sala_id = p_sala and ronda = v_sala.ronda and id <> v_sala.mejor_mesa_id
        order by random() limit 1;
      if v_peor is not null then
        perform girar_ruleta_para(p_sala, v_peor, 0);
      end if;
      update salas set fase = 'resultado' where id = p_sala;
    else
      update salas set fase = 'resultado' where id = p_sala;  -- clásico
    end if;

  elsif v_sala.fase = 'resultado' then
    perform avanzar_ronda(p_sala);
  end if;
end $$;

grant execute on function public.resolver_timeout(uuid) to authenticated;
