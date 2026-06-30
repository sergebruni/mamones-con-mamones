import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { initSfx, isSfxEnabled, setSfxEnabled, spinTicks, beep, beepUrge, ding } from "../lib/sfx.js";
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

const EFECTOS = {
  1: { emoji: "👀", name: "Pela el ojo", desc: "Mano boca abajo: espía y juega de memoria." },
  2: { emoji: "🥶", name: "Mano congelada", desc: "10 segundos sin poder jugar." },
  3: { emoji: "🌪️", name: "Mazo barajado", desc: "¡Mano nueva al azar!" },
  4: { emoji: "⏳", name: "A ciegas", desc: "Juegas sin ver el adjetivo verde." },
  5: { emoji: "🤢", name: "Pasa el mamón", desc: "¡Salvado! Pásaselo a otro." },
  6: { emoji: "🃏", name: "Jugada doble", desc: "Juegas DOS cartas." },
};

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
  const handleClick = () => {
    if (longRef.current) {
      longRef.current = false;
      return; // fue pulsación larga: no dispares el clic
    }
    onClick && onClick();
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
        <span className="carta__dorso">🤔</span>
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
  const cerrarPreview = () => setPreview(null);
  const lastSyncRef = useRef("");
  const firedRef = useRef(0);
  const turnsRef = useRef(5);
  const dingRef = useRef("");

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
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") await ch.track({});
      });

    return () => supabase.removeChannel(ch);
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

  // Reiniciar "peek" cuando cambia la ronda/mano.
  useEffect(() => setPeek({}), [ronda]);

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
      const seg = ruletaEfecto - 1;
      setRot(360 * turnsRef.current - (seg * 60 + 30));
      setVerRes(false);
      spinTicks(2600);
      const t = setTimeout(() => setVerRes(true), 2600);
      return () => clearTimeout(t);
    }
  }, [fase, ruletaEfecto, peorUid]);

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
  const fx = ruletaEfecto ? EFECTOS[ruletaEfecto] : null;
  const peorNombre = players.find((p) => p.uid === peorUid)?.nombre || "alguien";
  const muestraRuleta = fase === "resultado" && modo === "amarga" && !!ruletaEfecto;

  return (
    <div className="og">
      <header className="og__top">
        <span className="og__code">Sala {codigo}</span>
        <span className="og__meta">
          {modo === "amarga" ? "Amargo 🍋" : "Clásico 🟢"}
          {piensaRapido ? " · ⚡" : ""} · Ronda {ronda} · Meta {meta}
        </span>
        <span className="og__topbtns">
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
          <div className="ruleta__wheel" style={{ transform: `rotate(${rot}deg)` }}>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <span
                key={i}
                className="ruleta__seg"
                style={{ transform: `rotate(${(i - 1) * 60 + 30}deg) translateY(-54px)` }}
              >
                {EFECTOS[i].emoji}
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
                {m.nombre && <span className="og__autor">{m.nombre}</span>}
              </div>
            );
          })}
        </div>
      )}

      {fase === "terminado" && (
        <div className="og__endbtns">
          {sala.host_uid === uid && (
            <button className="og__next" onClick={reiniciar}>
              Jugar otra vez
            </button>
          )}
          <button className="og__leave2" onClick={salir}>
            Salir de la sala
          </button>
        </div>
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
                    onClick={() => setPeek((p) => ({ ...p, [i]: !p[i] }))}
                    onDoubleClick={puedeJugar ? () => jugar(c) : undefined}
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
                  onClick={puedeJugar ? () => jugar(c) : undefined}
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
    </div>
  );
}
