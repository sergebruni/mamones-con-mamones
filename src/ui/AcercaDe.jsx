import "./AcercaDe.css";

export default function AcercaDe({ onClose }) {
  return (
    <div className="acerca" onClick={onClose}>
      <div className="acerca__panel" onClick={(e) => e.stopPropagation()}>
        <button className="acerca__x" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>
        <h2 className="acerca__title">👥 Acerca de / Nuestro Equipo</h2>

        <section className="acerca__sec">
          <h3>¿Quiénes somos?</h3>
          <p>
            Detrás de este proyecto no hay una corporación gigante, sino <b>Zona Gaming</b>: un grupo
            de amigos venezolanos apasionados por los videojuegos que, tras incontables noches de
            juego, debates y memes en nuestro chat de WhatsApp, decidimos llevar el "chalequeo" al
            siguiente nivel.
          </p>
          <p>
            Lo que empezó como charlas cotidianas y ganas de competir entre panas, se convirtió en la
            chispa para crear experiencias interactivas propias. Queremos rescatar esa esencia de los
            juegos de mesa clásicos —la rivalidad sana, las risas y las mecánicas impredecibles— y
            adaptarla al ecosistema web moderno.
          </p>
        </section>

        <section className="acerca__sec">
          <h3>¿Cómo nació este juego?</h3>
          <p>
            Este título es el primer paso de nuestra aventura como desarrolladores independientes.
            Nació de una idea original de <b>José Alejandro Gómez</b>, quien imaginó las dinámicas y el
            concepto base del juego. Esa chispa fue tomada por{" "}
            <a
              className="acerca__link"
              href="https://x.com/sergebruni"
              target="_blank"
              rel="noopener noreferrer"
            >
              Sergio Bruni
            </a>
            , quien asumió el reto del desarrollo técnico, transformando las reglas de papel y los
            conceptos visuales en un juego online funcional, robusto y en tiempo real.
          </p>
        </section>

        <section className="acerca__sec">
          <h3>Nuestra Filosofía</h3>
          <p>
            En Zona Gaming, creemos que los mejores juegos son aquellos que se disfrutan en comunidad.
            Nos enfocamos en el desarrollo de juegos indie que sean:
          </p>
          <ul className="acerca__list">
            <li>
              <b>Accesibles:</b> listos para jugar desde cualquier navegador sin complicaciones.
            </li>
            <li>
              <b>Interactivos:</b> con mecánicas dinámicas en tiempo real donde cada turno cuenta.
            </li>
            <li>
              <b>Auténticos:</b> con una fuerte identidad y un toque de picardía que nos representa.
            </li>
          </ul>
          <p>
            Este juego es solo el inicio. Como grupo de amigos y creadores, nuestro objetivo es seguir
            expandiendo este universo y desarrollar nuevos títulos bajo este sello, llevando la
            diversión de nuestra comunidad a las pantallas de todo el mundo.
          </p>
        </section>

        <button className="btn btn--primary acerca__ok" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
