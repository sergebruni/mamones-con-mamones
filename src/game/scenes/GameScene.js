// Escena principal de "Mamones con Mamones".
// Maneja el ciclo completo de una ronda:
//   1) Se revela una carta VERDE (adjetivo).
//   2) Cada jugador que NO es Juez juega una carta ROJA (el humano hace clic; los bots eligen solos).
//   3) El Juez (rota cada ronda) elige la roja ganadora.
//   4) El ganador suma un punto, se reponen las manos y rota el Juez.
//
// El layout es RESPONSIVE: todas las posiciones y tamaños se calculan en
// computeLayout() a partir del tamaño actual de la pantalla, y se recalculan
// en handleResize() cuando la ventana cambia de tamaño u orientación.
import Phaser from "phaser";
import { GameData } from "../data/cards.js";

const HAND_SIZE = 7;
const CARD_RATIO = 1264 / 848; // alto/ancho de las plantillas (verticales).

// Meta de puntos para ganar, según cantidad de jugadores (igual que el online).
function metaGanar(n) {
  if (n >= 8) return 4;
  if (n === 7) return 5;
  if (n === 6) return 6;
  if (n === 5) return 7;
  return 8; // 4 jugadores (mínimo)
}

// Color de cada sector de la ruleta, por número de efecto (1..6).
const RULETA_COLORS = [0xffd35c, 0x8a1c10, 0x2e8b2e, 0xe08a1c, 0x3a6ea5, 0x6b3fa0];

// Paleta de la mesa.
const COLORS = {
  feltTop: 0x1f4d2e,
  feltBottom: 0x10301d,
  panel: 0x0c2114,
  panelBorder: 0x2e6b45,
  gold: 0xffd35c,
  goldHex: "#ffd35c",
  textLight: "#eaf5ec",
  textMuted: "#9fd6a3",
  dark: "#16331f",
};

const TITLE_GREEN = "#173a17"; // verde oscuro para la verde
const TITLE_RED = "#8a1c10"; // rojo oscuro para las amarillas

// Las 6 opciones de "La Ruleta del Mamón Amargo" (modo Amarga).
const RULETA_EFFECTS = {
  1: {
    key: "pelaElOjo",
    emoji: "👀",
    name: "Pela el ojo",
    desc: "Tu mano queda boca abajo. Mantén pulsada una carta para espiarla; doble clic para jugarla de memoria.",
  },
  2: {
    key: "manoCongelada",
    emoji: "🥶",
    name: "Mano congelada",
    desc: "No podrás jugar durante los primeros 10 segundos de tu turno.",
  },
  3: {
    key: "mazoBarajado",
    emoji: "🌪️",
    name: "Mazo barajado",
    desc: "¡Adiós a tu mano! Se devuelve al mazo y recibes 7 cartas nuevas al azar.",
  },
  4: {
    key: "jugarACiegas",
    emoji: "⏳",
    name: "A ciegas",
    desc: "Eliges tu carta amarilla ANTES de que se revele el adjetivo verde.",
  },
  5: {
    key: "pasaMamon",
    emoji: "🤢",
    name: "Pasa el mamón amargo",
    desc: "¡Salvado! Pásale la ruleta a otro jugador (gira de inmediato).",
  },
  6: {
    key: "jugadaDoble",
    emoji: "🃏",
    name: "Jugada doble",
    desc: "Ventaja: esta ronda juegas DOS cartas amarillas en vez de una.",
  },
};

export default class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: "GameScene" });
  }

  init() {
    this.greenDeck = [];
    this.redDeck = [];
    this.players = [];
    this.currentGreen = null;
    this.submissions = []; // [{ playerIndex, card }]
    this.judgeIndex = 0;
    this.phase = "play"; // play | judging | result | gameover
    this.lastResult = null; // { winnerIndex, card }
    this.round = 1;

    // --- Modo Amarga + Ruleta del Mamón Amargo ---
    this.playerEffects = []; // efectos activos por jugador
    this.judgingStep = null; // null (clásica) | "best" | "worst"
    this.bestPick = null; // jugada elegida como mejor (amarga)
    this.worstResult = null; // { loserIndex, card }
    this.pendingRoulette = null; // datos de la ruleta en curso
    this.rouletteLayer = null; // overlay animado (independiente de this.ui)
    this.rouletteWheel = null;
    this._rouletteGeom = null;
    this.playsNeeded = []; // cartas que debe jugar cada jugador esta ronda
    // Flags de efectos en curso para el turno del humano:
    this.handFrozen = false;
    this.greenRevealed = true;
    this.humanPlaysNeeded = 1;
    this.fx = { pelaElOjo: false, manoCongelada: false, jugarACiegas: false, jugadaDoble: false };
    this._lastTapTime = 0;
    this._lastTapIndex = -1;

    // Descarte de rojas de la partida (una carta jugada no reaparece hasta reiniciar).
    this.redDiscard = new Set();
    this.roundStartMs = 0;
    this.piensaRapidoVictim = null; // índice del castigado por Piensa Rápido esta ronda
    this._animatingPlay = false; // bloquea jugar mientras una carta vuela al centro
    this._pile = []; // cartas visibles en el montoncito del centro
    this._pileCount = 0; // huecos usados del montoncito (para el desorden)
  }

  create() {
    this.computeLayout();

    // Generar versiones de las plantillas con esquinas redondeadas (una sola vez).
    this.greenTex = this.ensureRoundedTexture("plantillaVerde", "plantillaVerdeRound", 0.1);
    this.redTex = this.ensureRoundedTexture("plantillaAmarilla", "plantillaAmarillaRound", 0.1);

    // Capa estática (fondo + cabecera) detrás de la capa dinámica (ui).
    this.staticLayer = this.add.container(0, 0);
    this.ui = this.add.container(0, 0);
    this.animLayer = this.add.container(0, 0); // cartas volando al centro (sobre la UI)
    this.drawStatic();

    this.setupGame();
    this.setupHandScrollInput();
    this.startRound();

    // Reorganizar todo cuando cambie el tamaño de la ventana / orientación.
    this.scale.on("resize", this.handleResize, this);
    this.events.once("shutdown", () => this.scale.off("resize", this.handleResize, this));
  }

  // Entrada para desplazar la mano horizontalmente (arrastre + rueda del ratón).
  // Se registra una sola vez; opera solo en la fase "play" si hay scroll activo.
  setupHandScrollInput() {
    const canScroll = () =>
      this.phase === "play" && this.handScroll && this.handScroll.enabled && this.handContainer;

    this.input.on("pointerdown", (p) => {
      if (!canScroll() || !this.inHandBand(p)) return;
      this._dragging = true;
      this._handDragged = false;
      this._dragStartX = p.x;
      this._dragStartScroll = this.handContainer.x;
      this._lastPointerX = p.x;
      this._handVel = 0; // agarrar detiene la inercia
    });

    this.input.on("pointermove", (p) => {
      if (!this._dragging || !this.handContainer) return;
      const dx = p.x - this._dragStartX;
      if (Math.abs(dx) > 6) this._handDragged = true; // distinguir arrastre de toque
      // Velocidad instantánea (px por movimiento) para la inercia al soltar.
      this._handVel = p.x - this._lastPointerX;
      this._lastPointerX = p.x;
      this.handContainer.x = Phaser.Math.Clamp(
        this._dragStartScroll + dx,
        this.handScroll.min,
        this.handScroll.max
      );
      this.updateScrollThumb();
    });

    this.input.on("pointerup", () => {
      this._dragging = false;
      // Limitar el "fling" inicial para que no se dispare demasiado rápido.
      this._handVel = Phaser.Math.Clamp(this._handVel || 0, -60, 60);
    });

    this.input.on("wheel", (p, objs, dx, dy) => {
      if (!canScroll()) return;
      this.handContainer.x = Phaser.Math.Clamp(
        this.handContainer.x - (dy || dx),
        this.handScroll.min,
        this.handScroll.max
      );
      this.updateScrollThumb();
    });
  }

  inHandBand(p) {
    return this.handBand && p.y >= this.handBand.top && p.y <= this.handBand.bottom;
  }

  handleResize() {
    this.computeLayout();
    this.drawStatic();
    if (this.players && this.players.length) this.render();
  }

  // Bucle de Phaser: aplica la inercia del scroll de la mano tras soltar.
  update(time, delta) {
    if (this._dragging || this.phase !== "play") return;
    if (!this.handContainer || !this.handScroll || !this.handScroll.enabled) return;
    if (!this._handVel || Math.abs(this._handVel) < 0.4) return;

    const step = this._handVel * (delta / 16.67); // independiente de los FPS
    const before = this.handContainer.x;
    this.handContainer.x = Phaser.Math.Clamp(
      before + step,
      this.handScroll.min,
      this.handScroll.max
    );

    if (this.handContainer.x === before) {
      this._handVel = 0; // llegó a un tope
    } else {
      this._handVel *= 0.93; // fricción
      if (Math.abs(this._handVel) < 0.4) this._handVel = 0;
    }
    this.updateScrollThumb();
  }

  // Calcula tamaños y anclas verticales según el tamaño actual de la pantalla.
  computeLayout() {
    this.W = this.scale.width;
    this.H = this.scale.height;

    this.isPortrait = this.H > this.W;

    // Escala global de la UI (fuentes, paneles) según el ancho.
    this.uiScale = Phaser.Math.Clamp(this.W / 1280, 0.75, 1.15);

    // Tamaño de carta: cómodo según la pantalla. Ya NO hace falta que entren las
    // 7 a lo ancho (la mano tiene scroll), así que en retrato son más grandes.
    this.handGap = Math.max(8, this.W * 0.012);
    const heightFrac = this.isPortrait ? 0.2 : 0.26; // alto máx. relativo a la pantalla
    const widthShareFrac = this.isPortrait ? 0.42 : 0.28; // ancho máx. de una carta
    const byHeight = (this.H * heightFrac) / CARD_RATIO;
    const byWidthShare = this.W * widthShareFrac;
    this.cardW = Math.max(46, Math.min(byHeight, byWidthShare, 150));
    this.cardH = this.cardW * CARD_RATIO;
    this.cardFont = Math.max(10, Math.round(this.cardW * 0.135));

    // La carta verde es un poco más grande.
    this.greenW = this.cardW * 1.08;
    this.greenH = this.greenW * CARD_RATIO;
    this.greenFont = Math.max(13, Math.round(this.greenW * 0.16));

    // Anclas verticales.
    this.yHeader = Math.max(44, Math.min(56, this.H * 0.085));
    this.yGreen = this.yHeader + this.greenH / 2 + 12;
    this.yStatus = this.yGreen + this.greenH / 2 + this.f(22);
    this.yHand = this.H - this.cardH / 2 - 14;
    this.yButton = this.H - this.f(40);
    // Fila central (jugadas) entre el estado y la zona de la mano.
    this.yCenter = (this.yStatus + this.f(20) + (this.yHand - this.cardH / 2)) / 2;
  }

  // Helper: escala un tamaño de fuente/medida por uiScale.
  f(px) {
    return Math.round(px * this.uiScale);
  }

  // Crea una textura con las esquinas redondeadas a partir de otra, recortando
  // la imagen contra un rectángulo redondeado en un canvas. Devuelve la llave a
  // usar (la redondeada si se pudo crear; si no, la original como respaldo).
  ensureRoundedTexture(srcKey, outKey, radiusFrac) {
    if (this.textures.exists(outKey)) return outKey;

    const src = this.textures.get(srcKey).getSourceImage();
    if (!src || !src.width) return srcKey;

    const w = src.width;
    const h = src.height;
    const canvasTex = this.textures.createCanvas(outKey, w, h);
    if (!canvasTex) return srcKey;

    const ctx = canvasTex.getContext();
    const r = Math.min(w, h) * radiusFrac;

    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, h, r);
    ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(src, 0, 0, w, h);

    canvasTex.refresh(); // sube la textura a la GPU
    return outKey;
  }

  // Fondo estático tipo mesa de fieltro + cabecera (se redibuja al cambiar tamaño).
  drawStatic() {
    this.staticLayer.removeAll(true);

    const bg = this.add.graphics();
    bg.fillGradientStyle(
      COLORS.feltTop,
      COLORS.feltTop,
      COLORS.feltBottom,
      COLORS.feltBottom,
      1
    );
    bg.fillRect(0, 0, this.W, this.H);
    bg.fillStyle(0x000000, 0.18);
    bg.fillRect(0, 0, this.W, 6);
    bg.fillRect(0, this.H - 6, this.W, 6);
    this.staticLayer.add(bg);

    const header = this.add.graphics();
    header.fillStyle(0x000000, 0.25);
    header.fillRect(0, 0, this.W, this.yHeader);
    this.staticLayer.add(header);

    const title = this.add
      .text(this.W / 2, this.yHeader / 2, "🍈 Mamones con Mamones", {
        fontFamily: "Segoe UI, sans-serif",
        fontSize: `${this.f(26)}px`,
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this.staticLayer.add(title);
  }

  // ---------------------------------------------------------------------------
  // Preparación
  // ---------------------------------------------------------------------------

  setupGame() {
    // Config de partida elegida en el menú (modo, piensaRapido, jugadores).
    const cfg = this.registry.get("gameConfig") || {};
    this.mode = cfg.mode || "clasica"; // "clasica" | "amarga"
    // Total de jugadores: tú + bots. Mínimo 4, máximo 6 (como el online, acotado
    // por el espacio en pantalla para las jugadas).
    const total = Phaser.Math.Clamp(cfg.players || 4, 4, 6);
    // Piensa Rápido solo tiene sentido con más de 5 jugadores (regla del online).
    this.piensaRapido = !!cfg.piensaRapido && total > 5;

    // Fuente de cartas: cartas.json (vía registry), con cards.js como respaldo.
    const data = this.registry.get("cartas");
    const verdes = (data && data.verdes) || GameData.greenCards;
    const rojas = (data && data.rojas) || GameData.redCards;
    // Deduplicar por si hay nombres repetidos en la lista.
    this.greenSource = [...new Set(verdes)];
    this.redSource = [...new Set(rojas)];

    // Jugadores: tú + (total-1) bots.
    this.players = [{ name: "Tú", isBot: false, hand: [], score: 0 }];
    for (let i = 1; i < total; i++) {
      this.players.push({ name: `Bot ${i}`, isBot: true, hand: [], score: 0 });
    }

    // Descarte vacío y mazos frescos al empezar la partida.
    this.redDiscard = new Set();
    this.refillGreenDeck();
    this.refillRedDeck();

    // Reparto inicial (sin repetir: drawRed excluye manos y descarte).
    this.players.forEach((p) => {
      while (p.hand.length < HAND_SIZE) p.hand.push(this.drawRed());
    });

    // El primer Juez es un bot, así el humano juega de una en la ronda 1.
    this.judgeIndex = 1;
    this.round = 1;

    // Un objeto de efectos (booleanos) por jugador.
    this.playerEffects = this.players.map(() => this.emptyEffects());
  }

  emptyEffects() {
    return {
      pelaElOjo: false,
      manoCongelada: false,
      mazoBarajado: false,
      jugarACiegas: false,
      pasaMamon: false,
      jugadaDoble: false,
    };
  }

  refillGreenDeck() {
    this.greenDeck = Phaser.Utils.Array.Shuffle([...this.greenSource]);
  }

  // Cartas rojas que ya están en la mano de algún jugador (para no repartirlas).
  redEnManos() {
    const s = new Set();
    this.players.forEach((p) => p.hand.forEach((c) => s.add(c)));
    return s;
  }

  // Reconstruye el mazo rojo con las cartas que NO están en manos ni descartadas.
  // Si no queda ninguna, recicla el descarte (como el online al agotarse el mazo).
  refillRedDeck() {
    const enManos = this.redEnManos();
    let pool = this.redSource.filter((c) => !enManos.has(c) && !this.redDiscard.has(c));
    if (pool.length === 0) {
      this.redDiscard.clear();
      pool = this.redSource.filter((c) => !enManos.has(c));
    }
    this.redDeck = Phaser.Utils.Array.Shuffle(pool);
  }

  drawGreen() {
    if (this.greenDeck.length === 0) this.refillGreenDeck();
    return this.greenDeck.pop();
  }

  drawRed() {
    if (this.redDeck.length === 0) this.refillRedDeck();
    return this.redDeck.pop();
  }

  // ---------------------------------------------------------------------------
  // Ciclo de la ronda
  // ---------------------------------------------------------------------------

  startRound() {
    this.currentGreen = this.drawGreen();
    this.submissions = [];
    this.phase = "play";
    this.lastResult = null;
    this.worstResult = null;
    this.judgingStep = null;
    this.bestPick = null;

    // Reiniciar flags de efectos de la ronda y limpiar timers previos.
    this.clearFreezeTimers();
    this.handFrozen = false;
    this.greenRevealed = true;
    this.humanPlaysNeeded = 1;
    this.piensaRapidoVictim = null;
    this.fx = { pelaElOjo: false, manoCongelada: false, jugarACiegas: false, jugadaDoble: false };

    // Cerrar cualquier overlay de ruleta colgante (seguridad).
    this.closeRoulette(false);
    // Vaciar el montoncito del centro (nueva ronda).
    this.clearPile();

    // Cuántas cartas debe jugar cada jugador esta ronda (Jugada Doble => 2).
    this.playsNeeded = this.players.map(() => 0);

    // Aplicar al humano los efectos de la Ruleta (solo si juega esta ronda).
    if (this.judgeIndex !== 0) {
      this.applyHumanEffects();
      this.playsNeeded[0] = this.humanPlaysNeeded;
    }

    // Bots no-Juez: aplican sus efectos y juegan sus cartas con retraso.
    this.players.forEach((p, i) => {
      if (!p.isBot || i === this.judgeIndex) return;
      const { needed, delay } = this.applyBotEffects(i);
      this.playsNeeded[i] = needed;
      for (let n = 0; n < needed; n++) {
        this.time.delayedCall(delay + 700 + i * 250 + n * 450, () => this.botPlayCard(i));
      }
    });

    // Marca de inicio de la fase de jugadas (ventana de 5s de Piensa Rápido).
    this.roundStartMs = this.time.now;

    // Si el humano es el Juez, no juega carta: solo espera las jugadas de los bots.
    this.render();
  }

  // Aplica al bot sus efectos de la Ruleta (los que tienen sentido para una IA)
  // y los consume. Devuelve cuántas cartas juega y cuánto retraso extra tiene.
  applyBotEffects(i) {
    const e = this.playerEffects[i];
    let needed = 1;
    let delay = 0;
    if (e) {
      if (e.jugadaDoble) needed = 2; // 🃏 juega dos cartas
      if (e.manoCongelada) delay = 3000; // 🥶 el bot "congelado" tarda más
      // 🌪️ mazoBarajado ya se aplicó al instante; 👀/⏳ no afectan a una IA.
      this.playerEffects[i] = this.emptyEffects();
    }
    return { needed, delay };
  }

  // Aplica al humano (índice 0) los efectos de la Ruleta y los consume.
  applyHumanEffects() {
    const e = this.playerEffects[0];
    if (!e) return;

    if (e.pelaElOjo) this.fx.pelaElOjo = true;
    if (e.jugarACiegas) {
      this.fx.jugarACiegas = true;
      this.greenRevealed = false;
    }
    if (e.jugadaDoble) {
      this.fx.jugadaDoble = true;
      this.humanPlaysNeeded = 2;
    }
    if (e.manoCongelada) {
      this.fx.manoCongelada = true;
      this.handFrozen = true;
      this.freezeSeconds = 10;
      this.freezeTick = this.time.addEvent({
        delay: 1000,
        repeat: 9,
        callback: () => {
          this.freezeSeconds -= 1;
          if (this.phase === "play") this.render();
        },
      });
      this.freezeTimer = this.time.delayedCall(10000, () => {
        this.handFrozen = false;
        if (this.phase === "play") this.render();
      });
    }

    // Consumir: los efectos eran para este turno.
    this.playerEffects[0] = this.emptyEffects();
  }

  clearFreezeTimers() {
    if (this.freezeTick) {
      this.freezeTick.remove(false);
      this.freezeTick = null;
    }
    if (this.freezeTimer) {
      this.freezeTimer.remove(false);
      this.freezeTimer = null;
    }
  }

  // Descarta la mano del jugador (no vuelve a repartirse) y le da 7 cartas nuevas.
  redealHand(playerIndex) {
    const p = this.players[playerIndex];
    while (p.hand.length) this.redDiscard.add(p.hand.pop());
    while (p.hand.length < HAND_SIZE) p.hand.push(this.drawRed());
  }

  // IA jugando: el bot elige una carta de su mano (al azar) y la juega.
  botPlayCard(playerIndex) {
    if (this.phase !== "play") return;
    const bot = this.players[playerIndex];
    if (bot.hand.length === 0) return;

    const idx = Phaser.Math.Between(0, bot.hand.length - 1);
    const card = bot.hand.splice(idx, 1)[0];
    this.dropBotCardToPile(); // boca abajo al montoncito (antes de enviar)
    this.submitCard(playerIndex, card);
  }

  humanSubmittedCount() {
    return this.submissions.filter((s) => s.playerIndex === 0).length;
  }

  // El humano juega una carta de su mano.
  humanPlayCard(handIndex) {
    if (this.phase !== "play") return;
    if (this.judgeIndex === 0) return; // El humano es Juez: no juega.
    if (this.handFrozen) return; // 🥶 Mano congelada.
    if (this._animatingPlay) return; // ya hay una carta volando al centro
    if (this.humanSubmittedCount() >= this.humanPlaysNeeded) return; // ya cumplió su cupo

    // ⏳ A ciegas: al confirmar la primera carta se revela el adjetivo verde.
    if (this.fx.jugarACiegas && !this.greenRevealed) this.greenRevealed = true;

    // Posición mundial de la carta tocada, para volarla desde ahí al centro.
    const lx = this.cardW / 2 + handIndex * (this.cardW + this.handGap);
    const fromX = (this.handContainer ? this.handContainer.x : 0) + lx;
    const fromY = this.yHand;

    // Ocultar la carta original y sacarla de la mano (datos) de una vez, para que
    // un re-render durante el vuelo no la muestre de nuevo.
    const orig = this.handContainer && this.handContainer.list[handIndex];
    if (orig) orig.setVisible(false);
    const card = this.players[0].hand.splice(handIndex, 1)[0];

    this._animatingPlay = true;
    const flyer = this.makeRedCard(card);
    flyer.setPosition(fromX, fromY);
    this.animLayer.add(flyer);
    this.animateToPile(flyer, fromX, fromY, () => {
      this._animatingPlay = false;
      this.submitCard(0, card);
    });
  }

  // Posición (relativa al centro) del hueco 'slot' del montoncito: leve desorden.
  pileSlot(slot) {
    return {
      ox: this.f(((slot * 37) % 15) - 7),
      oy: this.f(((slot * 23) % 11) - 5),
      rot: ((slot * 29) % 21) - 10,
    };
  }

  // Vuela 'gameObj' en ARCO desde (fromX, fromY) al montoncito del centro y lo
  // deja ahí (visible). onDone se llama al aterrizar.
  animateToPile(gameObj, fromX, fromY, onDone) {
    const slot = this._pileCount++;
    const { ox, oy, rot } = this.pileSlot(slot);
    const toX = this.W / 2 + ox;
    const toY = this.yCenter + oy;
    const start = new Phaser.Math.Vector2(fromX, fromY);
    const end = new Phaser.Math.Vector2(toX, toY);
    // Punto de control por encima para que el vuelo trace una curva.
    const mid = new Phaser.Math.Vector2((fromX + toX) / 2, Math.min(fromY, toY) - this.f(90));
    const curve = new Phaser.Curves.QuadraticBezier(start, mid, end);
    const prox = { v: 0 };
    this.tweens.add({
      targets: prox,
      v: 1,
      duration: 480,
      ease: "Sine.easeInOut",
      onUpdate: () => {
        const p = curve.getPoint(prox.v);
        gameObj.setPosition(p.x, p.y);
      },
      onComplete: () => {
        gameObj.setPosition(toX, toY);
        this._pile.push(gameObj); // se queda en el montoncito
        onDone && onDone();
      },
    });
    this.tweens.add({
      targets: gameObj,
      scale: 0.7,
      angle: rot,
      duration: 480,
      ease: "Sine.easeInOut",
    });
  }

  // Coloca una carta boca abajo (jugada de un bot) en el montoncito.
  dropBotCardToPile() {
    const slot = this._pileCount++;
    const { ox, oy, rot } = this.pileSlot(slot);
    const back = this.makeCardBack(this.cardW, this.cardH);
    back.setPosition(this.W / 2 + ox, this.yCenter + oy);
    back.setAngle(rot);
    back.setScale(0.55);
    this.animLayer.add(back);
    this._pile.push(back);
    this.tweens.add({ targets: back, scale: 0.7, duration: 200, ease: "Back.easeOut" });
  }

  // Limpia el montoncito del centro (al empezar la ronda o al pasar a juzgar).
  clearPile() {
    (this._pile || []).forEach((o) => this.tweens.killTweensOf(o));
    if (this.animLayer) this.animLayer.removeAll(true);
    this._pile = [];
    this._pileCount = 0;
  }

  submitCard(playerIndex, card) {
    this.submissions.push({ playerIndex, card, at: this.time.now });

    // ¿Ya jugaron todos? (con Jugada Doble alguien debe 2 cartas)
    const expected = this.playsNeeded.reduce((a, b) => a + b, 0);

    if (this.submissions.length >= expected) {
      this.beginJudging();
    } else {
      this.render();
    }
  }

  hasSubmitted(playerIndex) {
    return this.submissions.some((s) => s.playerIndex === playerIndex);
  }

  // Piensa Rápido: castiga al último en jugar si la ronda tardó ≥5s. Le devuelve
  // su carta a la mano y la saca de las jugadas. Requiere ≥2 jugadores distintos.
  aplicarPiensaRapido() {
    this.piensaRapidoVictim = null;
    if (!this.piensaRapido || this.submissions.length < 2) return;
    const distintos = new Set(this.submissions.map((s) => s.playerIndex)).size;
    if (distintos < 2) return;
    const ultimaMs = Math.max(...this.submissions.map((s) => s.at || 0));
    if (ultimaMs - this.roundStartMs < 5000) return; // todos rápidos: nadie pierde

    let li = 0;
    for (let i = 1; i < this.submissions.length; i++) {
      if ((this.submissions[i].at || 0) > (this.submissions[li].at || 0)) li = i;
    }
    const late = this.submissions.splice(li, 1)[0];
    this.players[late.playerIndex].hand.push(late.card); // la carta vuelve a su mano
    this.piensaRapidoVictim = late.playerIndex;
  }

  beginJudging() {
    // Piensa Rápido: si se tardaron, el último en jugar pierde su carta (vuelve a
    // su mano). Excepción: si todos jugaron en <5s, no se castiga a nadie.
    this.aplicarPiensaRapido();

    this.clearPile(); // el montoncito se reparte para juzgar

    this.phase = "judging";
    // Se mezclan las jugadas para que el Juez las vea de forma anónima.
    Phaser.Utils.Array.Shuffle(this.submissions);
    // En Amarga el Juez elige primero la MEJOR y luego la PEOR.
    this.judgingStep = this.mode === "amarga" ? "best" : null;
    this.bestPick = null;

    if (this.players[this.judgeIndex].isBot) this.scheduleBotBest();
    this.render();
  }

  scheduleBotBest() {
    this.time.delayedCall(1100, () => {
      if (this.phase !== "judging") return;
      this.judgePick(Phaser.Math.Between(0, this.submissions.length - 1));
    });
  }

  // Punto de entrada del Juez (humano o bot) al elegir una jugada.
  judgePick(submissionIndex) {
    if (this.phase !== "judging") return;

    // Clásica: una sola elección (la mejor).
    if (this.mode !== "amarga") {
      this.awardBest(submissionIndex);
      this.finishJudging();
      return;
    }

    // Amarga: paso "mejor" y luego paso "peor".
    if (this.judgingStep === "best") {
      this.bestPick = this.submissions[submissionIndex];
      this.awardBest(submissionIndex);
      this.judgingStep = "worst";

      if (this.players[this.judgeIndex].isBot) {
        this.time.delayedCall(900, () => {
          if (this.phase !== "judging" || this.judgingStep !== "worst") return;
          this.judgeWorst(this.worstSelectableIndices()[0]);
        });
      }
      this.render();
    } else if (this.judgingStep === "worst") {
      if (this.submissions[submissionIndex] === this.bestPick) return; // no re-elegir la mejor
      this.judgeWorst(submissionIndex);
    }
  }

  awardBest(submissionIndex) {
    const best = this.submissions[submissionIndex];
    this.players[best.playerIndex].score += 1;
    this.lastResult = { winnerIndex: best.playerIndex, card: best.card };
  }

  worstSelectableIndices() {
    return this.submissions
      .map((_, i) => i)
      .filter((i) => this.submissions[i] !== this.bestPick);
  }

  judgeWorst(submissionIndex) {
    const worst = this.submissions[submissionIndex];
    if (!worst) { this.finishJudging(); return; } // sin peor válida: sigue sin ruleta
    this.worstResult = { loserIndex: worst.playerIndex, card: worst.card };
    this.finishJudging();
    // El jugador de la peor carta gira la Ruleta del Mamón Amargo.
    if (this.phase === "result") this.activarRuletaMamonAmargo(worst.playerIndex);
  }

  finishJudging() {
    const winner = this.players[this.lastResult.winnerIndex];
    this.phase = winner.score >= metaGanar(this.players.length) ? "gameover" : "result";
    this.render();
  }

  // ---------------------------------------------------------------------------
  // La Ruleta del Mamón Amargo
  // ---------------------------------------------------------------------------

  // Elige al azar uno de los 6 efectos, lo activa para el jugador y lo anuncia.
  activarRuletaMamonAmargo(playerIndex, depth = 0) {
    // Efectos que entran al sorteo. "Mano congelada" (2) solo con Piensa Rápido.
    const efectos = this.piensaRapido ? [1, 2, 3, 4, 5, 6] : [1, 3, 4, 5, 6];
    const rand = () => efectos[Phaser.Math.Between(0, efectos.length - 1)];
    let pick = rand();
    // Corta cadenas infinitas de "pasa el mamón".
    while (pick === 5 && depth >= 3) pick = rand();

    const fx = RULETA_EFFECTS[pick];
    this.playerEffects[playerIndex][fx.key] = true;

    // Efecto inmediato: barajar la mano ya mismo.
    if (fx.key === "mazoBarajado") this.redealHand(playerIndex);

    this.pendingRoulette = {
      playerIndex,
      pick,
      fx,
      depth,
      efectos,
      transfer: fx.key === "pasaMamon",
    };
    this.showRoulette(); // anima la rueda y al detenerse revela el efecto
  }

  nextRound() {
    // Descartar las cartas jugadas: no vuelven a ninguna mano en esta partida.
    this.submissions.forEach((s) => this.redDiscard.add(s.card));
    // Reponer manos hasta HAND_SIZE (drawRed excluye manos y descarte).
    this.players.forEach((p) => {
      while (p.hand.length < HAND_SIZE) p.hand.push(this.drawRed());
    });
    // Rotar el Juez y avanzar la ronda.
    this.judgeIndex = (this.judgeIndex + 1) % this.players.length;
    this.round += 1;
    this.startRound();
  }

  restartGame() {
    this.setupGame();
    this.startRound();
  }

  // ---------------------------------------------------------------------------
  // Render (se redibuja la capa dinámica según la fase)
  // ---------------------------------------------------------------------------

  render() {
    // Limpiar el estado de scroll de la mano (la máscara no está en this.ui).
    if (this.handMaskShape) {
      this.handMaskShape.destroy();
      this.handMaskShape = null;
    }
    this.handContainer = null;
    this.handScroll = null;
    this.handBand = null;
    this.scrollThumb = null;
    this.scrollbar = null;
    this._dragging = false;
    this._handDragged = false;
    this._handVel = 0;
    this._lastPointerX = 0;

    this.ui.removeAll(true);

    this.drawRoundLabel();
    this.drawScoreboard();
    this.drawGreenCard();
    this.drawStatusBanner();

    if (this.phase === "play") {
      this.drawPlayerHand();
    } else if (this.phase === "judging") {
      this.drawCenterCaption("Jugadas");
      this.drawSubmissions(false);
    } else if (this.phase === "result") {
      this.drawCenterCaption("Resultado de la ronda");
      this.drawSubmissions(true);
      this.drawNextButton("Siguiente ronda", () => this.nextRound());
    } else if (this.phase === "gameover") {
      this.drawCenterCaption("¡Fin de la partida!");
      this.drawSubmissions(true);
      this.drawNextButton("Jugar de nuevo", () => this.restartGame());
    }

    // La ruleta vive en su propio overlay animado (this.rouletteLayer), por
    // encima de this.ui, así que no se redibuja aquí.
  }

  drawRoundLabel() {
    const t = this.add
      .text(this.f(20), this.yHeader / 2, `Ronda ${this.round} · Meta ${metaGanar(this.players.length)}`, {
        fontFamily: "Segoe UI, sans-serif",
        fontSize: `${this.f(17)}px`,
        color: COLORS.goldHex,
        fontStyle: "bold",
      })
      .setOrigin(0, 0.5);
    this.ui.add(t);
  }

  drawScoreboard() {
    const w = Math.min(this.f(230), this.W * 0.36);
    const rowH = this.f(32);
    const padTop = this.f(38);
    const h = padTop + this.players.length * rowH + this.f(12);
    const x = this.W - w - this.f(16);
    const y = this.yHeader + 12;

    const g = this.add.graphics();
    g.fillStyle(COLORS.panel, 0.8);
    g.fillRoundedRect(x, y, w, h, 12);
    g.lineStyle(2, COLORS.panelBorder, 0.9);
    g.strokeRoundedRect(x, y, w, h, 12);
    this.ui.add(g);

    const title = this.add.text(x + this.f(14), y + this.f(11), "PUNTOS", {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: `${this.f(12)}px`,
      color: COLORS.textMuted,
      fontStyle: "bold",
    });
    this.ui.add(title);

    this.players.forEach((p, i) => {
      const isJudge = i === this.judgeIndex;
      const ry = y + padTop + i * rowH + rowH / 2;

      const name = this.add
        .text(x + this.f(14), ry, p.name, {
          fontFamily: "Segoe UI, sans-serif",
          fontSize: `${this.f(16)}px`,
          color: isJudge ? COLORS.goldHex : COLORS.textLight,
          fontStyle: isJudge ? "bold" : "normal",
        })
        .setOrigin(0, 0.5);
      this.ui.add(name);

      if (isJudge) {
        const badge = this.add
          .text(x + this.f(14) + name.width + 8, ry, "JUEZ", {
            fontFamily: "Segoe UI, sans-serif",
            fontSize: `${this.f(10)}px`,
            color: COLORS.dark,
            fontStyle: "bold",
            backgroundColor: COLORS.goldHex,
            padding: { x: 5, y: 2 },
          })
          .setOrigin(0, 0.5);
        this.ui.add(badge);
      }

      const score = this.add
        .text(x + w - this.f(14), ry, String(p.score), {
          fontFamily: "Segoe UI, sans-serif",
          fontSize: `${this.f(19)}px`,
          color: COLORS.textLight,
          fontStyle: "bold",
        })
        .setOrigin(1, 0.5);
      this.ui.add(score);
    });
  }

  drawGreenCard() {
    const w = this.greenW;
    const h = this.greenH;
    const container = this.add.container(this.W / 2, this.yGreen);

    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.25);
    shadow.fillEllipse(0, h / 2 - 4, w * 0.85, h * 0.1);
    container.add(shadow);

    // ⏳ A ciegas: el adjetivo verde está oculto hasta que el humano juega.
    if (!this.greenRevealed) {
      const g = this.add.graphics();
      g.fillStyle(0x143015, 1);
      g.fillRoundedRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.1);
      g.lineStyle(2, COLORS.panelBorder, 1);
      g.strokeRoundedRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.1);
      container.add(g);
      const q = this.add
        .text(0, 0, "🟢\n?", {
          fontFamily: "Segoe UI, sans-serif",
          fontSize: `${Math.round(this.greenFont * 1.5)}px`,
          color: COLORS.textMuted,
          align: "center",
          fontStyle: "bold",
        })
        .setOrigin(0.5);
      container.add(q);
      this.ui.add(container);
      return;
    }

    const img = this.add
      .image(0, 0, this.greenTex)
      .setOrigin(0.5)
      .setDisplaySize(w, h);
    container.add(img);

    // Cabecera: mismo tratamiento que las amarillas (adjetivo arriba, sin invadir la ilustración).
    this.drawCardHeader(container, this.currentGreen, this.greenFont, TITLE_GREEN, w, h);

    this.ui.add(container);
  }

  drawStatusBanner() {
    let msg = "";
    const humanIsJudge = this.judgeIndex === 0;

    if (this.phase === "play") {
      if (humanIsJudge) {
        msg = "Eres el Juez. Espera a que los demás jueguen su carta...";
      } else if (this.handFrozen) {
        msg = `🥶 Mano congelada... ${this.freezeSeconds}s`;
      } else if (this.humanSubmittedCount() >= this.humanPlaysNeeded) {
        msg = "Ya jugaste. Esperando a los demás...";
      } else if (this.fx.jugadaDoble) {
        msg = `🃏 Jugada doble: elige ${this.humanPlaysNeeded - this.humanSubmittedCount()} carta(s).`;
      } else if (this.fx.jugarACiegas) {
        msg = "⏳ A ciegas: elige tu carta SIN ver el adjetivo verde.";
      } else if (this.fx.pelaElOjo) {
        msg = "👀 Boca abajo: mantén pulsado para espiar, doble clic para jugar.";
      } else {
        msg = "Elige una carta de tu mano para jugarla.";
      }
    } else if (this.phase === "judging") {
      if (humanIsJudge) {
        if (this.mode === "amarga") {
          msg =
            this.judgingStep === "best"
              ? "Eres el Juez: elige la MEJOR carta."
              : "Ahora elige la PEOR carta (el Mamón Amargo).";
        } else {
          msg = "Eres el Juez: elige la carta ganadora.";
        }
      } else {
        msg = `${this.players[this.judgeIndex].name} (Juez) está decidiendo...`;
      }
    } else if (this.phase === "result") {
      const w = this.players[this.lastResult.winnerIndex];
      msg = `Ganó la ronda: ${w.name} con "${this.lastResult.card}"`;
    } else if (this.phase === "gameover") {
      const w = this.players[this.lastResult.winnerIndex];
      msg = `¡${w.name} gana la partida con ${w.score} puntos!`;
    }

    this.drawPill(this.W / 2, this.yStatus, msg);

    // Nota de Piensa Rápido: el último en jugar perdió su carta esta ronda.
    if (this.piensaRapidoVictim != null && (this.phase === "judging" || this.phase === "result")) {
      const v = this.players[this.piensaRapidoVictim];
      const txt =
        this.piensaRapidoVictim === 0
          ? "🐢 Te pasaste de lento: tu carta se quedó en la mano."
          : `🐢 ${v.name} se tardó: su carta se quedó en la mano.`;
      const note = this.add
        .text(this.W / 2, this.yStatus + this.f(26), txt, {
          fontFamily: "Segoe UI, sans-serif",
          fontSize: `${this.f(13)}px`,
          color: COLORS.textMuted,
          align: "center",
          wordWrap: { width: this.W * 0.9 },
        })
        .setOrigin(0.5);
      this.ui.add(note);
    }
  }

  // Píldora de texto centrada con fondo.
  drawPill(cx, cy, message) {
    const label = this.add
      .text(cx, cy, message, {
        fontFamily: "Segoe UI, sans-serif",
        fontSize: `${this.f(17)}px`,
        color: COLORS.textLight,
        align: "center",
        wordWrap: { width: this.W * 0.9 },
      })
      .setOrigin(0.5);

    const padX = this.f(20);
    const padY = this.f(9);
    const w = label.width + padX * 2;
    const h = label.height + padY * 2;

    const g = this.add.graphics();
    g.fillStyle(COLORS.panel, 0.85);
    g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, h / 2);
    g.lineStyle(2, COLORS.panelBorder, 0.7);
    g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, h / 2);

    this.ui.add(g);
    this.ui.add(label); // el texto queda por encima del fondo
  }

  drawCenterCaption(text) {
    const t = this.add
      .text(this.W / 2, this.yCenter - this.cardH / 2 - this.f(16), text, {
        fontFamily: "Segoe UI, sans-serif",
        fontSize: `${this.f(14)}px`,
        color: COLORS.textMuted,
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this.ui.add(t);
  }

  // Mano del jugador humano (abajo), en una tira con SCROLL HORIZONTAL.
  // Las cartas viven en un contenedor enmascarado a un "viewport"; se arrastra
  // o se usa la rueda para desplazarlas. Clickable solo si puede jugar.
  drawPlayerHand() {
    const hand = this.players[0].hand;
    const canPlay =
      this.judgeIndex !== 0 &&
      !this.handFrozen &&
      this.humanSubmittedCount() < this.humanPlaysNeeded;
    const faceDown = this.fx.pelaElOjo;

    const w = this.cardW;
    const gap = this.handGap;
    const totalW = hand.length * w + (hand.length - 1) * gap;
    const cy = this.yHand;

    // Viewport visible de la mano.
    const margin = Math.max(this.f(16), this.W * 0.03);
    const viewportX = margin;
    const viewportW = this.W - 2 * margin;

    // Banda (alto) un poco mayor que la carta para que el hover no se recorte.
    const bandH = this.cardH * 1.16;
    const bandTop = cy - bandH / 2;
    this.handBand = { top: bandTop, bottom: bandTop + bandH };

    // Contenedor desplazable: las cartas se posicionan en coords locales (y=0).
    const container = this.add.container(0, cy);
    hand.forEach((text, i) => {
      const lx = w / 2 + i * (w + gap);
      const card = this.makeRedCard(text);
      card.setPosition(lx, 0);
      card.setAlpha(canPlay ? 1 : 0.65);

      // 👀 "Pela el ojo": un reverso cubre la carta y se levanta al espiar.
      let back = null;
      if (faceDown) {
        back = this.makeCardBack(w, this.cardH);
        card.add(back);
      }

      if (canPlay) {
        // La imagen es interactiva: su zona de clic es exactamente toda la carta.
        const img = card.cardImage;
        img.setInteractive({ useHandCursor: true });

        if (faceDown) {
          // Mantener pulsado = espiar; doble clic = jugar a ciegas.
          img.on("pointerdown", () => {
            if (back) back.setVisible(false);
            const now = this.time.now;
            if (this._lastTapIndex === i && now - this._lastTapTime < 350) {
              this._lastTapTime = 0;
              this._lastTapIndex = -1;
              if (!this._handDragged) this.humanPlayCard(i);
            } else {
              this._lastTapTime = now;
              this._lastTapIndex = i;
            }
          });
          img.on("pointerup", () => back && back.setVisible(true));
          img.on("pointerout", () => back && back.setVisible(true));
        } else {
          img.on("pointerover", () => {
            card.setScale(1.06);
            container.bringToTop(card);
          });
          img.on("pointerout", () => card.setScale(1));
          // Jugar al soltar, solo si fue un toque (no un arrastre para scroll).
          img.on("pointerup", () => {
            if (!this._handDragged) this.humanPlayCard(i);
          });
        }
      }
      container.add(card);
    });
    this.ui.add(container);
    this.handContainer = container;

    // Límites de scroll. Si todo cabe, se centra y no hay desplazamiento.
    let min, max, enabled;
    if (totalW <= viewportW) {
      const x = viewportX + (viewportW - totalW) / 2;
      min = max = x;
      enabled = false;
    } else {
      max = viewportX; // mostrando el inicio
      min = viewportX + viewportW - totalW; // mostrando el final
      enabled = true;
    }
    container.x = max;
    this.handScroll = { min, max, enabled };

    // Máscara del viewport (no se añade a this.ui; se destruye manualmente).
    const shape = this.make.graphics();
    shape.fillStyle(0xffffff);
    shape.fillRect(viewportX, bandTop, viewportW, bandH);
    container.setMask(shape.createGeometryMask());
    this.handMaskShape = shape;

    if (enabled) {
      this.drawScrollbar(viewportX, viewportW, cy + this.cardH / 2 + this.f(6), totalW);
      const hint = this.add
        .text(this.W / 2, bandTop - this.f(8), "‹ desliza para ver tus cartas ›", {
          fontFamily: "Segoe UI, sans-serif",
          fontSize: `${this.f(12)}px`,
          color: COLORS.textMuted,
        })
        .setOrigin(0.5);
      this.ui.add(hint);
    }
  }

  // Barra de desplazamiento bajo la mano (indica posición; se actualiza al hacer scroll).
  drawScrollbar(tx, tw, ty, totalW) {
    const h = this.f(6);

    const track = this.add.graphics();
    track.fillStyle(0x000000, 0.3);
    track.fillRoundedRect(tx, ty, tw, h, h / 2);
    this.ui.add(track);

    const thumbW = Math.max(this.f(34), tw * (tw / totalW));
    const thumb = this.add.graphics();
    thumb.fillStyle(COLORS.gold, 0.9);
    thumb.fillRoundedRect(0, 0, thumbW, h, h / 2);
    thumb.y = ty;
    this.ui.add(thumb);

    this.scrollbar = { tx, tw, h, thumbW };
    this.scrollThumb = thumb;
    this.updateScrollThumb();
  }

  updateScrollThumb() {
    if (!this.scrollThumb || !this.handScroll || !this.handScroll.enabled) return;
    const { min, max } = this.handScroll;
    const t = max === min ? 0 : (this.handContainer.x - max) / (min - max); // 0=inicio, 1=final
    const { tx, tw, thumbW } = this.scrollbar;
    this.scrollThumb.x = tx + t * (tw - thumbW);
  }

  // Cartas jugadas en el centro. revealOwners=true muestra de quién es cada una.
  drawSubmissions(revealOwners) {
    const n = this.submissions.length;
    let gap = Math.max(this.handGap, this.f(28));
    // Escalar hacia abajo si las jugadas no caben a lo ancho (muchos jugadores).
    const maxRowW = this.W * 0.96;
    let scale = 1;
    let totalW = n * this.cardW + (n - 1) * gap;
    if (totalW > maxRowW) {
      scale = maxRowW / totalW;
      gap *= scale;
      totalW = maxRowW;
    }
    const w = this.cardW * scale;
    const h = this.cardH * scale;
    const startX = (this.W - totalW) / 2 + w / 2; // centros
    const cy = this.yCenter;

    const humanIsJudge = this.judgeIndex === 0;
    const canJudge = this.phase === "judging" && humanIsJudge;

    this.submissions.forEach((sub, i) => {
      const cx = startX + i * (w + gap);
      const isWinner = this.lastResult && this.lastResult.card === sub.card;
      const isWorst = this.worstResult && this.worstResult.card === sub.card;
      const card = this.makeRedCard(sub.card, isWinner);
      card.setScale(scale);
      card.setPosition(cx, cy);

      if (canJudge) {
        // En Amarga, durante el paso "peor" no se puede re-elegir la mejor.
        const blocked =
          this.mode === "amarga" && this.judgingStep === "worst" && sub === this.bestPick;
        if (!blocked) this.attachClick(card, this.cardW, this.cardH, () => this.judgePick(i), scale);
      }

      if (isWinner) {
        this.drawCardTag(cx, cy - h / 2 - this.f(12), "GANADORA", COLORS.goldHex, COLORS.dark);
      }
      if (isWorst) {
        this.drawCardTag(cx, cy - h / 2 - this.f(12), "MAMÓN AMARGO 🤢", "#8a1c10", "#ffffff");
      }

      if (revealOwners) {
        const owner = this.add
          .text(cx, cy + h / 2 + this.f(14), this.players[sub.playerIndex].name, {
            fontFamily: "Segoe UI, sans-serif",
            fontSize: `${this.f(15)}px`,
            color: isWinner ? COLORS.goldHex : "#cccccc",
            fontStyle: isWinner ? "bold" : "normal",
          })
          .setOrigin(0.5);
        this.ui.add(owner);
      }

      this.ui.add(card);
    });
  }

  drawNextButton(text, onClick) {
    const w = this.f(250);
    const h = this.f(54);
    const container = this.add.container(this.W / 2, this.yButton);

    const g = this.add.graphics();
    g.fillStyle(COLORS.gold, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 12);
    container.add(g);

    const label = this.add
      .text(0, 0, text, {
        fontFamily: "Segoe UI, sans-serif",
        fontSize: `${this.f(21)}px`,
        color: COLORS.dark,
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    container.add(label);

    this.attachClick(container, w, h, onClick);
    this.ui.add(container);
  }

  // Etiqueta tipo "pill" sobre una carta (GANADORA / MAMÓN AMARGO).
  drawCardTag(cx, y, text, bgHex, fgHex) {
    const tag = this.add
      .text(cx, y, text, {
        fontFamily: "Segoe UI, sans-serif",
        fontSize: `${this.f(12)}px`,
        color: fgHex,
        fontStyle: "bold",
        backgroundColor: bgHex,
        padding: { x: 7, y: 3 },
      })
      .setOrigin(0.5);
    this.ui.add(tag);
  }

  // Reverso de carta (marca): fondo verde + borde dorado + el logo centrado.
  // Se usa en "Pela el ojo" y en las boca-abajo del montoncito.
  makeCardBack(w, h) {
    const c = this.add.container(0, 0);
    const r = Math.min(w, h) * 0.1;
    const g = this.add.graphics();
    g.fillStyle(COLORS.panel, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    g.lineStyle(Math.max(2, w * 0.04), COLORS.gold, 1);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, r);
    c.add(g);

    if (this.textures.exists("logo")) {
      const img = this.add.image(0, 0, "logo").setOrigin(0.5);
      const src = this.textures.get("logo").getSourceImage();
      const scale = Math.min((w * 0.8) / src.width, (h * 0.8) / src.height);
      img.setScale(scale);
      c.add(img);
    } else {
      const q = this.add.text(0, 0, "🍈", { fontSize: `${Math.round(h * 0.3)}px` }).setOrigin(0.5);
      c.add(q);
    }
    return c;
  }

  // Mini botón (por defecto se añade a this.ui; el overlay pasa su propia capa).
  drawMiniButton(cx, cy, w, h, text, onClick, primary = true, parent = this.ui) {
    const c = this.add.container(cx, cy);
    const g = this.add.graphics();
    g.fillStyle(primary ? COLORS.gold : 0x2a3a2c, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
    if (!primary) {
      g.lineStyle(2, COLORS.panelBorder, 1);
      g.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    }
    c.add(g);
    const t = this.add
      .text(0, 0, text, {
        fontFamily: "Segoe UI, sans-serif",
        fontSize: `${this.f(14)}px`,
        color: primary ? COLORS.dark : COLORS.textLight,
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    c.add(t);
    this.attachClick(c, w, h, onClick);
    parent.add(c);
  }

  // ---------------------------------------------------------------------------
  // La Ruleta del Mamón Amargo: overlay animado (rueda que gira y se detiene).
  // ---------------------------------------------------------------------------

  rouletteText(parent, cx, y, text, size, color, bold, wrapW) {
    const t = this.add
      .text(cx, y, text, {
        fontFamily: "Segoe UI, sans-serif",
        fontSize: `${this.f(size)}px`,
        color,
        fontStyle: bold ? "bold" : "normal",
        align: "center",
        wordWrap: wrapW ? { width: wrapW } : undefined,
      })
      .setOrigin(0.5);
    parent.add(t);
    return t;
  }

  // Construye la rueda de 6 sectores con su emoji. Centrada en (cx, cy).
  // Construye la rueda con un sector por efecto activo (5 ó 6). Centrada en (cx, cy).
  buildWheel(cx, cy, rW, efectos) {
    const wheel = this.add.container(cx, cy);
    const n = efectos.length;
    const seg = 360 / n;

    const g = this.add.graphics();
    for (let k = 0; k < n; k++) {
      const a0 = Phaser.Math.DegToRad(k * seg);
      const a1 = Phaser.Math.DegToRad((k + 1) * seg);
      g.fillStyle(RULETA_COLORS[efectos[k] - 1], 1);
      g.slice(0, 0, rW, a0, a1, false);
      g.fillPath();
    }
    g.lineStyle(3, 0x0c2114, 1);
    g.strokeCircle(0, 0, rW);
    wheel.add(g);

    for (let k = 0; k < n; k++) {
      const ac = Phaser.Math.DegToRad((k + 0.5) * seg);
      const er = rW * 0.62;
      const e = this.add
        .text(Math.cos(ac) * er, Math.sin(ac) * er, RULETA_EFFECTS[efectos[k]].emoji, {
          fontSize: `${Math.round(rW * 0.34)}px`,
        })
        .setOrigin(0.5);
      wheel.add(e);
    }

    const hub = this.add.graphics();
    hub.fillStyle(0x0c2114, 1);
    hub.fillCircle(0, 0, rW * 0.16);
    wheel.add(hub);
    return wheel;
  }

  // Crea el overlay y lanza el giro; al terminar revela el efecto.
  showRoulette() {
    if (this.rouletteLayer) this.rouletteLayer.destroy(true);
    const layer = this.add.container(0, 0);
    this.rouletteLayer = layer;
    const r = this.pendingRoulette;

    // Scrim interactivo (bloquea clics a lo de debajo gracias a topOnly).
    const scrim = this.add.graphics();
    scrim.fillStyle(0x000000, 0.62);
    scrim.fillRect(0, 0, this.W, this.H);
    scrim.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, this.W, this.H),
      Phaser.Geom.Rectangle.Contains
    );
    layer.add(scrim);

    const pw = Math.min(this.f(460), this.W * 0.9);
    const rW = Math.max(this.f(42), Math.min(this.f(82), this.H * 0.13, this.W * 0.2));
    const extra = r.transfer ? this.f(150) : this.f(112);
    const ph = Math.min(this.H * 0.92, this.f(70) + 2 * rW + extra);
    const cx = this.W / 2;
    const cyP = this.H / 2;
    const top = cyP - ph / 2;

    const panel = this.add.graphics();
    panel.fillStyle(COLORS.panel, 0.98);
    panel.fillRoundedRect(cx - pw / 2, top, pw, ph, 18);
    panel.lineStyle(3, COLORS.gold, 1);
    panel.strokeRoundedRect(cx - pw / 2, top, pw, ph, 18);
    layer.add(panel);

    this.rouletteText(layer, cx, top + this.f(24), "🎡 ¡Ruleta del Mamón Amargo!", 18, COLORS.goldHex, true);
    this.rouletteText(
      layer,
      cx,
      top + this.f(48),
      `${this.players[r.playerIndex].name} gira la ruleta...`,
      13,
      COLORS.textMuted,
      false
    );

    const efectos = r.efectos || [1, 2, 3, 4, 5, 6];
    const seg = 360 / efectos.length;
    const wheelCY = top + this.f(64) + rW;
    const wheel = this.buildWheel(cx, wheelCY, rW, efectos);
    layer.add(wheel);
    this.rouletteWheel = wheel;

    // Puntero fijo (no gira) sobre la rueda.
    const ptr = this.add.graphics();
    ptr.fillStyle(0xffffff, 1);
    ptr.fillTriangle(
      cx - this.f(11),
      wheelCY - rW - this.f(16),
      cx + this.f(11),
      wheelCY - rW - this.f(16),
      cx,
      wheelCY - rW + this.f(3)
    );
    layer.add(ptr);

    this._rouletteGeom = { cx, top, pw, ph, rW, wheelCY };

    // Gira hasta dejar el segmento elegido bajo el puntero (arriba = -90°).
    const idx = efectos.indexOf(r.pick);
    const segCenter = (Math.max(0, idx) + 0.5) * seg;
    const target = 360 * 5 + (-90 - segCenter);
    wheel.angle = 0;
    this.tweens.add({
      targets: wheel,
      angle: target,
      duration: 2600,
      ease: "Cubic.easeOut",
      onComplete: () => this.revealRouletteResult(),
    });
  }

  // Tras detenerse la rueda: muestra el efecto y los botones de acción.
  revealRouletteResult() {
    const r = this.pendingRoulette;
    if (!r || !this.rouletteLayer) return;
    const { cx, top, pw, ph, rW, wheelCY } = this._rouletteGeom;
    const layer = this.rouletteLayer;
    const bottom = top + ph;

    const nameY = wheelCY + rW + this.f(22);
    this.rouletteText(layer, cx, nameY, `${r.fx.emoji} ${r.fx.name}`, 18, COLORS.textLight, true);
    this.rouletteText(layer, cx, nameY + this.f(22), r.fx.desc, 12, COLORS.textMuted, false, pw - this.f(36));

    // 🤢 Pasa el mamón en manos de un BOT: se lo pasa solo a alguien al azar.
    if (r.transfer && this.players[r.playerIndex].isBot) {
      const others = this.players.map((_, i) => i).filter((i) => i !== r.playerIndex);
      const target = others[Phaser.Math.Between(0, others.length - 1)];
      this.rouletteText(layer, cx, bottom - this.f(28), `Se lo pasa a ${this.players[target].name}...`, 13, COLORS.goldHex, true);
      this.time.delayedCall(1300, () => {
        this.closeRoulette(false);
        this.activarRuletaMamonAmargo(target, r.depth + 1);
      });
      return;
    }

    if (r.transfer) {
      this.rouletteText(layer, cx, bottom - this.f(84), "Pásaselo a:", 14, COLORS.textLight, true);
      const others = this.players.map((_, i) => i).filter((i) => i !== r.playerIndex);
      const bw = this.f(120);
      const bh = this.f(34);
      const g = this.f(12);
      const total = others.length * bw + (others.length - 1) * g;
      let bx = cx - total / 2 + bw / 2;
      const by = bottom - this.f(54);
      others.forEach((oi) => {
        this.drawMiniButton(
          bx,
          by,
          bw,
          bh,
          this.players[oi].name,
          () => {
            const d = r.depth;
            this.closeRoulette(false);
            this.activarRuletaMamonAmargo(oi, d + 1);
          },
          true,
          layer
        );
        bx += bw + g;
      });
      this.drawMiniButton(
        cx,
        bottom - this.f(18),
        this.f(180),
        this.f(30),
        "Me salvo (nada pasa)",
        () => this.closeRoulette(true),
        false,
        layer
      );
    } else {
      this.drawMiniButton(
        cx,
        bottom - this.f(30),
        this.f(160),
        this.f(40),
        "¡Dale!",
        () => this.closeRoulette(true),
        true,
        layer
      );
    }
  }

  closeRoulette(rerender) {
    if (this.rouletteLayer) {
      this.rouletteLayer.destroy(true);
      this.rouletteLayer = null;
    }
    this.rouletteWheel = null;
    this.pendingRoulette = null;
    if (rerender) this.render();
  }

  // ---------------------------------------------------------------------------
  // Helpers de cartas (geometría CENTRADA: origen 0.5 → escala/hover sin desfase)
  // ---------------------------------------------------------------------------

  // Reduce el tamaño de fuente de un texto hasta que su alto entre en maxHeight
  // (o se llegue al mínimo). Evita que el título invada la ilustración.
  fitText(textObj, maxHeight, minFontPx) {
    let px = parseInt(textObj.style.fontSize, 10) || 14;
    while (textObj.height > maxHeight && px > minFontPx) {
      px -= 1;
      textObj.setFontSize(px);
    }
  }

  // Dibuja el título en la CABECERA superior de una carta (mismo tratamiento
  // para verdes y amarillas): anclado arriba, ajustado para no invadir la
  // ilustración, con contorno blanco para legibilidad. Devuelve el texto.
  drawCardHeader(container, text, baseFont, color, w, h) {
    const padTop = h * 0.07;
    const headerH = h * 0.3;
    const label = this.add
      .text(0, -h / 2 + padTop, text, {
        fontFamily: "Segoe UI, sans-serif",
        fontSize: `${baseFont}px`,
        color: color,
        fontStyle: "bold",
        align: "center",
        wordWrap: { width: w * 0.84 },
        stroke: "#ffffff",
        strokeThickness: 3,
        lineSpacing: -1,
      })
      .setOrigin(0.5, 0);
    this.fitText(label, headerH, Math.max(8, baseFont - 5));
    container.add(label);
    return label;
  }

  // Carta amarilla (sustantivo): el texto va en la CABECERA superior y la
  // ilustración del racimo queda limpia debajo, sin superponerse.
  makeRedCard(text, isWinner) {
    const w = this.cardW;
    const h = this.cardH;
    const container = this.add.container(0, 0);

    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.22);
    shadow.fillEllipse(0, h / 2 - 2, w * 0.82, h * 0.09);
    container.add(shadow);

    const img = this.add
      .image(0, 0, this.redTex)
      .setOrigin(0.5)
      .setDisplaySize(w, h);
    container.add(img);
    container.cardImage = img; // referencia para la zona clickeable (toda la carta)

    if (isWinner) {
      const border = this.add.graphics();
      border.lineStyle(4, COLORS.gold, 1);
      border.strokeRoundedRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 10);
      container.add(border);
    }

    // Cabecera: el sustantivo arriba; la ilustración queda libre debajo.
    this.drawCardHeader(container, text, this.cardFont, TITLE_RED, w, h);

    return container;
  }

  // Hace clicable toda la carta. Si el contenedor tiene una imagen de carta,
  // se usa esa imagen (su zona de clic es exactamente toda la carta); si no
  // (p. ej. el botón), se usa un rectángulo centrado del tamaño dado.
  attachClick(container, w, h, onClick, baseScale = 1) {
    const target = container.cardImage || container;
    if (target === container) {
      container.setSize(w, h);
      container.setInteractive({
        hitArea: new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true,
      });
    } else {
      target.setInteractive({ useHandCursor: true });
    }

    target.on("pointerover", () => {
      container.setScale(baseScale * 1.08);
      (container.parentContainer || this.ui).bringToTop(container);
    });
    target.on("pointerout", () => container.setScale(baseScale));
    // En pointerUP (no down): así, al re-renderizar tras el clic, la MISMA
    // pulsación no se encadena a una carta recién dibujada bajo el cursor.
    target.on("pointerup", onClick);
  }
}
