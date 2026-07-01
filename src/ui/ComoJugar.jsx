import "./ComoJugar.css";

// Efectos de La Ruleta del Mamón Amargo (mismo contenido que el juego).
const EFECTOS = [
  { emoji: "👀", name: "Pela el ojo", desc: "Tu mano queda boca abajo: espía y juega de memoria." },
  { emoji: "🥶", name: "Mano congelada", desc: "10 segundos sin poder jugar (solo si Piensa Rápido está activo)." },
  { emoji: "🌪️", name: "Mazo barajado", desc: "¡Adiós a tu mano! Recibes 7 cartas nuevas al azar." },
  { emoji: "⏳", name: "A ciegas", desc: "Eliges tu carta sin ver el adjetivo verde." },
  { emoji: "🤢", name: "Pasa el mamón", desc: "¡Salvado! Le pasas la ruleta a otro jugador." },
  { emoji: "🃏", name: "Jugada doble", desc: "Esta ronda juegas DOS cartas." },
];

export default function ComoJugar({ onClose }) {
  return (
    <div className="como" onClick={onClose}>
      <div className="como__panel" onClick={(e) => e.stopPropagation()}>
        <button className="como__x" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>
        <h2 className="como__title">Cómo jugar</h2>

        <section className="como__sec">
          <h3>🎯 Objetivo</h3>
          <p>
            Cada ronda hay un <b>adjetivo verde</b> y tú juegas la <b>carta roja</b> (un sustantivo o
            frase) que mejor le pegue. El <b>Juez</b> de la ronda elige la ganadora. Gana quien
            primero llegue a la meta de puntos.
          </p>
        </section>

        <section className="como__sec">
          <h3>🔄 La ronda</h3>
          <ol>
            <li>Se revela una carta <b>verde</b> (el adjetivo).</li>
            <li>Todos menos el Juez juegan una carta <b>roja</b> de su mano.</li>
            <li>El <b>Juez</b> lee las jugadas (anónimas) y elige la mejor.</li>
            <li>El ganador suma un punto, se reponen las manos y el Juez rota.</li>
          </ol>
        </section>

        <section className="como__sec">
          <h3>🏆 Meta de puntos</h3>
          <p>
            Depende de cuántos jueguen: <b>4→8 · 5→7 · 6→6 · 7→5 · 8+→4</b>. (En línea el host puede
            fijarla desde la sala.)
          </p>
        </section>

        <section className="como__sec">
          <h3>🃏 Modos</h3>
          <p>
            <b>Clásico:</b> el Juez elige solo la mejor.
          </p>
          <p>
            <b>Amargo 🍋:</b> el Juez elige la mejor <i>y la peor</i>. Quien saca la peor gira{" "}
            <b>La Ruleta del Mamón Amargo</b>.
          </p>
        </section>

        <section className="como__sec">
          <h3>🎡 La Ruleta del Mamón Amargo</h3>
          <div className="como__fx">
            {EFECTOS.map((e) => (
              <div key={e.name} className="como__fxrow">
                <span className="como__fxemoji">{e.emoji}</span>
                <span>
                  <b>{e.name}.</b> {e.desc}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="como__sec">
          <h3>⚡ Piensa Rápido</h3>
          <p>
            Opción para partidas de <b>más de 5 jugadores</b>: el <b>último</b> en jugar pierde su
            carta esa ronda… salvo que <b>todos jueguen en menos de 5 segundos</b>, ahí no se castiga
            a nadie.
          </p>
        </section>

        <section className="como__sec">
          <h3>🗂️ Las cartas</h3>
          <p>
            En una partida <b>no se repiten</b> cartas, y las que se juegan <b>se descartan</b>: no
            vuelven a aparecer hasta que termine la partida.
          </p>
        </section>

        <button className="btn btn--primary como__ok" onClick={onClose}>
          ¡Entendido!
        </button>
      </div>
    </div>
  );
}
