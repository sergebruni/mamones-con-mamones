-- Mamones con Mamones — Lote 10: Realtime más fiable.
-- Con RLS activa, los eventos UPDATE/DELETE de postgres_changes necesitan la fila
-- completa para evaluar las políticas; REPLICA IDENTITY FULL lo asegura.

alter table public.salas           replica identity full;
alter table public.jugadores_sala  replica identity full;
alter table public.mesa_juego      replica identity full;
alter table public.cartas_mano     replica identity full;
