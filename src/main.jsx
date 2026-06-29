import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// Sin StrictMode a propósito: evita que React monte/desmonte dos veces en dev
// y cree dos instancias de Phaser.
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
