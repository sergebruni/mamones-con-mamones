-- Mamones con Mamones — Lote 15: resolver_timeout sin rowtype completo (escalares),
-- para evitar errores de "record has no field" por tipos cacheados (pgbouncer).

create or replace function public.resolver_timeout(p_sala uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_fase fase_sala; v_hasta timestamptz; v_ronda int; v_juez uuid;
  v_played int; v_mesa_id uuid; v_ganador uuid; v_pts int;
begin
  select fase, fase_hasta, ronda, juez_uid
    into v_fase, v_hasta, v_ronda, v_juez
    from salas where id = p_sala for update;

  if v_hasta is null or now() < v_hasta then return; end if;

  if v_fase = 'jugando' then
    select count(*) into v_played from mesa_juego where sala_id = p_sala and ronda = v_ronda;
    if v_played = 0 then
      perform avanzar_ronda(p_sala);
    elsif v_played = 1 then
      select id, jugador_uid into v_mesa_id, v_ganador
        from mesa_juego where sala_id = p_sala and ronda = v_ronda;
      update mesa_juego set es_ganadora = true where id = v_mesa_id;
      update jugadores_sala set puntos = puntos + 1
        where sala_id = p_sala and uid = v_ganador returning puntos into v_pts;
      if v_pts >= meta_ganar(p_sala) then
        update salas set fase = 'terminado' where id = p_sala;
      else
        update salas set fase = 'resultado' where id = p_sala;
      end if;
    else
      update salas set fase = 'juzgando', mejor_mesa_id = null where id = p_sala;
    end if;

  elsif v_fase = 'juzgando' then
    update salas set penalizado_uid = v_juez where id = p_sala;
    perform avanzar_ronda(p_sala);

  elsif v_fase = 'resultado' then
    perform avanzar_ronda(p_sala);
  end if;
end $$;

grant execute on function public.resolver_timeout(uuid) to authenticated;
