-- Mamones con Mamones — Lote 18: descarte de cartas rojas.
-- Regla: en una partida no se repiten cartas. Una roja está en juego (en una mano
-- o en la mesa) como mucho una vez, y al jugarse/descartarse NO vuelve a ninguna
-- mano hasta que termina la partida. Espejo de lo que ya hacen las verdes con
-- salas.mazo_verde. Idempotente: recrea las funciones afectadas a su versión final.

-- Descarte de rojas de la partida (textos ya quemados).
alter table public.salas add column if not exists mazo_rojo jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- repartir_mano: repone hasta 7 rojas que NO estén en juego (manos), en la mesa,
-- ni descartadas (mazo_rojo). Si el mazo se agota, recicla el descarte y rellena.
-- ---------------------------------------------------------------------------
create or replace function public.repartir_mano(p_sala uuid, p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare faltan int; v_insertadas int;
begin
  select 7 - count(*) into faltan from cartas_mano where sala_id = p_sala and uid = p_uid;
  if faltan <= 0 then return; end if;

  with usadas as (
    select carta from cartas_mano where sala_id = p_sala
    union
    select carta from mesa_juego where sala_id = p_sala
    union
    select jsonb_array_elements_text(coalesce(mazo_rojo, '[]'::jsonb))
      from salas where id = p_sala
  )
  insert into cartas_mano (sala_id, uid, carta)
  select p_sala, p_uid, c.texto
  from cartas c
  where c.color = 'roja' and c.activa and c.texto not in (select carta from usadas)
  order by random()
  limit faltan;

  get diagnostics v_insertadas = row_count;

  -- ¿No alcanzó? El mazo se agotó: recicla el descarte y rellena lo que falte
  -- (excluyendo solo lo que sigue en juego: manos y mesa).
  if v_insertadas < faltan then
    update salas set mazo_rojo = '[]'::jsonb where id = p_sala;
    with usadas as (
      select carta from cartas_mano where sala_id = p_sala
      union
      select carta from mesa_juego where sala_id = p_sala
    )
    insert into cartas_mano (sala_id, uid, carta)
    select p_sala, p_uid, c.texto
    from cartas c
    where c.color = 'roja' and c.activa and c.texto not in (select carta from usadas)
    order by random()
    limit (faltan - v_insertadas);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- avanzar_ronda: descarta a mazo_rojo las cartas de la mesa ANTES de borrarlas,
-- luego repone. (Copia de 0016 + el descarte.)
-- ---------------------------------------------------------------------------
create or replace function public.avanzar_ronda(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_ronda int; v_juez uuid; v_penal uuid; v_next uuid; v_verde text; r record;
begin
  select ronda, juez_uid, penalizado_uid into v_ronda, v_juez, v_penal from salas where id = p_sala;

  -- Descartar las cartas jugadas: no vuelven a ninguna mano en esta partida.
  update salas set mazo_rojo = coalesce(mazo_rojo, '[]'::jsonb) ||
    coalesce((select jsonb_agg(carta) from mesa_juego where sala_id = p_sala), '[]'::jsonb)
  where id = p_sala;
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
-- girar_ruleta_para: el efecto 'mazo_barajado' descarta la mano vieja a mazo_rojo
-- antes de repartir una nueva. (Copia de 0017 + el descarte.)
-- ---------------------------------------------------------------------------
create or replace function public.girar_ruleta_para(p_sala uuid, p_uid uuid, p_depth int)
returns void language plpgsql security definer set search_path = public as $$
declare v_pick int; v_key text; v_piensa boolean;
begin
  select coalesce((config->>'piensaRapido')::boolean, false) into v_piensa from salas where id = p_sala;

  loop
    v_pick := floor(random() * 6)::int + 1;             -- 1..6
    if v_pick = 5 and p_depth >= 3 then continue; end if; -- corta cadenas de "pasa"
    if v_pick = 2 and not v_piensa then continue; end if; -- mano congelada solo con piensa rápido
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

  if v_key = 'mazo_barajado' then
    update salas set mazo_rojo = coalesce(mazo_rojo, '[]'::jsonb) ||
      coalesce((select jsonb_agg(carta) from cartas_mano where sala_id = p_sala and uid = p_uid), '[]'::jsonb)
    where id = p_sala;
    delete from cartas_mano where sala_id = p_sala and uid = p_uid;
    perform repartir_mano(p_sala, p_uid);
    update jugadores_sala set efecto_activo = null where sala_id = p_sala and uid = p_uid;
  elsif v_key = 'pasa_mamon' then
    update jugadores_sala set efecto_activo = null where sala_id = p_sala and uid = p_uid;
  else
    update jugadores_sala set efecto_activo = v_key where sala_id = p_sala and uid = p_uid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- iniciar_partida / reiniciar_partida: resetear también el descarte rojo.
-- (Copias de 0012 y 0005 + el reset de mazo_rojo.)
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
  update salas set mazo_verde = '[]'::jsonb, mazo_rojo = '[]'::jsonb, ronda = 0, penalizado_uid = null
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
                   carta_verde = null, mazo_verde = '[]'::jsonb, mazo_rojo = '[]'::jsonb
  where id = p_sala;
end $$;

grant execute on function public.reiniciar_partida(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Garantía dura: dos manos nunca tienen la misma carta en una sala.
-- (Limpia duplicados previos por si la lógica vieja dejó alguno, luego indexa.)
-- ---------------------------------------------------------------------------
delete from public.cartas_mano a using public.cartas_mano b
 where a.ctid < b.ctid and a.sala_id = b.sala_id and a.carta = b.carta;
create unique index if not exists cartas_mano_sala_carta_uniq
  on public.cartas_mano (sala_id, carta);

notify pgrst, 'reload schema';
