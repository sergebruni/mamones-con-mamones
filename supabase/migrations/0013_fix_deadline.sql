-- Mamones con Mamones — Lote 13: fija el deadline en cada ronda.
-- Bug: al saltar de 'jugando' a 'jugando' (timeout sin jugadas), el trigger no
-- refrescaba fase_hasta (la fase "no cambia") y el reloj quedaba vencido → bucle.
-- Solución: avanzar_ronda fija fase_hasta y ronda_inicio explícitamente.

create or replace function public.avanzar_ronda(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sala salas; v_next uuid; v_verde text; r record;
begin
  select * into v_sala from salas where id = p_sala;
  delete from mesa_juego where sala_id = p_sala;
  update jugadores_sala set efecto_ronda = null, congelado_hasta = null, cartas_a_jugar = 1
    where sala_id = p_sala;

  select uid into v_next from jugadores_sala
   where sala_id = p_sala and conectado
     and orden > (select orden from jugadores_sala where sala_id = p_sala and uid = v_sala.juez_uid)
   order by orden limit 1;
  if v_next is null then
    select uid into v_next from jugadores_sala where sala_id = p_sala and conectado order by orden limit 1;
  end if;
  if v_next is null then v_next := v_sala.juez_uid; end if;

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

  if v_sala.penalizado_uid is not null and v_sala.penalizado_uid <> v_next then
    update jugadores_sala set cartas_a_jugar = 0, efecto_ronda = 'sin_turno'
      where sala_id = p_sala and uid = v_sala.penalizado_uid;
  end if;

  for r in select uid from jugadores_sala where sala_id = p_sala loop
    perform repartir_mano(p_sala, r.uid);
  end loop;

  v_verde := nueva_verde(p_sala);
  update salas set fase = 'jugando', ronda = ronda + 1, juez_uid = v_next, carta_verde = v_verde,
                   mejor_mesa_id = null, peor_uid = null, ruleta_efecto = null, penalizado_uid = null,
                   fase_hasta = now() + interval '60 seconds', ronda_inicio = now()  -- deadline siempre fresco
  where id = p_sala;
end $$;
