// Efectos de sonido sintetizados con Web Audio API (sin archivos).
let ctx = null;
let enabled = localStorage.getItem("mcm_sfx") !== "0";

function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// Los navegadores exigen un gesto del usuario para iniciar el audio.
export function initSfx() {
  const resume = () => {
    getCtx();
    window.removeEventListener("pointerdown", resume);
  };
  window.addEventListener("pointerdown", resume);
}

export function isSfxEnabled() {
  return enabled;
}
export function setSfxEnabled(v) {
  enabled = v;
  localStorage.setItem("mcm_sfx", v ? "1" : "0");
}

function blip(freq, dur, type = "square", vol = 0.12) {
  if (!enabled) return;
  const c = getCtx();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  o.connect(g);
  g.connect(c.destination);
  const t = c.currentTime;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t);
  o.stop(t + dur);
}

export const tick = () => blip(1150, 0.035, "square", 0.07);
export const beep = () => blip(880, 0.1, "sine", 0.11);
export const beepUrge = () => blip(1320, 0.12, "sine", 0.14);
export function ding() {
  blip(1320, 0.16, "triangle", 0.13);
  setTimeout(() => blip(1760, 0.22, "triangle", 0.11), 110);
}

// Tics de la ruleta: empiezan rápido y se van espaciando (la rueda frena).
export function spinTicks(durationMs = 2600) {
  if (!enabled) return;
  const start = performance.now();
  const schedule = () => {
    const elapsed = performance.now() - start;
    if (elapsed >= durationMs || !enabled) return;
    tick();
    const interval = 55 + (elapsed / durationMs) * 240; // 55ms → ~295ms
    setTimeout(schedule, interval);
  };
  schedule();
}
