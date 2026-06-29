-- Mamones con Mamones — Lote 5: pulido del tablero clásico.

-- Revancha: el host reinicia la sala (vuelve a 'lobby', puntos a 0, manos limpias).
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
                   carta_verde = null, mazo_verde = '[]'::jsonb
  where id = p_sala;
end $$;

grant execute on function public.reiniciar_partida(uuid) to authenticated;

-- UIDs que YA jugaron en la ronda actual (para mostrar "✓ jugó"; no revela cartas).
create or replace function public.jugaron_uids(p_sala uuid)
returns uuid[] language sql security definer set search_path = public as $$
  select coalesce(array_agg(m.jugador_uid), '{}')
  from mesa_juego m
  join salas s on s.id = m.sala_id
  where m.sala_id = p_sala and m.ronda = s.ronda;
$$;

grant execute on function public.jugaron_uids(uuid) to authenticated;
