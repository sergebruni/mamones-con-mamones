-- Mamones con Mamones — Lote 4: el host configura modo y "piensa rápido" en el lobby.

create or replace function public.set_config_sala(p_sala uuid, p_modo text, p_piensa boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_sala salas;
begin
  select * into v_sala from salas where id = p_sala;
  if not found then raise exception 'Sala no existe'; end if;
  if v_sala.host_uid <> v_uid then raise exception 'Solo el host configura la sala'; end if;
  if v_sala.fase <> 'lobby' then raise exception 'La partida ya empezó'; end if;
  if p_modo not in ('clasica', 'amarga') then raise exception 'Modo inválido'; end if;

  update salas
     set config = jsonb_build_object('modo', p_modo, 'piensaRapido', coalesce(p_piensa, false))
   where id = p_sala;
end $$;

grant execute on function public.set_config_sala(uuid, text, boolean) to authenticated;
