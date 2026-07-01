import { useEffect, useRef, useState } from "react";
import { createGame } from "./config.js";
import Recap from "../ui/Recap.jsx";

// Monta una instancia de Phaser dentro de un div y le pasa la config de partida.
// Al terminar la partida, GameScene emite 'mcm:gameover' con los datos del recap;
// aquí lo mostramos como overlay en el DOM (mismo componente que el multijugador).
export default function PhaserGame({ config, onExit }) {
  const parentRef = useRef(null);
  const gameRef = useRef(null);
  const [recap, setRecap] = useState(null);

  useEffect(() => {
    const game = createGame(parentRef.current, config);
    gameRef.current = game;
    game.events.on("mcm:gameover", setRecap);
    return () => {
      game.events.off("mcm:gameover", setRecap);
      game.destroy(true);
      gameRef.current = null;
    };
    // Solo al montar: la config se fija al crear la partida.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const jugarDeNuevo = () => {
    gameRef.current?.events.emit("mcm:replay");
    setRecap(null);
  };

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <div ref={parentRef} style={{ width: "100%", height: "100%" }} />
      {recap && (
        <Recap
          campeon={recap.campeon}
          standings={recap.standings}
          rondas={recap.rondas}
          onReplay={jugarDeNuevo}
          replayLabel="Jugar de nuevo"
          onLeave={onExit}
          leaveLabel="← Menú"
        />
      )}
    </div>
  );
}
