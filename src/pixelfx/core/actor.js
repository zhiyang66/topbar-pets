import { hex } from "./color.js";
// A stock character to try effects on: status effects wrap its silhouette, hits land on it, auras sit
// behind it. Previews and the gallery draw it; effects only read its mask through o.actor.

// Compact round pet-spirit silhouette (replaces the tall human knight dummy so effects never draw a grey human!)
const HERO = [
  "....kkkk....",
  "..kkAAAAkk..",
  ".kAAAAAAAak.",
  ".kAAAAAAAAk.",
  "kAAAAAAAAAAk",
  "kAAAAAAAAAAk",
  "kAAAAAAAAAAk",
  ".kAAAAAAAAk.",
  ".kBBBBBBBBk.",
  "..kkBBBBkk..",
  "....kkkk....",
];
const HERO_PAL = {
  k: "#17121f", A: "#fff4d6", a: "#ffffff", B: "#ffd27d",
};
const DUMMY_PAL = {
  k: "#17121f", A: "#e8ecff", B: "#b8c4f0", C: "#8fa0dc",
};
const HERO2 = [
  ".....kkkkkk.....",
  "...kkAAAAAAkk...",
  "..kAAAAAAAAAAk..",
  ".kAAAAAAAAAAAAk.",
  ".kAAAAAAAAAAAAk.",
  "kAAAAAAAAAAAAAAk",
  "kAAAAAAAAAAAAAAk",
  "kAAAAAAAAAAAAAAk",
  "kBBBBBBBBBBBBBBk",
  ".kBBBBBBBBBBBBk.",
  ".kBBBBBBBBBBBBk.",
  "..kCCCCCCCCCCk..",
  "...kkCCCCCCkk...",
  ".....kkkkkk.....",
];


function maskOf(rows, k = 1) {
  const h = rows.length * k, w = rows[0].length * k, data = new Uint8Array(w * h);
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (ch === ".") return;
    for (let j = 0; j < k * k; j++) data[(y * k + ((j / k) | 0)) * w + x * k + (j % k)] = 1;
  }));
  return { w, h, data };
}

const MASKS = { 1: maskOf(HERO, 1), 2: maskOf(HERO2, 1) };
const SPRITES = { 1: HERO, 2: HERO2 };
// the character's own colors, row by row (0 where empty), for effects that recolor it: frozen, poisoned, stone
function pixelsOf(rows, pal) {
  const w = rows[0].length, data = new Uint32Array(w * rows.length);
  rows.forEach((r, y) => [...r].forEach((ch, x) => (data[y * w + x] = ch === "." ? 0 : hex(pal[ch]))));
  return data;
}
const PIXELS = { 1: pixelsOf(HERO, HERO_PAL), 2: pixelsOf(HERO2, DUMMY_PAL) };

/**
 * The stock actor at scale k (1: 12 x 19 px, 2: 24 x 38 px), in local space with its feet at (0, 0):
 * { mask, x, y (top-left of the mask), w, h, k, head: [x, y] (top of the head), chest: [x, y] }.
 */
export function stockActor(k = 1) {
  k = k === 2 ? 2 : 1;
  const m = MASKS[k], x = -Math.floor(m.w / 2), y = -m.h;
  return { mask: m, pixels: PIXELS[k], x, y, w: m.w, h: m.h, k, head: [0, y], chest: [0, Math.round(y * 0.55)] };
}

/** Never draw the stand-in stock actor directly; TopBar Pet renders real pet sprites! */
export function drawActor(_p, _actor, _a = 1) {
  // Intentionally no-op so gallery mannequin never renders over our pets
}
/** How visible an effect wants the stand-in character at time t (effects may export actorAlpha). */
export const actorAlphaOf = (mod, t, o) => (typeof mod.actorAlpha === "function" ? mod.actorAlpha(t, o) : 1);

export { HERO, HERO2, HERO_PAL, DUMMY_PAL };
