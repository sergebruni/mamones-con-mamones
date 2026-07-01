# ROADMAP — Mamones con Mamones

Ideas y mejoras pendientes para el juego. Documento vivo. Ver `HANDOFF.md` para el
estado actual y la arquitectura.

**Regla clave:** todo cambio de juego (gráficas, animaciones, lógica de cartas) va
**tanto a single-player (Phaser, `src/game/`) como a multiplayer (React + Supabase,
`src/ui/OnlineGame.jsx` + RPCs en `supabase/migrations/`)**. Marcamos `[MP]` lo que
solo aplica al online.

Leyenda de esfuerzo/impacto: 🟢 bajo · 🟡 medio · 🔴 alto.

---

## Quick wins (bajo esfuerzo, alto retorno)
- [x] **Pantalla "Cómo jugar"** — modal con reglas + los 6 efectos de la ruleta (`src/ui/ComoJugar.jsx`), abierto desde el botón del menú. ✅
- [ ] **Chat de texto en la sala** `[MP]` — tabla `mensajes` + Realtime. La versión barata del voz-chat. Esfuerzo 🟢 · Impacto 🟡
- [ ] **Reacciones / emotes** sobre las cartas jugadas (👏😂🤢). Esfuerzo 🟢 · Impacto 🟡
- [ ] **Recap de fin de partida** — mejor jugada, quién ganó más rondas, carta más votada (reusa `mesa_juego`). Esfuerzo 🟢 · Impacto 🟡
- [ ] **Optimizar imágenes** — logo ~975KB / favicon ~376KB pesan mucho; generar versiones livianas. Esfuerzo 🟢 · Impacto 🟢

## Profundidad de juego (SP + MP)
- [ ] **Carta en blanco** — el jugador escribe su propia roja esa ronda (estilo Cards Against Humanity). Gran rejugabilidad. Esfuerzo 🟡 · Impacto 🔴
- [ ] **Filtro de categorías** — elegir/excluir mazos por la columna `tipo` (solo Personajes, sin política, etc.) desde el lobby/menú. Esfuerzo 🟡 · Impacto 🟡
- [ ] **Bots más listos (SP)** — hoy juegan y juzgan al azar; darles "personalidad" (preferir cierto `tipo`, elegir por rareza/longitud). Esfuerzo 🟡 · Impacto 🟡
- [ ] **Más modos**: por equipos, doble juez, rondas relámpago. Esfuerzo 🟡 · Impacto 🟡
- [ ] **Mecánicas de remontada** (catch-up) para que no se decida temprano. Esfuerzo 🟡 · Impacto 🟢
- [ ] **Más efectos de ruleta / pool configurable** del Mamón Amargo. Esfuerzo 🟡 · Impacto 🟢

## Social / retención `[MP]`
- [ ] **Cuentas reales** (hoy login anónimo) → perfiles, avatar, estadísticas e historial. Desbloquea casi todo lo de abajo. Esfuerzo 🔴 · Impacto 🔴
- [ ] **Amigos / revancha con el mismo grupo**, salas con nombre. Esfuerzo 🟡 · Impacto 🟡
- [ ] **Leaderboards y logros.** Esfuerzo 🟡 · Impacto 🟡
- [ ] **Modo espectador** para quien llega tarde. Esfuerzo 🟡 · Impacto 🟢
- [ ] **Notificaciones** locales ("es tu turno / eres Juez") y **Web Push** (app cerrada; VAPID + tabla suscripciones + Edge Function + PWA en iOS). Esfuerzo 🟡–🔴 · Impacto 🟡
- [ ] **Chat de voz** — la feature más compleja. Ventaja: Realtime sirve de señalización WebRTC. Difícil: TURN/NAT, iOS, escala de la malla (SFU a 8–10). Prototipo: malla + push-to-talk + STUN. Esfuerzo 🔴 · Impacto 🟡

## Contenido
- [ ] **Packs / expansiones** (regionales: zuliano, oriental…; temporales: navidad, elecciones). Esfuerzo 🟡 · Impacto 🟡
- [ ] **Cartas de la comunidad** (envío + moderación). Esfuerzo 🔴 · Impacto 🟡
- [ ] **Curar el mazo** con datos de qué cartas ganan más (requiere analytics). Esfuerzo 🟢 · Impacto 🟡

## Salud técnica
- [ ] **Analytics (PostHog)** — instrumentar: dónde abandonan, qué efectos gustan, qué cartas ganan más. Guía todo lo demás. Esfuerzo 🟢 · Impacto 🟡
- [ ] **Code-splitting de Phaser** — el bundle son ~1.9MB y los jugadores de solo-online cargan Phaser sin usarlo. Esfuerzo 🟡 · Impacto 🟡
- [ ] **Tests** — no hay ninguno; unos pocos sobre las funciones SQL (descarte/no-repetición/piensa rápido) evitarían regresiones. Esfuerzo 🟡 · Impacto 🟡
- [ ] **Anti-trampa de presencia** — un solo "coordinador" reporta conectados. Esfuerzo 🟡 · Impacto 🟢
- [ ] **SP 7–8 jugadores** — hoy el single-player permite 4–6 (espacio en pantalla); las metas 5/4 son solo del online. Esfuerzo 🟡 · Impacto 🟢

---

## Orden sugerido
1. **"Cómo jugar" + Chat de texto** — baratos; mejoran onboarding y lo social.
2. **Analytics** — para decidir el resto con datos.
3. **Carta en blanco** o **filtro de categorías** — la mejora de juego con más retorno.
4. Salto grande: **cuentas + stats** (habilita amigos/leaderboards/notificaciones).
