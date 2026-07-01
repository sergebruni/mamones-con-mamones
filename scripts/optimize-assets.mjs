// Optimiza las imágenes de public/assets (redimensiona + recomprime, sin cambiar
// nombres ni formato, para no tocar el código que las referencia).
// Uso: bun scripts/optimize-assets.mjs
import sharp from "sharp";
import { readFileSync, writeFileSync, statSync } from "node:fs";

// Ancho objetivo por archivo (alto se calcula manteniendo el aspecto).
// Se elige según el tamaño máximo al que se muestran (con margen para retina).
const JOBS = [
  { file: "public/assets/logo.png", width: 640 }, // splash/home ≤360px, reversos
  { file: "public/assets/favicon.png", width: 128 }, // ícono de pestaña
  { file: "public/assets/mamon_amarillo.png", width: 560 }, // plantilla carta roja
  { file: "public/assets/mamon_verde.png", width: 560 }, // plantilla carta verde
];

let totalBefore = 0;
let totalAfter = 0;

for (const { file, width } of JOBS) {
  const before = statSync(file).size;
  const input = readFileSync(file); // leer a buffer para poder sobrescribir el mismo path
  const out = await sharp(input)
    .resize({ width, withoutEnlargement: true })
    .png({ compressionLevel: 9, effort: 10, palette: true, quality: 90 })
    .toBuffer();
  writeFileSync(file, out);
  totalBefore += before;
  totalAfter += out.length;
  console.log(
    `${file}: ${(before / 1024).toFixed(0)} KB -> ${(out.length / 1024).toFixed(0)} KB  (ancho ${width}px)`
  );
}

console.log(
  `\nTotal: ${(totalBefore / 1024).toFixed(0)} KB -> ${(totalAfter / 1024).toFixed(0)} KB ` +
    `(${(100 - (totalAfter / totalBefore) * 100).toFixed(0)}% menos)`
);
