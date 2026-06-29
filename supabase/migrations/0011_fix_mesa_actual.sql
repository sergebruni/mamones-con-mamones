-- Mamones con Mamones — Lote 11: fix de mesa_actual.
-- El RETURNS TABLE declara una columna 'id', y "from salas where id = p_sala"
-- resultaba ambiguo (variable de salida vs columna). Se califica como salas.id.

create or replace function public.mesa_actual(p_sala uuid)
returns table (id uuid, carta text, es_ganadora boolean, jugador_uid uuid, nombre text)
language plpgsql security definer set search_path = public as $$
declare v_fase fase_sala; v_ronda int; v_ver_carta boolean; v_ver_autor boolean;
begin
  select s.fase, s.ronda into v_fase, v_ronda from salas s where s.id = p_sala;
  v_ver_carta := v_fase in ('juzgando', 'resultado', 'terminado');
  v_ver_autor := v_fase in ('resultado', 'terminado');
  return query
    select m.id,
           case when v_ver_carta then m.carta else null end,
           m.es_ganadora,
           case when v_ver_autor then m.jugador_uid else null end,
           case when v_ver_autor then j.nombre else null end
    from mesa_juego m
    left join jugadores_sala j on j.sala_id = m.sala_id and j.uid = m.jugador_uid
    where m.sala_id = p_sala and m.ronda = v_ronda
    order by md5(m.id::text);
end $$;

grant execute on function public.mesa_actual(uuid) to authenticated;
