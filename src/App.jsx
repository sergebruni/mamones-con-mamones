import { useState } from "react";
import Menu from "./ui/Menu.jsx";
import Lobby from "./ui/Lobby.jsx";
import PhaserGame from "./game/PhaserGame.jsx";

// Lee ?sala=CODIGO de la URL (enlace de invitación) una sola vez y lo limpia.
function leerInvitacion() {
  try {
    const code = new URLSearchParams(window.location.search).get("sala");
    if (!code) return "";
    const url = new URL(window.location.href);
    url.searchParams.delete("sala");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    return code.trim().toUpperCase().slice(0, 6);
  } catch {
    return "";
  }
}
const INVITACION = leerInvitacion();

// Pantallas: "menu" | "sp" (single-player) | "lobby" (multijugador).
export default function App() {
  const [screen, setScreen] = useState(INVITACION ? "lobby" : "menu");
  const [gameConfig, setGameConfig] = useState(null);

  if (screen === "sp" && gameConfig) {
    return (
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <PhaserGame config={gameConfig} />
        <button
          onClick={() => {
            setGameConfig(null);
            setScreen("menu");
          }}
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            zIndex: 10,
            background: "rgba(12,33,20,0.85)",
            color: "var(--text-light)",
            border: "1px solid var(--panel-border)",
            borderRadius: 10,
            padding: "8px 14px",
            fontSize: 15,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          ← Menú
        </button>
      </div>
    );
  }

  if (screen === "lobby") {
    return <Lobby initialCode={INVITACION} onBack={() => setScreen("menu")} />;
  }

  return (
    <Menu
      onStart={(config) => {
        setGameConfig(config);
        setScreen("sp");
      }}
      onMultiplayer={() => setScreen("lobby")}
    />
  );
}
