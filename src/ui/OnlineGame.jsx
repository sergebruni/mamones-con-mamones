import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { initSfx, isSfxEnabled, setSfxEnabled, spinTicks, beep, beepUrge, ding } from "../lib/sfx.js";
import Recap from "./Recap.jsx";
import "./OnlineGame.css";

// ¿El dispositivo tiene mouse con hover? (escritorio sí, móvil táctil no)
const CAN_HOVER =
  typeof window !== "undefined" && window.matchMedia && window.matchMedia("(hover: hover)").matches;

function metaGanar(n) {
  if (n >= 8) return 4;
  if (n === 7) return 5;
  if (n === 6) return 6;
  if (n === 5) return 7;
  return 8;
}

// Posición de la carta 'i' dentro del montoncito del centro (leve desorden).
function pileCardStyle(i) {
  const ox = ((i * 37) % 15) - 7;
  const oy = ((i * 23) % 11) - 5;
  const rot = ((i * 29) % 21) - 10;
  return {
    transform: `translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px)) rotate(${rot}deg) scale(0.8)`,
    zIndex: i,
  };
}

const EFECTOS = {
  1: { emoji: "👀", name: "Pela el ojo", desc: "Mano boca abajo: espía y juega de memoria." },
  2: { emoji: "🥶", name: "Mano congelada", desc: "10 segundos sin poder jugar." },
  3: { emoji: "🌪️", name: "Mazo barajado", desc: "¡Mano nueva al azar!" },
  4: { emoji: "⏳", name: "A ciegas", desc: "Juegas sin ver el adjetivo verde." },
  5: { emoji: "🤢", name: "Pasa el mamón", desc: "¡Salvado! Pásaselo a otro." },
  6: { emoji: "🃏", name: "Jugada doble", desc: "Juegas DOS cartas." },
};

// Color de la cuña de cada efecto en la ruleta.
const COLOR_EFECTO = {
  1: "#ffd35c",
  2: "#8a1c10",
  3: "#2e8b2e",
  4: "#e08a1c",
  5: "#3a6ea5",
  6: "#6b3fa0",
};

// Efectos que entran al sorteo. 'Mano congelada' (2) solo con Piensa Rápido.
const efectosRuleta = (piensaRapido) =>
  piensaRapido ? [1, 2, 3, 4, 5, 6] : [1, 3, 4, 5, 6];

function Carta({ color, titulo, flavor, onClick, onDoubleClick, disabled, ganadora, peor, anon, onLongPress, onLongPressEnd }) {
  const timer = useRef(null);
  const longRef = useRef(false);

  const startPress = () => {
    longRef.current = false;
    if (anon || !flavor) return; // nada que ampliar
    timer.current = setTimeout(() => {
      longRef.current = true;
      onLongPress && onLongPress({ color, titulo, flavor });
    }, 400);
  };
  const endPress = () => {
    if (timer.current) clearTimeout(timer.current);
    if (longRef.current) onLongPressEnd && onLongPressEnd();
  };
  const handleClick = (e) => {
    if (longRef.current) {
      longRef.current = false;
      return; // fue pulsación larga: no dispares el clic
    }
    onClick && onClick(e);
  };

  const cls = `carta carta--${color} ${ganadora ? "carta--gana" : ""} ${peor ? "carta--peor" : ""} ${
    disabled ? "carta--off" : ""
  } ${onClick || onDoubleClick ? "carta--click" : ""}`;

  return (
    <button
      className={cls}
      onClick={handleClick}
      onDoubleClick={onDoubleClick}
      onPointerDown={startPress}
      onPointerUp={endPress}
      onPointerLeave={endPress}
      onMouseEnter={() => CAN_HOVER && !anon && flavor && onLongPress && onLongPress({ color, titulo, flavor })}
      onMouseLeave={() => CAN_HOVER && onLongPressEnd && onLongPressEnd()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {anon ? (
        <span className="carta__dorso">
          <img className="carta__logo" src="/assets/logo.png" alt="" />
        </span>
      ) : (
        <>
          <span className="carta__titulo">{titulo}</span>
          {flavor && <span className="carta__flavor">{flavor}</span>}
        </>
      )}
    </button>
  );
}

export default function OnlineGame({ salaId, uid, codigo, onLeave }) {
  const [sala, setSala] = useState(null);
  const [players, setPlayers] = useState([]);
  const [hand, setHand] = useState([]);
  const [mesa, setMesa] = useState([]);
  const [flavores, setFlavores] = useState({});
  const [jugaron, setJugaron] = useState([]);
  const [misJugadas, setMisJugadas] = useState(0);
  const [nowTs, setNowTs] = useState(Date.now());
  const [error, setError] = useState("");
  const [peek, setPeek] = useState({}); // índices "espiados" (pela el ojo)
  const [rot, setRot] = useState(0); // rotación de la ruleta
  const [verRes, setVerRes] = useState(false); // mostrar resultado de la ruleta
  const [muted, setMuted] = useState(!isSfxEnabled());
  const [preview, setPreview] = useState(null); // carta ampliada (long-press)
  const [flying, setFlying] = useState(null); // carta volando al centro de la mesa
  const [myPlayed, setMyPlayed] = useState([]); // tus cartas ya en el montoncito (esta ronda)
  const [chat, setChat] = useState([]); // mensajes de la sala (efímeros, por broadcast)
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const [chatInput, setChatInput] = useState("");
  const [reactions, setReactions] = useState([]); // emojis flotando sobre cartas
  const [reactFor, setReactFor] = useState(null); // id de mesa con el picker abierto
  const cerrarPreview = () => setPreview(null);
  const lastSyncRef = useRef("");
  const firedRef = useRef(0);
  const turnsRef = useRef(5);
  const dingRef = useRef("");
  const rootRef = useRef(null);
  const chanRef = useRef(null); // canal Realtime (para enviar chat/reacciones)
  const chatOpenRef = useRef(false);
  const chatEndRef = useRef(null);

  useEffect(() => initSfx(), []);
  const toggleMute = () => {
    const v = !muted;
    setMuted(v);
    setSfxEnabled(!v);
  };

  const fase = sala?.fase;
  const ronda = sala?.ronda;
  const modo = sala?.config?.modo || "clasica";
  const piensaRapido = !!sala?.config?.piensaRapido;
  const esJuez = sala?.juez_uid === uid;
  const cartaVerde = sala?.carta_verde;
  const mejorMesaId = sala?.mejor_mesa_id;
  const peorUid = sala?.peor_uid;
  const ruletaEfecto = sala?.ruleta_efecto;

  // Sectores de la ruleta (5 ó 6 según Piensa Rápido), repartidos parejo.
  const efectosActivos = efectosRuleta(piensaRapido);
  const segDeg = 360 / efectosActivos.length;
  const ruletaBg = `conic-gradient(${efectosActivos
    .map((e, idx) => `${COLOR_EFECTO[e]} ${idx * segDeg}deg ${(idx + 1) * segDeg}deg`)
    .join(", ")})`;

  const me = players.find((p) => p.uid === uid);
  const miEfecto = me?.efecto_ronda;
  const cartasAJugar = me?.cartas_a_jugar ?? 1;
  const congeladoHasta = me?.congelado_hasta ? Date.parse(me.congelado_hasta) : null;
  const congelado = congeladoHasta && congeladoHasta > nowTs;
  const congSecs = congelado ? Math.ceil((congeladoHasta - nowTs) / 1000) : 0;
  const yaJugue = misJugadas >= cartasAJugar;
  const meta = sala?.config?.meta || metaGanar(players.length);

  const deadline = sala?.fase_hasta ? Date.parse(sala.fase_hasta) : null;
  const secsLeft = deadline ? Math.max(0, Math.ceil((deadline - nowTs) / 1000)) : null;

  // Tic de 1s.
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // --- Fetchers ---
  const fetchSala = useCallback(async () => {
    const { data } = await supabase.from("salas").select("*").eq("id", salaId).single();
    if (data) setSala(data);
  }, [salaId]);
  const fetchPlayers = useCallback(async () => {
    const { data } = await supabase
      .from("jugadores_sala")
      .select("uid,nombre,puntos,orden,efecto_ronda,cartas_a_jugar,congelado_hasta")
      .eq("sala_id", salaId)
      .order("orden");
    if (data) setPlayers(data);
  }, [salaId]);
  const fetchHand = useCallback(async () => {
    const { data } = await supabase.from("cartas_mano").select("carta").eq("sala_id", salaId).eq("uid", uid);
    if (data) setHand(data.map((r) => r.carta));
  }, [salaId, uid]);
  const fetchMesa = useCallback(async () => {
    const { data } = await supabase.rpc("mesa_actual", { p_sala: salaId });
    if (data) setMesa(data);
  }, [salaId]);
  const fetchJugaron = useCallback(async () => {
    const { data } = await supabase.rpc("jugaron_uids", { p_sala: salaId });
    setJugaron(data || []);
  }, [salaId]);
  const fetchMisJugadas = useCallback(async () => {
    const { count } = await supabase
      .from("mesa_juego")
      .select("*", { count: "exact", head: true })
      .eq("sala_id", salaId)
      .eq("jugador_uid", uid);
    setMisJugadas(count || 0);
  }, [salaId, uid]);

  useEffect(() => {
    supabase
      .from("cartas")
      .select("texto,flavor")
      .then(({ data }) => {
        const m = {};
        (data || []).forEach((c) => (m[c.texto] = c.flavor));
        setFlavores(m);
      });
  }, []);

  useEffect(() => {
    const refrescar = () => {
      fetchSala();
      fetchPlayers();
      fetchHand();
      fetchMesa();
      fetchJugaron();
      fetchMisJugadas();
    };
    refrescar();

    const ch = supabase.channel(`juego:${salaId}`, { config: { presence: { key: uid } } });
    chanRef.current = ch;
    ch.on("presence", { event: "sync" }, () => {
      const connected = Object.keys(ch.presenceState());
      const key = connected.slice().sort().join(",");
      if (key === lastSyncRef.current) return;
      lastSyncRef.current = key;
      supabase.rpc("marcar_conectados", { p_sala: salaId, p_conectados: connected });
    })
      .on("postgres_changes", { event: "*", schema: "public", table: "salas", filter: `id=eq.${salaId}` }, refrescar)
      .on("postgres_changes", { event: "*", schema: "public", table: "jugadores_sala", filter: `sala_id=eq.${salaId}` }, () => {
        fetchPlayers();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "mesa_juego", filter: `sala_id=eq.${salaId}` }, () => {
        fetchMesa();
        fetchJugaron();
        fetchMisJugadas();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cartas_mano", filter: `sala_id=eq.${salaId}` }, fetchHand)
      .on("broadcast", { event: "chat" }, ({ payload }) => {
        setChat((c) => [...c.slice(-59), payload]);
        if (!chatOpenRef.current) setChatUnread((u) => u + 1);
      })
      .on("broadcast", { event: "reaccion" }, ({ payload }) => {
        mostrarReaccion(payload.mesaId, payload.emoji);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") await ch.track({});
      });

    return () => {
      supabase.removeChannel(ch);
      chanRef.current = null;
    };
  }, [salaId, uid, fetchSala, fetchPlayers, fetchHand, fetchMesa, fetchJugaron, fetchMisJugadas]);

  // Respaldo cada 3s: refresca el estado y pide resolver el timeout.
  // resolver_timeout lo decide el SERVIDOR con su propio reloj (no el del navegador),
  // así que aunque haya desfase de hora, la fase vencida se resuelve en ≤3s.
  useEffect(() => {
    const t = setInterval(() => {
      fetchSala();
      fetchMesa();
      fetchPlayers();
      fetchJugaron();
      fetchMisJugadas();
      fetchHand();
      supabase.rpc("resolver_timeout", { p_sala: salaId }).then(({ error }) => {
        if (error) console.warn("resolver_timeout:", error.message);
      });
    }, 3000);
    return () => clearInterval(t);
  }, [salaId, fetchSala, fetchMesa, fetchPlayers, fetchJugaron, fetchMisJugadas, fetchHand]);

  // Reiniciar "peek" y el montoncito propio cuando cambia la ronda.
  useEffect(() => {
    setPeek({});
    setMyPlayed([]);
  }, [ronda]);

  // Chat: al abrir, marca leído; auto-scroll al último mensaje.
  useEffect(() => {
    chatOpenRef.current = chatOpen;
    if (chatOpen) setChatUnread(0);
  }, [chatOpen]);
  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [chat, chatOpen]);

  // Al vencer la fase, reintenta resolver hasta que el server la procese (tolera
  // desfases de reloj y eventos perdidos). El server valida now() >= fase_hasta.
  useEffect(() => {
    if (!deadline || nowTs <= deadline) return;
    const now = Date.now();
    if (now - firedRef.current < 2500) return; // throttle de reintentos
    firedRef.current = now;
    supabase.rpc("resolver_timeout", { p_sala: salaId });
  }, [nowTs, deadline, salaId]);

  // Animación de la ruleta (modo Amargo, en resultado).
  useEffect(() => {
    if (fase === "resultado" && ruletaEfecto) {
      turnsRef.current += 5;
      const idx = Math.max(0, efectosActivos.indexOf(ruletaEfecto));
      const target = 360 * turnsRef.current - (idx * segDeg + segDeg / 2);
      setVerRes(false);
      // Diferir la rotación final un par de frames: en móvil, si el ángulo
      // objetivo se aplica en el mismo frame en que monta la rueda, el navegador
      // pinta directo el ángulo final y la transición CSS no dispara (no gira).
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setRot(target));
      });
      spinTicks(2600);
      const t = setTimeout(() => setVerRes(true), 2600);
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
        clearTimeout(t);
      };
    }
  }, [fase, ruletaEfecto, peorUid, piensaRapido]);

  // Beep del reloj en los últimos segundos.
  useEffect(() => {
    if (secsLeft == null || !["jugando", "juzgando", "resultado"].includes(fase)) return;
    if (secsLeft > 0 && secsLeft <= 5) (secsLeft <= 3 ? beepUrge : beep)();
  }, [secsLeft, fase]);

  // Ding al revelarse el resultado de la ronda.
  useEffect(() => {
    if (fase === "resultado" && dingRef.current !== String(ronda)) {
      dingRef.current = String(ronda);
      ding();
    }
  }, [fase, ronda]);

  // --- Intenciones ---
  const rpc = async (fn, args) => {
    setError("");
    const { error } = await supabase.rpc(fn, args);
    if (error) setError(error.message);
  };
  const jugar = (carta) => {
    rpc("jugar_carta", { p_sala: salaId, p_carta: carta });
    setMisJugadas((n) => n + 1); // optimista
  };
  // Juega animando la carta en arco desde la mano hasta el montoncito del centro.
  const jugarConAnim = (carta, el) => {
    if (!el || !rootRef.current) return jugar(carta);
    const r = el.getBoundingClientRect();
    const cont = rootRef.current.getBoundingClientRect();
    const dx = cont.left + cont.width / 2 - (r.left + r.width / 2);
    const dy = cont.top + cont.height * 0.4 - (r.top + r.height / 2);
    setFlying({ carta, flavor: flavores[carta], left: r.left, top: r.top, w: r.width, h: r.height, dx, dy });
    setHand((h) => h.filter((c) => c !== carta)); // quítala de la mano al instante
    jugar(carta);
    // Al aterrizar, la carta se queda en el montoncito (boca arriba, es tuya).
    setTimeout(() => {
      setMyPlayed((m) => [...m, carta]);
      setFlying(null);
    }, 520);
  };
  // --- Chat y reacciones (efímeros, vía broadcast del canal) ---
  const uid7 = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const mostrarReaccion = (mesaId, emoji) => {
    const id = uid7();
    setReactions((r) => [...r, { id, mesaId, emoji }]);
    setTimeout(() => setReactions((r) => r.filter((x) => x.id !== id)), 1400);
  };
  const enviarChat = () => {
    const text = chatInput.trim().slice(0, 200);
    if (!text) return;
    const msg = { id: uid7(), uid, nombre: me?.nombre || "Tú", text };
    chanRef.current?.send({ type: "broadcast", event: "chat", payload: msg });
    setChat((c) => [...c.slice(-59), msg]); // optimista (a mí no me llega el broadcast)
    setChatInput("");
  };
  const enviarReaccion = (mesaId, emoji) => {
    chanRef.current?.send({ type: "broadcast", event: "reaccion", payload: { mesaId, emoji } });
    mostrarReaccion(mesaId, emoji); // optimista
    setReactFor(null);
  };

  const elegirGanadora = (id) => rpc("elegir_ganadora", { p_sala: salaId, p_mesa_id: id });
  const elegirPeor = (id) => rpc("elegir_peor", { p_sala: salaId, p_mesa_id: id });
  const pasar = (target) => rpc("pasar_mamon", { p_sala: salaId, p_target: target });
  const siguiente = () => rpc("siguiente_ronda", { p_sala: salaId });
  const reiniciar = () => rpc("reiniciar_partida", { p_sala: salaId });
  const salir = async () => {
    try {
      await supabase.rpc("abandonar_sala", { p_sala: salaId });
    } catch {
      /* salimos igual */
    }
    onLeave();
  };

  if (!sala) {
    return (
      <div className="og og--loading">
        <p className="og__banner">Conectando con la sala…</p>
      </div>
    );
  }

  // --- Estado / banner ---
  const juezNombre = players.find((p) => p.uid === sala.juez_uid)?.nombre || "…";
  const faceDown = miEfecto === "pela_el_ojo" && fase === "jugando" && !esJuez;
  const blindGreen = miEfecto === "jugar_a_ciegas" && fase === "jugando" && !esJuez && !yaJugue;
  const pasoPeor = modo === "amarga" && !!mejorMesaId;

  let banner = "";
  if (fase === "jugando") {
    if (esJuez) banner = "Eres el Juez. Esperando jugadas…";
    else if (cartasAJugar === 0) banner = "⏳ Esta ronda no envías carta (te demoraste como Juez).";
    else if (congelado) banner = `🥶 Mano congelada… ${congSecs}s`;
    else if (yaJugue) banner = "Ya jugaste. Esperando a los demás…";
    else if (cartasAJugar > 1) banner = `🃏 Jugada doble: juega ${cartasAJugar - misJugadas} carta(s).`;
    else if (blindGreen) banner = "⏳ A ciegas: juega SIN ver el adjetivo.";
    else if (faceDown) banner = "👀 Boca abajo: clic para espiar, doble clic para jugar.";
    else banner = "Elige una carta de tu mano.";
  } else if (fase === "juzgando") {
    if (esJuez) banner = modo === "amarga" ? (pasoPeor ? "Elige la PEOR carta 🤢" : "Elige la MEJOR carta 🏆") : "Elige la carta ganadora.";
    else banner = `${juezNombre} (Juez) está decidiendo…`;
  } else if (fase === "resultado") {
    const g = mesa.find((m) => m.es_ganadora);
    banner = g ? `Ganó: ${g.nombre} con "${g.carta}"` : "Resultado de la ronda";
  } else if (fase === "terminado") {
    const campeon = [...players].sort((a, b) => b.puntos - a.puntos)[0];
    banner = `🏆 ¡${campeon?.nombre} gana la partida!`;
  }

  const puedeAvanzar = fase === "resultado" && (sala.host_uid === uid || esJuez);
  const enMesa = fase === "juzgando" || fase === "resultado" || fase === "terminado";
  const otrosEnMesa = jugaron.filter((u) => u !== uid).length; // rivales que ya jugaron
  const muestraPila = fase === "jugando" && (myPlayed.length > 0 || otrosEnMesa > 0);
  const fx = ruletaEfecto ? EFECTOS[ruletaEfecto] : null;
  const peorNombre = players.find((p) => p.uid === peorUid)?.nombre || "alguien";
  const muestraRuleta = fase === "resultado" && modo === "amarga" && !!ruletaEfecto;

  return (
    <div className="og" ref={rootRef}>
      <header className="og__top">
        <span className="og__code">Sala {codigo}</span>
        <span className="og__meta">
          {modo === "amarga" ? "Amargo 🍋" : "Clásico 🟢"}
          {piensaRapido ? " · ⚡" : ""} · Ronda {ronda} · Meta {meta}
        </span>
        <span className="og__topbtns">
          <button className="og__mute og__chatbtn" onClick={() => setChatOpen((v) => !v)} title="Chat">
            💬
            {chatUnread > 0 && <span className="og__badge">{chatUnread > 9 ? "9+" : chatUnread}</span>}
          </button>
          <button className="og__mute" onClick={toggleMute} title="Sonido">
            {muted ? "🔇" : "🔊"}
          </button>
          <button className="og__leave" onClick={salir}>
            ← Salir
          </button>
        </span>
      </header>

      <div className="og__scores">
        {players.map((p) => {
          const isJuez = p.uid === sala.juez_uid;
          const yo = p.uid === uid;
          const jugo = jugaron.includes(p.uid);
          let estado = null;
          if (isJuez) estado = "⚖️ Juez";
          else if (fase === "jugando") estado = jugo ? "✓ jugó" : "pensando…";
          return (
            <span key={p.uid} className={`chip ${isJuez ? "chip--juez" : ""} ${yo ? "chip--yo" : ""}`}>
              <b className="chip__pts">{p.puntos}</b>
              <span className="chip__name">
                {p.nombre}
                {yo ? " (tú)" : ""}
              </span>
              {estado && <span className="chip__estado">{estado}</span>}
            </span>
          );
        })}
      </div>

      <div className="og__green">
        {blindGreen ? (
          <div className="carta carta--verde carta--oculta">
            <span className="carta__dorso">🟢 ?</span>
          </div>
        ) : (
          <Carta
            color="verde"
            titulo={cartaVerde}
            flavor={flavores[cartaVerde]}
            onLongPress={setPreview}
            onLongPressEnd={cerrarPreview}
          />
        )}
      </div>

      <p className="og__banner">
        {banner}
        {secsLeft != null && ["jugando", "juzgando", "resultado"].includes(fase) && (
          <span className={`og__clock ${secsLeft <= 10 ? "og__clock--urge" : ""}`}> · ⏱ {secsLeft}s</span>
        )}
      </p>
      {error && <p className="og__error">{error}</p>}
      {["juzgando", "resultado"].includes(fase) && piensaRapido && !esJuez && misJugadas === 0 && (
        <p className="og__nota">🐢 Te pasaste de lento: esta ronda tu carta se quedó en la mano.</p>
      )}

      {/* Ruleta del Mamón Amargo */}
      {muestraRuleta && (
        <div className="ruleta">
          <div className="ruleta__pointer" />
          <div className="ruleta__wheel" style={{ transform: `rotate(${rot}deg)`, background: ruletaBg }}>
            {efectosActivos.map((e, idx) => (
              <span
                key={e}
                className="ruleta__seg"
                style={{ transform: `rotate(${idx * segDeg + segDeg / 2}deg) translateY(-54px)` }}
              >
                {EFECTOS[e].emoji}
              </span>
            ))}
            <span className="ruleta__hub" />
          </div>
          {verRes && fx && (
            <div className="ruleta__res">
              <span className="ruleta__quien">
                {peorNombre} {peorUid === uid ? "(¡tú!)" : ""} sacó:
              </span>
              <span className="ruleta__name">
                {fx.emoji} {fx.name}
              </span>
              <span className="ruleta__desc">{fx.desc}</span>
              {peorUid === uid && ruletaEfecto === 5 && (
                <div className="ruleta__pasar">
                  <span>Pásaselo a:</span>
                  <div className="ruleta__targets">
                    {players
                      .filter((p) => p.uid !== uid)
                      .map((p) => (
                        <button key={p.uid} className="og__leave2" onClick={() => pasar(p.uid)}>
                          {p.nombre}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {puedeAvanzar && (
        <button className="og__next" onClick={siguiente}>
          Siguiente ronda →
        </button>
      )}

      {/* Jugadas en el centro */}
      {enMesa && (
        <div className="og__mesa">
          {mesa.map((m) => {
            const esMejor = m.es_ganadora || m.id === mejorMesaId;
            const esPeor = fase === "resultado" && m.jugador_uid && m.jugador_uid === peorUid;
            const clickable = fase === "juzgando" && esJuez && !(pasoPeor && m.id === mejorMesaId);
            const handler = clickable ? () => (pasoPeor ? elegirPeor(m.id) : elegirGanadora(m.id)) : undefined;
            return (
              <div key={m.id} className="og__jugada">
                <Carta
                  color="roja"
                  titulo={m.carta}
                  flavor={flavores[m.carta]}
                  ganadora={esMejor}
                  peor={esPeor}
                  onClick={handler}
                  onLongPress={setPreview}
                  onLongPressEnd={cerrarPreview}
                />

                {/* Emojis flotando sobre la carta */}
                {reactions
                  .filter((r) => r.mesaId === m.id)
                  .map((r) => (
                    <span key={r.id} className="og__reactfloat">
                      {r.emoji}
                    </span>
                  ))}

                {/* Reaccionar a la carta */}
                <button
                  className="og__reactbtn"
                  onClick={() => setReactFor(reactFor === m.id ? null : m.id)}
                  title="Reaccionar"
                >
                  😀
                </button>
                {reactFor === m.id && (
                  <div className="og__reactpick">
                    {["👏", "😂", "🤢", "🔥", "❤️"].map((e) => (
                      <button key={e} onClick={() => enviarReaccion(m.id, e)}>
                        {e}
                      </button>
                    ))}
                  </div>
                )}

                {m.nombre && <span className="og__autor">{m.nombre}</span>}
              </div>
            );
          })}
        </div>
      )}

      {fase === "terminado" && (
        <Recap
          campeon={[...players].sort((a, b) => b.puntos - a.puntos)[0]?.nombre}
          standings={[...players]
            .sort((a, b) => b.puntos - a.puntos)
            .map((p) => ({ nombre: p.nombre, rondas: p.puntos, yo: p.uid === uid }))}
          rondas={sala.historial || []}
          onReplay={sala.host_uid === uid ? reiniciar : null}
          replayLabel="Jugar otra vez"
          onLeave={salir}
          leaveLabel="Salir de la sala"
        />
      )}

      {/* Mano del jugador */}
      {!esJuez && fase !== "terminado" && (
        <div className="og__hand">
          <p className="og__handlabel">Tu mano · mantén pulsada una carta para leerla</p>
          <div className="og__handrow">
            {hand.map((c, i) => {
              const puedeJugar = fase === "jugando" && !yaJugue && !congelado;
              if (faceDown) {
                const espiada = peek[i];
                return (
                  <Carta
                    key={c}
                    color="roja"
                    titulo={c}
                    flavor={flavores[c]}
                    anon={!espiada}
                    onClick={() => setPeek((p) => (p[i] ? {} : { [i]: true }))}
                    onDoubleClick={puedeJugar ? (e) => jugarConAnim(c, e.currentTarget) : undefined}
                    onLongPress={setPreview}
                    onLongPressEnd={cerrarPreview}
                  />
                );
              }
              return (
                <Carta
                  key={c}
                  color="roja"
                  titulo={c}
                  flavor={flavores[c]}
                  onClick={puedeJugar ? (e) => jugarConAnim(c, e.currentTarget) : undefined}
                  disabled={!puedeJugar}
                  onLongPress={setPreview}
                  onLongPressEnd={cerrarPreview}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Vista ampliada al mantener pulsada una carta */}
      {preview && (
        <div className="og__preview" onPointerUp={cerrarPreview} onClick={cerrarPreview}>
          <div className={`og__preview-card og__preview-card--${preview.color}`}>
            <span className="og__preview-titulo">{preview.titulo}</span>
            {preview.flavor && <span className="og__preview-flavor">{preview.flavor}</span>}
          </div>
        </div>
      )}

      {/* Montoncito de cartas jugadas (durante la ronda) */}
      {muestraPila && (
        <div className="og__pile">
          {myPlayed.map((c, i) => (
            <div key={`me-${i}`} className="og__pilecard" style={pileCardStyle(i)}>
              <div className="carta carta--roja">
                <span className="carta__titulo">{c}</span>
              </div>
            </div>
          ))}
          {Array.from({ length: otrosEnMesa }).map((_, i) => (
            <div
              key={`o-${i}`}
              className="og__pilecard"
              style={pileCardStyle(myPlayed.length + i)}
            >
              <div className="carta carta--roja">
                <span className="carta__dorso">
                  <img className="carta__logo" src="/assets/logo.png" alt="" />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Carta volando en arco al montoncito al jugarla */}
      {flying && (
        <div
          className="og__fly"
          style={{
            left: flying.left,
            top: flying.top,
            width: flying.w,
            height: flying.h,
            "--dx": `${flying.dx}px`,
            "--dy": `${flying.dy}px`,
          }}
        >
          <div className="carta carta--roja">
            <span className="carta__titulo">{flying.carta}</span>
            {flying.flavor && <span className="carta__flavor">{flying.flavor}</span>}
          </div>
        </div>
      )}

      {/* Chat de la sala (efímero) */}
      {chatOpen && (
        <div className="og__chat">
          <div className="og__chat-head">
            <span>💬 Chat de la sala</span>
            <button className="og__chat-x" onClick={() => setChatOpen(false)} aria-label="Cerrar">
              ✕
            </button>
          </div>
          <div className="og__chat-log">
            {chat.length === 0 && <p className="og__chat-empty">Aún no hay mensajes. ¡Saluda! 👋</p>}
            {chat.map((m) => (
              <div key={m.id} className={`og__msg ${m.uid === uid ? "og__msg--yo" : ""}`}>
                {m.uid !== uid && <span className="og__msg-name">{m.nombre}</span>}
                <span className="og__msg-text">{m.text}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <form
            className="og__chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              enviarChat();
            }}
          >
            <input
              className="og__chat-input"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              maxLength={200}
              placeholder="Escribe un mensaje…"
            />
            <button className="og__chat-send" type="submit" aria-label="Enviar">
              ➤
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
