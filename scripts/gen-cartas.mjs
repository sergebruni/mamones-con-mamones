// Genera el seed SQL de cartas para Supabase a partir de los CSV del Sheet.
//
// Dos mazos:
//   - ROJA  (respuestas, lo que se juega): cartas.csv  -> TODO se trata como Roja.
//   - VERDE (prompts/adjetivos del Juez):  db/verdes.csv
//
// Columnas reconocidas (encabezados en cualquier orden, puede haber fila vacía arriba):
//   [INDICE], [COLOR], TIPO, TEXTO, FLAVOR
//   TIPO vacío => "Otros". FLAVOR es opcional. La columna COLOR de cartas.csv se ignora
//   (hoy todas las cartas de ese archivo son respuestas Roja).
//
// Uso: bun scripts/gen-cartas.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const ROJA_CANDIDATES = ["cartas.csv", "db/cartas.csv", "src/game/data/cartas.csv"];
const VERDE_PATH = "db/verdes.csv";
const JSON_PATH = "src/game/data/cartas.json";
const OUT_PATH = "supabase/migrations/0002_seed_cartas.sql";

// Parser CSV con soporte de comillas (los flavors traen comas, comillas "" y saltos).
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* ignorar */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// Carga un CSV y asigna a todas las cartas el color dado. Ignora filas sin TEXTO.
function loadCSV(path, color) {
  const rows = parseCSV(readFileSync(path, "utf8"));
  const headerIdx = rows.findIndex((r) => r.map((c) => c.trim().toLowerCase()).includes("texto"));
  if (headerIdx < 0) throw new Error(`${path}: no encuentro encabezados (debe incluir 'texto').`);
  const headers = rows[headerIdx].map((h) => h.trim().toLowerCase());
  const iTipo = headers.indexOf("tipo");
  const iTexto = headers.indexOf("texto");
  const iFlavor = headers.indexOf("flavor");

  const cards = [];
  let sinFlavor = 0;
  const seen = new Set();
  for (const r of rows.slice(headerIdx + 1)) {
    const texto = (r[iTexto] || "").trim();
    if (!texto) continue;
    if (seen.has(texto)) continue; // dedupe por texto dentro del mazo
    seen.add(texto);
    const tipo = iTipo >= 0 ? (r[iTipo] || "").trim() : "";
    const flavor = iFlavor >= 0 ? (r[iFlavor] || "").trim() : "";
    if (!flavor) sinFlavor++;
    cards.push({ color, tipo, texto, flavor });
  }
  return { cards, sinFlavor };
}

// --- Cargar mazos ---
const rojaPath = ROJA_CANDIDATES.find((p) => existsSync(p));
let cards = [];
let sinFlavor = 0;

if (rojaPath) {
  const r = loadCSV(rojaPath, "roja");
  cards.push(...r.cards);
  sinFlavor += r.sinFlavor;
} else {
  // Respaldo: JSON empaquetado (sin flavor).
  const data = JSON.parse(readFileSync(JSON_PATH, "utf8"));
  for (const t of data.rojas) cards.push({ color: "roja", tipo: "", texto: t, flavor: "" });
}

if (existsSync(VERDE_PATH)) {
  const v = loadCSV(VERDE_PATH, "verde");
  cards.push(...v.cards);
  sinFlavor += v.sinFlavor;
} else {
  const data = JSON.parse(readFileSync(JSON_PATH, "utf8"));
  for (const t of data.verdes) cards.push({ color: "verde", tipo: "", texto: t, flavor: "" });
}

// --- Emitir SQL ---
const esc = (s) => s.replace(/'/g, "''");
const q = (s) => (s ? `'${esc(s)}'` : "null");
const cat = (s) => (s && s.trim() ? s.trim() : "Otros");
const val = (c) => `  ('${c.color}', '${esc(cat(c.tipo))}', '${esc(c.texto)}', ${q(c.flavor)})`;

const sql = `-- 0002_seed_cartas.sql — GENERADO (roja: ${rojaPath || JSON_PATH}, verde: ${existsSync(VERDE_PATH) ? VERDE_PATH : JSON_PATH})
-- Re-generar con: bun scripts/gen-cartas.mjs
insert into public.cartas (color, tipo, texto, flavor) values
${cards.map(val).join(",\n")}
on conflict (color, texto) do update
  set tipo = excluded.tipo, flavor = excluded.flavor, activa = true;
`;

writeFileSync(OUT_PATH, sql);

const verdes = cards.filter((c) => c.color === "verde").length;
const rojas = cards.length - verdes;
console.log(`Cartas: ${cards.length}  (verdes/prompt: ${verdes}, rojas/respuesta: ${rojas})`);
console.log(`Sin flavor: ${sinFlavor}`);
