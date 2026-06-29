# 🍈 Mamones con Mamones

Versión criolla (jerga venezolana) del clásico *Manzanas con Manzanas* / *Apples to Apples*.
El Juez revela una **carta verde** (adjetivo) y los demás juegan una **carta roja** (sustantivo/personaje/dicho)
que mejor le pegue. Incluye **single-player** (contra bots, en Phaser) y **multijugador en línea** (salas en
tiempo real con Supabase).

## Stack

- **Vite + React** (SPA estática).
- **Phaser 3** para el tablero single-player.
- **Supabase** (Postgres + RLS + RPC + Realtime + Auth anónima) como backend del multijugador.
- Gestor de paquetes: **bun** (también funciona con npm).

## Desarrollo local

```bash
bun install
cp .env.example .env      # rellena la publishable key
bun run dev               # http://localhost:8000
bun run build             # build de producción a dist/
```

### Variables de entorno (`.env`)

Claves **públicas** (se incrustan en el bundle; no hay secretos de servidor en el front):

```
VITE_SUPABASE_URL=https://<tu-proyecto>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

## Backend (Supabase)

1. En el proyecto de Supabase, **SQL Editor** → ejecutar las migraciones **en orden**:
   ```
   supabase/migrations/0001_cartas_y_lobby.sql      # tablas + lobby (RPC crear/unirse)
   supabase/migrations/0002_seed_cartas.sql         # siembra de cartas (generado)
   supabase/migrations/0003_gameplay.sql            # repartir/jugar/juez/siguiente ronda
   supabase/migrations/0004_config_sala.sql         # el host elige modo y "piensa rápido"
   supabase/migrations/0005_pulido.sql              # revancha + estado en vivo
   supabase/migrations/0006_desconexion.sql         # desconexión/abandono + migración de host
   supabase/migrations/0007_timeout.sql             # reloj por fase + resolución automática
   supabase/migrations/0008_amarga.sql              # modo Amargo + Ruleta del Mamón Amargo
   supabase/migrations/0009_piensa_rapido.sql       # modo Piensa Rápido
   ```
2. **Authentication → Sign In / Providers** → activar **Anonymous sign-ins**.
3. Copiar la **publishable key** (`Project Settings → API`) al `.env`.

> Autoridad **server-side**: los clientes nunca escriben las tablas de juego; solo invocan funciones RPC
> (`SECURITY DEFINER`) validadas. La información oculta (manos, autoría de jugadas) está protegida por **RLS**.

## Contenido: las cartas

Fuente de verdad para repartir: la tabla `public.cartas` (en Supabase). Flujo de autoría:

1. Se redactan en **Google Sheets** y se exporta a CSV:
   - `cartas.csv` → mazo **Rojo** (respuestas), columnas: `INDICE, COLOR, TIPO, TEXTO, FLAVOR`.
   - `db/verdes.csv` → mazo **Verde** (adjetivos-prompt), columnas: `tipo, texto, flavor`.
2. Generar el seed:
   ```bash
   bun scripts/gen-cartas.mjs        # produce supabase/migrations/0002_seed_cartas.sql
   ```
3. Re-ejecutar `0002_seed_cartas.sql` en Supabase (usa *upsert*: no duplica, actualiza flavors).

Cada carta tiene `color` (verde/roja), `tipo` (categoría libre → "Otros" si vacía), `texto` y `flavor`.

## Modos de juego

- **Clásico** — el Juez elige la mejor carta.
- **Amargo** 🍋 — el Juez elige **la mejor y la peor**; el de la peor gira **La Ruleta del Mamón Amargo**
  (efecto decidido en el servidor): 👀 pela el ojo · 🥶 mano congelada · 🌪️ mazo barajado · ⏳ a ciegas ·
  🤢 pasa el mamón · 🃏 jugada doble.
- **Piensa Rápido** ⚡ (toggle, combinable) — el **último** en jugar su carta queda fuera esa ronda
  (se le devuelve a la mano).

Meta de cartas verdes para ganar según jugadores: **4→8, 5→7, 6→6, 7→5, 8–10→4**. Mínimo **4** para empezar.

## Multijugador en tiempo real

Sobre **Supabase Realtime**:
- **Presence** → quién está conectado / migración de host / detección de desconexión.
- **Postgres Changes** → estado público de la partida (fase, ronda, marcador, jugadas reveladas).
- **RPC** → todas las acciones (crear/unirse/jugar/juzgar/ruleta/…) validadas en el servidor.

Robustez incluida: reconexión a media partida (persistida en `localStorage`), migración de host,
y **timeout** por fase (auto-jugar / auto-elegir / auto-avanzar) para que nunca se trabe.

## Estructura

```
index.html                 # entrada Vite
src/
  main.jsx, App.jsx         # arranque React + ruteo de pantallas
  index.css
  lib/    supabase.js sfx.js
  ui/     Menu, Lobby, OnlineGame (+ .css)        # menú y multijugador (React)
  game/   PhaserGame.jsx, config.js               # single-player (Phaser)
          scenes/ Preloader.js, GameScene.js
          data/   cards.js, cartas.json
public/assets/             # plantillas de cartas (PNG)
supabase/migrations/       # SQL (correr en orden en el SQL Editor)
scripts/gen-cartas.mjs     # CSV → seed SQL
cartas.csv, db/verdes.csv  # contenido exportado del Sheet
```

## Deploy (Cloudflare Pages)

1. Subir el repo a GitHub.
2. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git**.
3. Build settings:
   - Build command: `bun run build` (o `npm run build`)
   - Output directory: `dist`
4. Environment variables: `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`.
5. Deploy → URL `*.pages.dev`. Cada `git push` redepliega.

El archivo `public/_redirects` ya incluye el fallback SPA. Supabase no requiere cambios (Realtime y
auth anónima funcionan desde cualquier dominio).

## Scripts

| Comando | Qué hace |
|---|---|
| `bun run dev` | Servidor de desarrollo (puerto 8000) |
| `bun run build` | Build de producción a `dist/` |
| `bun run preview` | Sirve el build |
| `bun scripts/gen-cartas.mjs` | Regenera el seed de cartas desde los CSV |
