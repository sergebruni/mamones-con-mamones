// Escena de carga: muestra una pantalla simple y precarga las plantillas de cartas.
import Phaser from "phaser";

export default class Preloader extends Phaser.Scene {
  constructor() {
    super({ key: "Preloader" });
  }

  preload() {
    const { width, height } = this.scale;

    // Texto de carga
    this.add
      .text(width / 2, height / 2 - 20, "Mamones con Mamones", {
        fontFamily: "Segoe UI, sans-serif",
        fontSize: "40px",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height / 2 + 30, "Cargando...", {
        fontFamily: "Segoe UI, sans-serif",
        fontSize: "20px",
        color: "#9fd6a3",
      })
      .setOrigin(0.5);

    // Plantillas de cartas (servidas desde public/assets por Vite).
    this.load.image("plantillaVerde", "assets/mamon_verde.png"); // adjetivos
    this.load.image("plantillaAmarilla", "assets/mamon_amarillo.png"); // sustantivos
    // Los mazos (cartas.json) llegan por el registry del juego, no por el loader.
  }

  create() {
    // Pequeña pausa para que se vea la pantalla de carga y luego al juego.
    this.time.delayedCall(500, () => this.scene.start("GameScene"));
  }
}
