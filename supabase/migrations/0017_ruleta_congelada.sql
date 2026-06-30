-- Mamones con Mamones — Lote 17: "Mano congelada" (efecto 2) solo sale en la
-- ruleta si Piensa Rápido está activo (si no, congelar no penaliza).

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
    delete from cartas_mano where sala_id = p_sala and uid = p_uid;
    perform repartir_mano(p_sala, p_uid);
    update jugadores_sala set efecto_activo = null where sala_id = p_sala and uid = p_uid;
  elsif v_key = 'pasa_mamon' then
    update jugadores_sala set efecto_activo = null where sala_id = p_sala and uid = p_uid;
  else
    update jugadores_sala set efecto_activo = v_key where sala_id = p_sala and uid = p_uid;
  end if;
end $$;
