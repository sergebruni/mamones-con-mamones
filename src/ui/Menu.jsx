import { useState } from "react";
import "./Menu.css";

const PIENSA_RAPIDO_INFO =
  "El último en escoger su carta no juega esa ronda: la carta se le regresa a la mano.";

const MODES = [
  {
    id: "clasica",
    name: "Clásica",
    desc: "El modo de siempre: el Juez elige la carta roja que mejor le pega al adjetivo.",
  },
  {
    id: "amarga",
    name: "Amarga",
    desc: "Variante con otra mecánica (en construcción).",
    badge: "Beta",
  },
];

export default function Menu({ onStart, onMultiplayer }) {
  const [step, setStep] = useState("home"); // home | create
  const [mode, setMode] = useState("clasica");
  const [piensaRapido, setPiensaRapido] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div className="menu">
      <div className="menu__panel">
        <h1 className="menu__title">🍈 Mamones con Mamones</h1>

        {step === "home" && (
          <div className="menu__buttons">
            <button className="btn btn--primary" onClick={() => setStep("create")}>
              Crear partida
            </button>
            <button className="btn" onClick={onMultiplayer}>
              Multijugador (beta)
            </button>
            <button className="btn" disabled>
              Cómo jugar
            </button>
            <button className="btn" disabled>
              Opciones
            </button>
          </div>
        )}

        {step === "create" && (
          <div className="create">
            <p className="create__label">Elige el modo de juego</p>

            <div className="modes">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  className={`mode ${mode === m.id ? "mode--active" : ""}`}
                  onClick={() => setMode(m.id)}
                >
                  <span className="mode__name">
                    {m.name}
                    {m.badge && <span className="mode__badge">{m.badge}</span>}
                  </span>
                  <span className="mode__desc">{m.desc}</span>
                </button>
              ))}
            </div>

            <div className="toggle-row">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={piensaRapido}
                  onChange={(e) => setPiensaRapido(e.target.checked)}
                />
                <span className="toggle__track">
                  <span className="toggle__thumb" />
                </span>
                <span className="toggle__text">Activar piensa rápido</span>
              </label>

              <span
                className="info"
                tabIndex={0}
                onMouseEnter={() => setShowInfo(true)}
                onMouseLeave={() => setShowInfo(false)}
                onClick={() => setShowInfo((v) => !v)}
                onFocus={() => setShowInfo(true)}
                onBlur={() => setShowInfo(false)}
                aria-label={PIENSA_RAPIDO_INFO}
              >
                i
                {showInfo && <span className="info__tip">{PIENSA_RAPIDO_INFO}</span>}
              </span>
            </div>

            <div className="create__actions">
              <button className="btn btn--ghost" onClick={() => setStep("home")}>
                ← Volver
              </button>
              <button
                className="btn btn--primary"
                onClick={() => onStart({ mode, piensaRapido })}
              >
                Comenzar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
