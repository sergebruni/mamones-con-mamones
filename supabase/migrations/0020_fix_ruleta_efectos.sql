-- Mamones con Mamones — Lote 20: correcciones de la Ruleta del Mamón Amargo (MP).
-- Idempotente (create or replace). Correr en Supabase.
--
-- 1) El efecto de la ruleta ya NO se pierde si el objetivo pasa a ser Juez la
--    ronda siguiente: se conserva pendiente (efecto_activo) hasta que vuelva a
--    jugar. Antes avanzar_ronda lo borraba.  [bug 3]
-- 2) "Pasa el mamón" refresca el deadline de la fase resultado, para dar tiempo
--    a ver la ruleta re-girar en el nuevo objetivo.  [bug 2]
--
-- (La animación que "no giraba en móvil" y "pela el ojo" que no re-ocultaba son
--  arreglos de front en OnlineGame.jsx; no requieren SQL.)

-- ---------------------------------------------------------------------------
-- avanzar_ronda: conserva el efecto pendiente del próximo Juez. (Base: 0018.)
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

  -- Activar los efectos pendientes para esta ronda. EXCEPCIÓN: el próximo Juez no
  -- juega, así que conservamos su efecto pendiente (efecto_activo) para cuando
  -- vuelva a jugar, en vez de perderlo.
  for r in select uid, efecto_activo from jugadores_sala where sala_id = p_sala and efecto_activo is not null loop
    if r.uid <> v_next then
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
-- pasar_mamon: re-gira la ruleta para el objetivo y refresca el deadline para
-- que dé tiempo a verla. (Base: 0008 + fase_hasta; escalares por el rowtype.)
-- ---------------------------------------------------------------------------
create or replace function public.pasar_mamon(p_sala uuid, p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_fase fase_sala; v_efecto int; v_peor uuid;
begin
  select fase, ruleta_efecto, peor_uid into v_fase, v_efecto, v_peor from salas where id = p_sala;
  if v_fase <> 'resultado' then raise exception 'Fuera de tiempo'; end if;
  if v_efecto <> 5 then raise exception 'No hay mamón que pasar'; end if;
  if v_peor <> v_uid then raise exception 'No te toca pasarlo'; end if;
  if p_target = v_uid then raise exception 'No puedes pasártelo a ti'; end if;
  if not exists (select 1 from jugadores_sala where sala_id = p_sala and uid = p_target) then
    raise exception 'Jugador inválido';
  end if;

  perform girar_ruleta_para(p_sala, p_target, 3);  -- el receptor no puede volver a "pasar"
  -- La fase sigue en 'resultado', así que el trigger no refresca el deadline solo:
  -- lo hacemos aquí para dar tiempo a ver la ruleta re-girar en el nuevo objetivo.
  update salas set fase_hasta = now() + interval '25 seconds' where id = p_sala;
end $$;

grant execute on function public.pasar_mamon(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
