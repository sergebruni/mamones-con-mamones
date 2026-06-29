import Phaser from "phaser";
import Preloader from "./scenes/Preloader.js";
import GameScene from "./scenes/GameScene.js";
import cartas from "./data/cartas.json";

// Crea la instancia de Phaser dentro de `parent` con la config de partida elegida
// en el menú (modo, piensaRapido). Los datos se exponen vía el registry del juego.
export function createGame(parent, gameConfig) {
  const config = {
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#14241a",
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: window.innerWidth,
      height: window.innerHeight,
    },
    scene: [Preloader, GameScene],
  };

  const game = new Phaser.Game(config);
  game.registry.set("cartas", cartas);
  game.registry.set("gameConfig", gameConfig || { mode: "clasica", piensaRapido: false });
  return game;
}
