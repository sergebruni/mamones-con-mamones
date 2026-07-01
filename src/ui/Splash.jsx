import { useEffect } from "react";
import "./Splash.css";

// Pantalla de bienvenida con el logo; se desvanece sola (o al tocar).
export default function Splash({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1700);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="splash" onClick={onDone}>
      <img className="splash__logo" src="/assets/logo.png" alt="Mamones con Mamones" />
    </div>
  );
}
