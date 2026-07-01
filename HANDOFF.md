# HANDOFF — Mamones con Mamones (estado del proyecto)

Documento para retomar el proyecto en una nueva sesión. Resume qué es, cómo corre, qué está hecho, los “gotchas”, y lo pendiente.

## Qué es
Versión criolla de *Manzanas con Manzanas* (Apples to Apples) con jerga venezolana.
- **Single-player** contra bots: hecho en **Phaser 3** (`src/game/`).
- **Multijugador en línea**: hecho en **React + Supabase** (`src/ui/Lobby.jsx`, `src/ui/OnlineGame.jsx`). Es lo que más se ha desarrollado y pulido.

## Infra / cuentas
- **Repo:** github.com/sergebruni/mamones-con-mamones (branch `master`).
- **Deploy:** Cloudflare (flujo **Workers**, no Pages). `wrangler.jsonc` sirve `dist/` como assets estáticos con fallback SPA. Build command `bun run build`, deploy `npx wrangler deploy`. Cada push a master redepliega.
- **Supabase:** proyecto `hmptndzxaaoghmioeokc`. **Anonymous sign-ins** activado. Nuevas API keys (publishable/secret); usamos la **publishable** en el front.
- **Env** (`.env`, gitignored; `.env.example` con placeholders): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
- **PWA**: instalable (vite-plugin-pwa, SW autoUpdate, íconos en `public/icons/` generados con `scripts/gen-icons.mjs`).

## Stack y estructura
- Vite + React + Phaser 3 + Supabase. Gestor: **bun**.
- `src/main.jsx`, `src/App.jsx` (pantallas: menu / sp / lobby).
- `src/ui/Menu.jsx` — menú principal (botón Multijugador beta).
- `src/ui/Lobby.jsx` — lobby online: crear/unirse, **presencia**, **config de sala** (modo, cartas-para-ganar, piensa rápido), **reconexión** (localStorage `mcm_room`), migración de host, **invitar/compartir** (Web Share API + fallback a portapapeles; enlace profundo `?sala=CÓDIGO`).
- `src/ui/OnlineGame.jsx` — **tablero online** (React/HTML reutilizando el arte de las cartas). Renderiza estado remoto + intenciones por RPC. Realtime + **polling de respaldo cada 3s**.
- `src/lib/supabase.js` — cliente singleton, `ensureAuth()` (login anónimo + `realtime.setAuth`).
- `src/lib/sfx.js` — sonidos con Web Audio (tic ruleta/reloj, ding); botón mute.
- `src/game/` — single-player Phaser (`config.js`, `scenes/GameScene.js`, `Preloader.js`, `data/cards.js`, `data/cartas.json`).

## Cartas (contenido)
- Fuente de verdad para repartir: tabla `public.cartas` en Supabase (columnas: `color` verde/roja, `tipo` = categoría libre → "Otros" si vacía, `texto`, `flavor`).
- Autoría en **Google Sheets** → export a **`cartas.csv`** (rojas: `INDICE,COLOR,TIPO,TEXTO,FLAVOR`) y **`db/verdes.csv`** (verdes: `tipo,texto,flavor`).
- Generar seed: `bun scripts/gen-cartas.mjs` → escribe `supabase/migrations/0002_seed_cartas.sql` (upsert). Luego correr ese SQL en Supabase.

## Arquitectura multijugador
- **Autoridad server-side:** funciones RPC `SECURITY DEFINER` + **RLS**. Los clientes NUNCA escriben las tablas de juego; solo invocan RPCs validadas.
- **Tablas:** `salas`, `jugadores_sala`, `cartas_mano` (RLS: solo tu mano), `mesa_juego` (anónima hasta `resultado`).
- **Realtime:** Presence (conectados, host, desconexión) + postgres_changes (estado público). `REPLICA IDENTITY FULL` en las tablas. **Polling 3s** como red de seguridad.
- **Timeouts:** el cliente llama `resolver_timeout` cada 3s; **el servidor decide** con su reloj (`now() >= fase_hasta`). Fases: jugando 60s / juzgando 45s / resultado 25s (trigger + set explícito en `avanzar_ronda`).

## Reglas del juego (estado actual)
- **Mínimo 4 jugadores** para iniciar. Meta de cartas verdes para ganar: configurable (`config.meta`) o **automática**: 4→8, 5→7, 6→6, 7→5, 8–10→4.
- **Modo Clásico:** el Juez elige la mejor.
- **Modo Amargo:** el Juez elige **mejor y peor**; el de la peor gira **La Ruleta del Mamón Amargo** (efecto decidido en server). Efectos: 1 👀 pela_el_ojo, 2 🥶 mano_congelada, 3 🌪️ mazo_barajado (inmediato), 4 ⏳ jugar_a_ciegas, 5 🤢 pasa_mamon (transfiere), 6 🃏 jugada_doble. **El 2 (congelada) solo entra al sorteo si Piensa Rápido está activo.**
- **Piensa Rápido** (toggle, **solo con >5 jugadores**): el último en jugar pierde su carta esa ronda; **excepción: si todos juegan en <5s, nadie pierde**.
- **Timeout jugando:** los que no enviaron pierden el chance; el Juez juzga las enviadas; 1 carta = gana; 0 = se salta la ronda.
- **Timeout juzgando:** se salta la ronda, rota el Juez y el **ex-juez pierde su próximo envío** (`penalizado_uid` → `cartas_a_jugar=0`, `efecto_ronda='sin_turno'`).
- Efectos por jugador en `jugadores_sala`: `efecto_activo` (pendiente próxima ronda), `efecto_ronda` (activo esta ronda, lo lee el cliente), `congelado_hasta`, `cartas_a_jugar`.

## Migraciones (correr en orden en el SQL Editor)
- 0001 cartas + lobby (crear/unirse). 0002 seed cartas (generado).
- 0003 jugabilidad (repartir/jugar/juez/siguiente). 0004 config sala. 0005 revancha + jugaron_uids.
- 0006 desconexión/abandono + migración host. 0007 timeout (trigger fase_hasta).
- 0008 modo Amargo + Ruleta. 0009 Piensa Rápido. 0010 REPLICA IDENTITY FULL.
- 0011 fix mesa_actual (salas.id ambiguo). 0012 reglas (timeouts/meta/piensa>5). 0013 deadline fresco.
- 0014 fix rowtype (escalares). 0015 resolver_timeout escalar.
- **0016 ensure_schema** (idempotente: re-asegura TODAS las columnas + recrea funciones de ronda; correr esto deja todo consistente).
- **0017 ruleta_congelada**: congelar solo con Piensa Rápido.
- **0018 descarte_rojas** (último): descarte de rojas por partida (`salas.mazo_rojo`). Una carta jugada/descartada NO reaparece en ninguna mano hasta que termina la partida; `repartir_mano` excluye manos + mesa + descarte y recicla el descarte si el mazo se agota. Índice único `cartas_mano(sala_id,carta)` como garantía dura. **Correr en Supabase para que aplique.**

## Gotchas aprendidos (importantes)
- **pgbouncer + rowtype cacheado:** funciones con `select * into v_sala salas` y luego `v_sala.<columna_nueva>` fallan con *“record has no field …”* tras agregar columnas. **Fix:** leer la columna nueva como **escalar** (`select col into v_x ...`). Ya aplicado en cerrar_jugadas/avanzar_ronda/resolver_timeout.
- **“column X does not exist”** = el `ALTER ADD COLUMN` no aplicó → correr `0016` (idempotente).
- Tras DDL, a veces hay que **`notify pgrst, 'reload schema'`** (PostgREST cachea funciones; pasó con `set_config_sala`).
- El **service worker** (PWA) cachea; tras un deploy hay que **recargar** para tomar la versión nueva.
- No commiteamos `CLAUDE.md` (es de otro proyecto, Urrieta's; queda sin trackear).

## Cómo correr local
```
bun install
cp .env.example .env   # poner la publishable key
bun run dev            # http://localhost:8000
bun run build
```

## Pendiente / ideas (no hechas)
- **Notificaciones**: solo se hizo PWA instalable. Faltan notificaciones **locales** (es tu turno / eres juez) y **Web Push** (app cerrada; requiere VAPID + tabla de suscripciones + Edge Function + en iOS PWA instalada).
- **Single-player 7–8 jugadores:** hoy el SP permite 4–6 (para que las jugadas quepan en pantalla); las metas 5/4 (7–8 jug.) siguen siendo solo del online.
- **Chat de voz (posible mejora):** la feature más compleja. Ventaja: ya usamos Supabase Realtime → su canal *broadcast* sirve de **señalización** WebRTC gratis. Lo difícil se concentra en: (1) **NAT traversal/TURN** — STUN gratis cubre ~80–85%, el resto necesita TURN (servidor `coturn` propio o servicio de pago); (2) **iOS/PWA** (permisos de micrófono, autoplay, audio en background); (3) **escala de la malla P2P** — bien a 4–6 jugadores, pesada a 8–10 (ahí conviene un SFU como LiveKit/Daily/Agora). Plan sugerido: prototipo **malla + push-to-talk + señalización por Realtime + solo STUN** para validar a 4–6, y si funciona agregar TURN. Alternativa barata previa: **chat de texto** (tabla `mensajes` + Realtime, ~medio día).
- Endurecer anti-trampa de presencia (un solo “coordinador” reporta conectados).
- Llevar el flavor/long-press y otros detalles también al single-player si se desea.

## Hecho recientemente
- **Animación al jugar carta (SP + MP):** la carta seleccionada vuela en **arco** hasta el centro y **aterriza visible en un montoncito** que crece con las jugadas (la tuya boca arriba, las del rival boca abajo); se reparte al pasar a juzgar. SP: capa `animLayer`, `animateToPile` (curva QuadraticBezier), `dropBotCardToPile`, `clearPile`. MP: clon `.og__fly` con keyframes en arco + montoncito `.og__pile` (tuyas desde `myPlayed`, rivales desde `jugaron`). Solo se anima el vuelo de la carta propia (las del rival son anónimas). Regla viva: todo cambio de juego va a ambos motores → ver memoria [[paridad-sp-mp]].
- **Single-player a paridad con el online** (`src/game/scenes/GameScene.js` + `src/ui/Menu.jsx`): jugadores configurables **4–6** (tú + bots), **meta automática** por nº de jugadores (`metaGanar`: 4→8, 5→7, 6→6), **Piensa Rápido** (último en jugar pierde la carta; excepción si todos <5s; solo con >5 jug.), **🥶 excluida de la ruleta sin Piensa Rápido** y **rueda visual dinámica** (5/6 sectores), y **descarte de rojas** (una carta jugada no reaparece; `redDiscard`, se recicla al agotarse; `mazoBarajado` descarta la mano). Timeouts NO se portan (no hay humanos remotos). Menú: selector de jugadores + gate de Piensa Rápido. Falta **playtest visual**.

## Hecho recientemente (sin commitear aún)
- **Rueda visual dinámica:** la Ruleta del Mamón Amargo ahora muestra 5 ó 6 sectores según *Piensa Rápido* (antes mostraba siempre 6 con 🥶 aunque estuviera excluida). Sectores y `conic-gradient` se calculan en JS (`efectosRuleta`, `COLOR_EFECTO`, `ruletaBg`) y el aterrizaje se calcula por índice en la lista activa (`OnlineGame.jsx`). Para 6 efectos es idéntico a antes.
- **Invitar/compartir sala:** botón en el lobby (Web Share API con fallback a portapapeles) que comparte un enlace `?sala=CÓDIGO`; `App.jsx` lee el parámetro al cargar, entra al lobby y precarga el código (la invitación tiene prioridad sobre la reconexión automática).
- **500 cartas rojas nuevas:** generadas en `db/rojas-500.csv` y **anexadas a `cartas.csv`** (INDICE 161–660; se quitaron 490 placeholders vacíos del Sheet). Seed regenerado (`0002_seed_cartas.sql`: **659 rojas + 50 verdes**). El mazo tenía un duplicado propio previo ("El bachaquero de la esquina", INDICE 11 y 69) que el dedupe del seed eliminó solo. **Falta correr el SQL `0002` en Supabase** para aplicarlo.

## Último commit relevante
`0017_ruleta_congelada` — “Mano congelada” solo aparece en la ruleta con Piensa Rápido activo.
