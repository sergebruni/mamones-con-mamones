import "./Recap.css";

const MEDALLAS = ["🥇", "🥈", "🥉"];

// Recap de fin de partida, compartido por single-player (Phaser, vía PhaserGame)
// y multijugador (OnlineGame). Muestra el campeón, el podio (rondas ganadas por
// jugador) y el repaso ronda a ronda (verde → roja ganadora → quién ganó).
//
// Props:
//   campeon      string        — nombre del ganador de la partida
//   standings    [{nombre, rondas, yo}] — jugadores ordenados por rondas ganadas
//   rondas       [{ronda, verde, roja, ganador}] — historial en orden de juego
//   onReplay     fn | null     — "Jugar otra vez" (null lo oculta; p. ej. no-host)
//   replayLabel  string
//   onLeave      fn            — salir / volver al menú
//   leaveLabel   string
export default function Recap({
  campeon,
  standings = [],
  rondas = [],
  onReplay,
  replayLabel = "Jugar otra vez",
  onLeave,
  leaveLabel = "Salir",
}) {
  return (
    <div className="recap">
      <div className="recap__panel">
        <p className="recap__eyebrow">Fin de la partida · Campeón</p>
        <h1 className="recap__champ">🏆 {campeon || "Nadie"}</h1>

        <div className="recap__sec">
          <h3 className="recap__h3">Podio</h3>
          <ol className="recap__podio">
            {standings.map((p, i) => (
              <li key={i} className={`recap__row ${p.yo ? "recap__row--yo" : ""}`}>
                <span className="recap__pos">{MEDALLAS[i] || `${i + 1}.`}</span>
                <span className="recap__name">
                  {p.nombre}
                  {p.yo && p.nombre !== "Tú" ? " (tú)" : ""}
                </span>
                <span className="recap__rondas">
                  {p.rondas} {p.rondas === 1 ? "ronda" : "rondas"}
                </span>
              </li>
            ))}
          </ol>
        </div>

        {rondas.length > 0 && (
          <div className="recap__sec">
            <h3 className="recap__h3">Repaso ronda a ronda</h3>
            <ul className="recap__rondas-list">
              {rondas.map((r, i) => (
                <li key={i} className="recap__ronda">
                  <span className="recap__rnum">#{r.ronda ?? i + 1}</span>
                  <div className="recap__jugada">
                    <span className="recap__verde">{r.verde}</span>
                    <span className="recap__flecha">→</span>
                    <span className="recap__roja">{r.roja}</span>
                  </div>
                  <span className="recap__gano">🏅 {r.ganador}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="recap__btns">
          {onReplay && (
            <button className="recap__btn recap__btn--primary" onClick={onReplay}>
              {replayLabel}
            </button>
          )}
          <button className="recap__btn recap__btn--ghost" onClick={onLeave}>
            {leaveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
