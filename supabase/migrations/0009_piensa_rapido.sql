-- Mamones con Mamones — Lote 9: modo "Piensa Rápido".
-- El último en jugar su carta no juega esa ronda: se le devuelve a la mano.

-- Marca de tiempo de cada jugada (para saber quién fue el último).
alter table public.mesa_juego add column if not exists jugada_en timestamptz not null default now();

-- Cierra la fase de jugadas: aplica Piensa Rápido (si está activo) y pasa a juzgar.
create or replace function public.cerrar_jugadas(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sala salas; v_last uuid; v_jugadores int;
begin
  select * into v_sala from salas where id = p_sala;

  if coalesce((v_sala.config->>'piensaRapido')::boolean, false) then
    select count(distinct jugador_uid) into v_jugadores
      from mesa_juego where sala_id = p_sala and ronda = v_sala.ronda;
    -- Solo penalizamos si quedará al menos una carta para juzgar.
    if v_jugadores >= 2 then
      select jugador_uid into v_last from mesa_juego
        where sala_id = p_sala and ronda = v_sala.ronda
        order by jugada_en desc limit 1;
      -- Devolver sus cartas de esta ronda a la mano y quitarlas de la mesa.
      insert into cartas_mano (sala_id, uid, carta)
        select sala_id, jugador_uid, carta from mesa_juego
        where sala_id = p_sala and ronda = v_sala.ronda and jugador_uid = v_last;
      delete from mesa_juego where sala_id = p_sala and ronda = v_sala.ronda and jugador_uid = v_last;
    end if;
  end if;

  update salas set fase = 'juzgando', mejor_mesa_id = null where id = p_sala;
end $$;

-- jugar_carta ahora cierra vía cerrar_jugadas (para aplicar Piensa Rápido).
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
    perform cerrar_jugadas(p_sala);
  end if;
end $$;

grant execute on function public.jugar_carta(uuid, text) to authenticated;

-- resolver_timeout: usa cerrar_jugadas al completar la fase de jugadas.
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
      for v_card in select carta from cartas_mano where sala_id = p_sala and uid = r.uid order by random() loop
        exit when (select count(*) from mesa_juego m where m.sala_id = p_sala and m.ronda = v_sala.ronda and m.jugador_uid = r.uid)
                  >= (select cartas_a_jugar from jugadores_sala where sala_id = p_sala and uid = r.uid);
        delete from cartas_mano where sala_id = p_sala and uid = r.uid and carta = v_card;
        insert into mesa_juego (sala_id, ronda, jugador_uid, carta) values (p_sala, v_sala.ronda, r.uid, v_card);
      end loop;
    end loop;

    if exists (select 1 from mesa_juego where sala_id = p_sala and ronda = v_sala.ronda) then
      perform cerrar_jugadas(p_sala);
    else
      update salas set fase_hasta = now() + interval '30 seconds' where id = p_sala;
    end if;

  elsif v_sala.fase = 'juzgando' then
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
      select id, jugador_uid into v_mesa_id, v_peor from mesa_juego
        where sala_id = p_sala and ronda = v_sala.ronda and id <> v_sala.mejor_mesa_id
        order by random() limit 1;
      if v_peor is not null then
        perform girar_ruleta_para(p_sala, v_peor, 0);
      end if;
      update salas set fase = 'resultado' where id = p_sala;
    else
      update salas set fase = 'resultado' where id = p_sala;
    end if;

  elsif v_sala.fase = 'resultado' then
    perform avanzar_ronda(p_sala);
  end if;
end $$;

grant execute on function public.resolver_timeout(uuid) to authenticated;
