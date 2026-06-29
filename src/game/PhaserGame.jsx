import { useEffect, useRef } from "react";
import { createGame } from "./config.js";

// Monta una instancia de Phaser dentro de un div y le pasa la config de partida.
export default function PhaserGame({ config }) {
  const parentRef = useRef(null);
  const gameRef = useRef(null);

  useEffect(() => {
    gameRef.current = createGame(parentRef.current, config);
    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
    // Solo al montar: la config se fija al crear la partida.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={parentRef} style={{ width: "100%", height: "100%" }} />;
}
