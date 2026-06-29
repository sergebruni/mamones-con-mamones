import { useEffect, useRef, useState } from "react";
import { supabase, ensureAuth } from "../lib/supabase.js";
import OnlineGame from "./OnlineGame.jsx";
import "./Lobby.css";

const MIN_JUGADORES = 4;

export default function Lobby({ onBack }) {
  const [uid, setUid] = useState(null);
  const [nombre, setNombre] = useState(() => localStorage.getItem("mcm_nombre") || "");
  const [codigoInput, setCodigoInput] = useState("");
  const [room, setRoom] = useState(null); // { codigo, sala_id }
  const [players, setPlayers] = useState([]);
  const [fase, setFase] = useState("lobby");
  const [config, setConfig] = useState({ modo: "clasica", piensaRapido: false });
  const [hostUid, setHostUid] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const channelRef = useRef(null);
  const lastSyncRef = useRef("");

  const isHost = hostUid === uid;

  const entrarSala = (codigo, sala_id) => {
    localStorage.setItem("mcm_room", JSON.stringify({ codigo, sala_id }));
    setFase("lobby");
    setRoom({ codigo, sala_id });
  };

  useEffect(() => {
    ensureAuth()
      .then((u) => setUid(u.id))
      .catch((e) => setError("No se pudo iniciar sesión: " + e.message));
  }, []);

  // Reconexión: si quedó una sala guardada y seguimos siendo miembros, reentrar.
  useEffect(() => {
    if (!uid || room) return;
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem("mcm_room") || "null");
    } catch {
      saved = null;
    }
    if (!saved?.sala_id) return;
    (async () => {
      const { data: sala } = await supabase
        .from("salas")
        .select("id,codigo,host_uid,fase")
        .eq("id", saved.sala_id)
        .maybeSingle();
      if (!sala) return localStorage.removeItem("mcm_room");
      const { data: me } = await supabase
        .from("jugadores_sala")
        .select("uid")
        .eq("sala_id", sala.id)
        .eq("uid", uid)
        .maybeSingle();
      if (!me) return localStorage.removeItem("mcm_room");
      setHostUid(sala.host_uid);
      setFase(sala.fase);
      setRoom({ codigo: sala.codigo, sala_id: sala.id });
    })();
  }, [uid, room]);

  // Presencia + cambios de la sala (fase) mientras estamos dentro.
  useEffect(() => {
    if (!room || !uid) return;

    // Estado inicial (fase + config).
    supabase
      .from("salas")
      .select("fase,config,host_uid")
      .eq("id", room.sala_id)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setFase(data.fase);
        setHostUid(data.host_uid);
        if (data.config) setConfig(data.config);
      });

    const channel = supabase.channel(`sala:${room.codigo}`, {
      config: { presence: { key: uid } },
    });
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        setPlayers(Object.entries(state).map(([key, metas]) => ({ uid: key, ...(metas[0] || {}) })));
        // Reportar conectados (deduplicado) para migrar host si hace falta.
        const connected = Object.keys(state);
        const key = connected.slice().sort().join(",");
        if (key !== lastSyncRef.current) {
          lastSyncRef.current = key;
          supabase.rpc("marcar_conectados", { p_sala: room.sala_id, p_conectados: connected });
        }
      })
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "salas", filter: `id=eq.${room.sala_id}` },
        (payload) => {
          setFase(payload.new.fase);
          setHostUid(payload.new.host_uid);
          if (payload.new.config) setConfig(payload.new.config);
        }
      )
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") await channel.track({ nombre });
      });

    // Respaldo por si se pierde un evento de Realtime (p. ej. el inicio de partida).
    const poll = setInterval(async () => {
      const { data } = await supabase
        .from("salas")
        .select("fase,config,host_uid")
        .eq("id", room.sala_id)
        .maybeSingle();
      if (!data) return;
      setFase(data.fase);
      setHostUid(data.host_uid);
      if (data.config) setConfig(data.config);
    }, 3000);

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      clearInterval(poll);
      setPlayers([]);
    };
  }, [room, uid, nombre]);

  const guardarNombre = (v) => {
    setNombre(v);
    localStorage.setItem("mcm_nombre", v);
  };

  const crearSala = async () => {
    if (!nombre.trim()) return setError("Escribe tu nombre primero.");
    setError("");
    setBusy(true);
    const { data, error } = await supabase.rpc("crear_sala", { p_nombre: nombre.trim() });
    setBusy(false);
    if (error) return setError(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    setHostUid(uid); // el creador es host
    entrarSala(row.codigo, row.sala_id);
  };

  const unirseSala = async () => {
    if (!nombre.trim()) return setError("Escribe tu nombre primero.");
    if (!codigoInput.trim()) return setError("Escribe el código de la sala.");
    setError("");
    setBusy(true);
    const code = codigoInput.trim().toUpperCase();
    const { data, error } = await supabase.rpc("unirse_sala", { p_codigo: code, p_nombre: nombre.trim() });
    setBusy(false);
    if (error) return setError(error.message);
    entrarSala(code, data);
  };

  // El host actualiza la config; todos la ven por Realtime.
  const guardarConfig = async (modo, piensaRapido) => {
    setConfig({ modo, piensaRapido }); // optimista
    const { error } = await supabase.rpc("set_config_sala", {
      p_sala: room.sala_id,
      p_modo: modo,
      p_piensa: piensaRapido,
    });
    if (error) setError(error.message);
  };
  const elegirModo = (modo) => guardarConfig(modo, config.piensaRapido);
  const togglePiensa = () => guardarConfig(config.modo, !config.piensaRapido);

  const iniciarPartida = async () => {
    setError("");
    setBusy(true);
    const { error } = await supabase.rpc("iniciar_partida", { p_sala: room.sala_id });
    setBusy(false);
    if (error) setError(error.message);
  };

  const salir = async () => {
    if (room) {
      try {
        await supabase.rpc("abandonar_sala", { p_sala: room.sala_id });
      } catch {
        /* salimos igual */
      }
    }
    localStorage.removeItem("mcm_room");
    setRoom(null);
    setFase("lobby");
    setHostUid(null);
    setError("");
  };

  // ---- Partida en curso: tablero online ----
  if (room && fase !== "lobby") {
    return <OnlineGame salaId={room.sala_id} uid={uid} codigo={room.codigo} onLeave={salir} />;
  }

  // ---- En sala, esperando el inicio ----
  if (room) {
    return (
      <div className="lobby">
        <div className="lobby__panel">
          <p className="lobby__eyebrow">Sala</p>
          <h1 className="lobby__code">{room.codigo}</h1>

          <p className="lobby__hint">Comparte este código para que se unan.</p>

          <div className="players">
            <p className="players__title">Conectados ({players.length})</p>
            {players.length === 0 && <p className="players__empty">Conectando…</p>}
            {players.map((p) => (
              <div key={p.uid} className="player">
                <span className="player__dot" />
                <span className="player__name">
                  {p.nombre || "Jugador"}
                  {p.uid === uid ? " (tú)" : ""}
                </span>
                {p.uid === hostUid && <span className="player__host">HOST</span>}
              </div>
            ))}
          </div>

          <div className="cfg">
            <p className="cfg__label">Modo de juego</p>
            {room.isHost ? (
              <div className="seg">
                <button
                  className={`seg__btn ${config.modo === "clasica" ? "seg__btn--active" : ""}`}
                  onClick={() => elegirModo("clasica")}
                >
                  Clásico
                </button>
                <button
                  className={`seg__btn ${config.modo === "amarga" ? "seg__btn--active" : ""}`}
                  onClick={() => elegirModo("amarga")}
                >
                  Amargo
                </button>
              </div>
            ) : (
              <p className="cfg__ro">{config.modo === "amarga" ? "Amargo 🍋" : "Clásico 🟢"}</p>
            )}

            <div className="cfg__rapido">
              {isHost ? (
                <label className="switch">
                  <input type="checkbox" checked={!!config.piensaRapido} onChange={togglePiensa} />
                  <span className="switch__track"><span className="switch__thumb" /></span>
                  <span className="switch__text">Activar piensa rápido</span>
                </label>
              ) : (
                <p className="cfg__ro">
                  Piensa rápido: {config.piensaRapido ? "Activado ⚡" : "Desactivado"}
                </p>
              )}
            </div>
          </div>

          {isHost ? (
            <button
              className="btn btn--primary"
              disabled={busy || players.length < MIN_JUGADORES}
              onClick={iniciarPartida}
            >
              {players.length < MIN_JUGADORES
                ? `Faltan ${MIN_JUGADORES - players.length} jugador(es)`
                : "Iniciar partida"}
            </button>
          ) : (
            <p className="lobby__soon">Esperando a que el host inicie la partida…</p>
          )}

          {error && <p className="lobby__error">{error}</p>}

          <div className="lobby__actions">
            <button className="btn btn--ghost" onClick={salir}>
              ← Salir de la sala
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Home del lobby ----
  return (
    <div className="lobby">
      <div className="lobby__panel">
        <h1 className="lobby__title">Jugar en línea</h1>

        <label className="field">
          <span className="field__label">Tu nombre</span>
          <input
            className="field__input"
            value={nombre}
            maxLength={20}
            placeholder="Ej: El Pollo"
            onChange={(e) => guardarNombre(e.target.value)}
          />
        </label>

        <button className="btn btn--primary" disabled={busy || !uid} onClick={crearSala}>
          Crear partida
        </button>

        <div className="divider"><span>o</span></div>

        <label className="field">
          <span className="field__label">Código de sala</span>
          <input
            className="field__input field__input--code"
            value={codigoInput}
            maxLength={6}
            placeholder="MAMON7"
            onChange={(e) => setCodigoInput(e.target.value.toUpperCase())}
          />
        </label>
        <button className="btn" disabled={busy || !uid} onClick={unirseSala}>
          Unirse con código
        </button>

        {error && <p className="lobby__error">{error}</p>}
        {!uid && !error && <p className="lobby__hint">Iniciando sesión…</p>}

        <div className="lobby__actions">
          <button className="btn btn--ghost" onClick={onBack}>
            ← Volver
          </button>
        </div>
      </div>
    </div>
  );
}
