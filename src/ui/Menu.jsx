import { useState } from "react";
import ComoJugar from "./ComoJugar.jsx";
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
    desc: "El Juez elige la mejor y la PEOR; quien saca la peor gira La Ruleta del Mamón Amargo.",
    badge: "Beta",
  },
];

const PLAYER_OPTIONS = [4, 5, 6];

export default function Menu({ onStart, onMultiplayer }) {
  const [step, setStep] = useState("home"); // home | create
  const [mode, setMode] = useState("clasica");
  const [players, setPlayers] = useState(4); // total: tú + bots
  const [piensaRapido, setPiensaRapido] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showComo, setShowComo] = useState(false);

  const piensaDisponible = players > 5; // regla del online: solo con más de 5

  return (
    <div className="menu">
      <div className="menu__panel">
        <h1 className="menu__title">
          <img className="menu__logo" src="/assets/logo.png" alt="Mamones con Mamones" />
        </h1>

        {step === "home" && (
          <div className="menu__buttons">
            <button className="btn btn--primary" onClick={() => setStep("create")}>
              Crear partida
            </button>
            <button className="btn" onClick={onMultiplayer}>
              Multijugador (beta)
            </button>
            <button className="btn" onClick={() => setShowComo(true)}>
              Cómo jugar
            </button>
            <button className="btn" disabled>
              Opciones
            </button>
          </div>
        )}

        {step === "create" && (
          <div className="create">
            <p className="create__label">¿Cuántos jugadores? (tú + bots)</p>
            <div className="pcount">
              {PLAYER_OPTIONS.map((n) => (
                <button
                  key={n}
                  className={`pcount__btn ${players === n ? "pcount__btn--active" : ""}`}
                  onClick={() => setPlayers(n)}
                >
                  {n}
                </button>
              ))}
            </div>

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
              <label className={`toggle ${piensaDisponible ? "" : "toggle--off"}`}>
                <input
                  type="checkbox"
                  checked={piensaRapido && piensaDisponible}
                  disabled={!piensaDisponible}
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
            {!piensaDisponible && (
              <p className="create__note">Piensa rápido requiere más de 5 jugadores.</p>
            )}

            <div className="create__actions">
              <button className="btn btn--ghost" onClick={() => setStep("home")}>
                ← Volver
              </button>
              <button
                className="btn btn--primary"
                onClick={() =>
                  onStart({ mode, players, piensaRapido: piensaRapido && piensaDisponible })
                }
              >
                Comenzar
              </button>
            </div>
          </div>
        )}
      </div>

      {showComo && <ComoJugar onClose={() => setShowComo(false)} />}
    </div>
  );
}
