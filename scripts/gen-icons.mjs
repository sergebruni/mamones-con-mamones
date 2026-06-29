// Genera los íconos PWA (192/512/maskable + apple-touch) desde un SVG del mamón.
// Uso: bun scripts/gen-icons.mjs
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("public/icons", { recursive: true });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="fruta" cx="40%" cy="34%" r="72%">
      <stop offset="0%" stop-color="#bdf07a"/>
      <stop offset="60%" stop-color="#7cc043"/>
      <stop offset="100%" stop-color="#4f8f2a"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="#14241a"/>
  <rect x="246" y="92" width="20" height="60" rx="9" fill="#6b4a2a"/>
  <path d="M262 118 q70 -26 96 18 q-58 30 -96 -4 z" fill="#2e8b2e"/>
  <circle cx="256" cy="274" r="150" fill="url(#fruta)"/>
  <ellipse cx="208" cy="226" rx="46" ry="30" fill="#ffffff" opacity="0.28"/>
</svg>`;

const buf = Buffer.from(svg);
writeFileSync("public/icons/icon.svg", svg);

const out = async (size, name) =>
  sharp(buf).resize(size, size).png().toFile(`public/icons/${name}`);

await out(192, "icon-192.png");
await out(512, "icon-512.png");
await out(512, "maskable-512.png");
await out(180, "apple-touch-icon.png");

console.log("Íconos generados en public/icons/");
