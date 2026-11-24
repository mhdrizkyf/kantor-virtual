#!/usr/bin/env node
/**
 * Harvest Moon / Cozy Farmhouse Studio — 2x Retina Pixel Art Asset Generator.
 * Generates 100% original CC0 painterly pixel-art assets aligned pixel-for-pixel
 * with lib/office-floor-plan.json (48x28 logical tiles, 16px logical = 32px physical 2x):
 *   - public/art/harvest-v1/farmhouse-bg@2x.png  (1536x896 full 2x Retina floor + props)
 *   - public/art/harvest-v1/meadow-tile@2x.png   (192x192 seamless outdoor meadow + flowers + crops)
 *   - public/art/harvest-v1/lane-tile@2x.png     (192x64 seamless Mineral Town dirt/stone village lane)
 *   - public/art/harvest-v1/desk-north@2x.png    (72x56 rustic oak desk north)
 *   - public/art/harvest-v1/desk-south@2x.png    (72x56 rustic oak desk south)
 *   - public/art/harvest-v1/chair-north@2x.png   (30x26 cozy timber cushion chair north)
 *   - public/art/harvest-v1/chair-south@2x.png   (30x40 cozy timber cushion chair south)
 *   - public/art/harvest-v1/mug@2x.png           (16x18 handmade ceramic tea mug)
 *   - public/art/harvest-v1/herb@2x.png          (18x22 terracotta potted sprout/herb)
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.cwd();
const PLAN = JSON.parse(fs.readFileSync(path.join(ROOT, "lib/office-floor-plan.json"), "utf8"));
const OUT_DIR = path.join(ROOT, "public/art/harvest-v1");
fs.mkdirSync(OUT_DIR, { recursive: true });

const S = 32; // 2x physical tile size (16 logical * 2)
const W = PLAN.cols * S; // 1536
const H = PLAN.rows * S; // 896

/* ---------- Deterministic PRNG & Zero-Dependency PNG Encoder ---------- */
function rng(seed) {
  let s = seed | 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}

/* ---------- Harvest Moon Warm Golden-Sun Palette & Pixel Buffer ---------- */
function hex(h, a = 255) {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16), a];
}
const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
function mix(a, b, t) {
  return [
    clamp(a[0] * (1 - t) + b[0] * t),
    clamp(a[1] * (1 - t) + b[1] * t),
    clamp(a[2] * (1 - t) + b[2] * t),
    a[3] ?? 255,
  ];
}
function alpha(c, a) {
  return [c[0], c[1], c[2], clamp(a)];
}

// Cohesive Harvest Moon: Friends of Mineral Town / Stardew Golden Palette
const PAL = {
  ink: hex("#2c1d18"),
  inkSoft: hex("#462f26", 190),
  shadow: hex("#261914", 62),
  shadowDeep: hex("#221611", 96),

  // Meadows & nature
  grass1: hex("#72b254"),
  grass2: hex("#66a649"),
  grassHi: hex("#8cc866"),
  grassSun: hex("#a5d975"),
  grassSh: hex("#4e873a"),
  grassDeep: hex("#3b6b2d"),

  // Tilled soil & farm lane
  dirt: hex("#cfa776"),
  dirtHi: hex("#e1be8d"),
  dirtSh: hex("#b48959"),
  dirtDeep: hex("#8f673f"),
  soil: hex("#7c4e32"),
  soilHi: hex("#996441"),
  soilDeep: hex("#5b3520"),

  // Stone & cobble
  stone: hex("#b7afa0"),
  stoneHi: hex("#d4ccbd"),
  stoneSh: hex("#948b7c"),
  stoneDeep: hex("#6c6458"),

  // Timber & honey pine floors
  plank1: hex("#d7a368"),
  plank2: hex("#cf995e"),
  plankHi: hex("#e8bc82"),
  plankSh: hex("#b47c45"),
  plankSeam: hex("#8a5a30"),

  // Barn stone/timber floor
  barn1: hex("#bba689"),
  barn2: hex("#b09b7e"),
  barnHi: hex("#cfc0a6"),
  barnSh: hex("#8e7960"),

  // Kitchen terracotta tiles
  terra1: hex("#d88e64"),
  terra2: hex("#e8d3b2"),
  terraHi: hex("#f5e6cc"),
  terraSh: hex("#b56c47"),
  terraGrout: hex("#9a6a4d"),

  // Hot-spring bath tiles
  bath1: hex("#cfe0dc"),
  bath2: hex("#bfd4cf"),
  bathHi: hex("#e5f1ee"),
  bathGrout: hex("#93aea9"),

  // Timber walls & plaster
  wallTop: hex("#9c5f34"),
  wallTopHi: hex("#ba7746"),
  wallTopSh: hex("#6f3f20"),
  plaster: hex("#f2e4c9"),
  plasterHi: hex("#fcf3df"),
  plasterSh: hex("#d6c2a0"),
  beam: hex("#7a4626"),
  beamHi: hex("#9e6037"),
  beamSh: hex("#552d17"),

  // Cozy accents (Harvest Moon signature reds, greens, honey gold, cream)
  red: hex("#c94c42"),
  redHi: hex("#e26b5e"),
  redSh: hex("#932f28"),
  sage: hex("#639468"),
  sageHi: hex("#84b386"),
  sageSh: hex("#426947"),
  gold: hex("#e9b44c"),
  goldHi: hex("#fbd578"),
  goldSh: hex("#b98127"),
  cream: hex("#f8f0dc"),
  creamSh: hex("#dcd0b6"),
  water: hex("#63b4c4"),
  waterHi: hex("#99dce8"),
  waterDeep: hex("#3e8698"),
  copper: hex("#c97642"),
  copperHi: hex("#e69b67"),
  copperSh: hex("#8b4824"),
  leaf1: hex("#4d9142"),
  leafHi: hex("#76bd5a"),
  leafSh: hex("#2f632b"),
  blue: hex("#5886ad"),
  blueHi: hex("#82b0d4"),
  blueSh: hex("#385b7c"),
};

class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.buf = Buffer.alloc(w * h * 4);
  }
  getA(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.buf[(y * this.w + x) * 4 + 3];
  }
  set(x, y, c) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const a = c[3] ?? 255;
    if (a === 255) {
      this.buf[i] = c[0];
      this.buf[i + 1] = c[1];
      this.buf[i + 2] = c[2];
      this.buf[i + 3] = 255;
    } else if (a > 0) {
      const t = a / 255;
      const dstA = this.buf[i + 3] / 255;
      const outA = t + dstA * (1 - t);
      if (outA > 0) {
        this.buf[i] = clamp((c[0] * t + this.buf[i] * dstA * (1 - t)) / outA);
        this.buf[i + 1] = clamp((c[1] * t + this.buf[i + 1] * dstA * (1 - t)) / outA);
        this.buf[i + 2] = clamp((c[2] * t + this.buf[i + 2] * dstA * (1 - t)) / outA);
        this.buf[i + 3] = clamp(outA * 255);
      }
    }
  }
  rect(x, y, w, h, c) {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w));
    const y1 = Math.min(this.h, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.set(xx, yy, c);
  }
  box(x, y, w, h, fill, border = PAL.ink, thick = 2) {
    this.rect(x, y, w, h, border);
    this.rect(x + thick, y + thick, w - thick * 2, h - thick * 2, fill);
  }
  roundRect(x0, y0, w, h, r, c) {
    const x1 = x0 + w - 1;
    const y1 = y0 + h - 1;
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
        const cx = Math.max(x0 + r, Math.min(x1 - r, x));
        const cy = Math.max(y0 + r, Math.min(y1 - r, y));
        if (Math.hypot(x - cx, y - cy) <= r + 0.3) this.set(x, y, c);
      }
    }
  }
  borderedRoundRect(x, y, w, h, r, fill, border = PAL.ink, thick = 2) {
    this.roundRect(x, y, w, h, r, border);
    this.roundRect(x + thick, y + thick, w - thick * 2, h - thick * 2, Math.max(1, r - thick), fill);
  }
  ellipse(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1.0) this.set(x, y, c);
      }
    }
  }
  /** Pixel-art outline for standalone sprites (desks, chairs, mugs, plants). */
  outline(color = PAL.ink) {
    const pts = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.getA(x, y) > 0) continue;
        if (
          this.getA(x - 1, y) > 150 ||
          this.getA(x + 1, y) > 150 ||
          this.getA(x, y - 1) > 150 ||
          this.getA(x, y + 1) > 150
        ) {
          pts.push([x, y]);
        }
      }
    }
    for (const [x, y] of pts) this.set(x, y, color);
  }
}

/* ---------- Nature & Flooring Painting Primitives ---------- */

function paintMeadowRegion(c, x0, y0, w, h, seed = 42, denseFlowers = true) {
  const r = rng(seed);
  // Base warm Harvest Moon grass
  c.rect(x0, y0, w, h, PAL.grass1);
  // Subtle organic dappled grass patches (8x8 pixel clusters)
  for (let y = y0; y < y0 + h; y += 8) {
    for (let x = x0; x < x0 + w; x += 8) {
      const n = r();
      if (n < 0.28) c.rect(x, y, 8, 8, PAL.grass2);
      else if (n > 0.82) c.rect(x, y, 8, 6, PAL.grassHi);
    }
  }
  // Crisp pixel grass blade tufts
  const tuftCount = Math.floor((w * h) / 420);
  for (let i = 0; i < tuftCount; i++) {
    const tx = x0 + Math.floor(r() * Math.max(1, w - 8));
    const ty = y0 + Math.floor(r() * Math.max(1, h - 8));
    const col = r() > 0.45 ? PAL.grassSh : PAL.grassSun;
    c.rect(tx, ty + 2, 2, 4, col);
    c.rect(tx + 4, ty + 1, 2, 5, col);
    c.rect(tx + 2, ty + 4, 2, 2, PAL.grassSh);
  }
  // Wildflowers (daisies, buttercups, lavender)
  if (denseFlowers) {
    const flCount = Math.floor((w * h) / 2600);
    const petals = [PAL.cream, PAL.goldHi, hex("#f29cb0"), hex("#c7b1e8")];
    for (let i = 0; i < flCount; i++) {
      const fx = x0 + 6 + Math.floor(r() * Math.max(1, w - 12));
      const fy = y0 + 6 + Math.floor(r() * Math.max(1, h - 12));
      const p = petals[Math.floor(r() * petals.length)];
      c.rect(fx, fy + 3, 2, 3, PAL.grassDeep);
      c.rect(fx - 2, fy, 6, 2, p);
      c.rect(fx, fy - 2, 2, 6, p);
      c.rect(fx, fy, 2, 2, PAL.gold);
    }
  }
}

function paintVillageLane(c, x0, y0, w, h, seed = 77) {
  const r = rng(seed);
  c.rect(x0, y0, w, h, PAL.dirt);
  // Grassy rustic road border along top & bottom edges
  for (let x = x0; x < x0 + w; x += 6) {
    const dip = r() > 0.5 ? 4 : 2;
    c.rect(x, y0, 6, dip, PAL.grassSh);
    c.rect(x, y0 + dip, 6, 2, PAL.dirtSh);
  }
  // Warm pebbled dirt variation
  for (let y = y0 + 6; y < y0 + h - 4; y += 6) {
    for (let x = x0; x < x0 + w; x += 10) {
      const n = r();
      if (n < 0.25) c.rect(x, y, 8, 4, PAL.dirtHi);
      else if (n > 0.78) c.rect(x, y, 6, 4, PAL.dirtSh);
    }
  }
  // Stepping cobblestones along the Harvest Moon country path
  for (let x = x0 + 10; x < x0 + w - 20; x += 26) {
    const sy = y0 + 14 + Math.floor(r() * Math.max(1, h - 32));
    const sw = 12 + Math.floor(r() * 8);
    const sh = 8 + Math.floor(r() * 4);
    c.roundRect(x, sy + 2, sw, sh, 3, PAL.dirtDeep);
    c.roundRect(x, sy, sw, sh, 3, PAL.stone);
    c.rect(x + 2, sy + 1, sw - 5, 2, PAL.stoneHi);
  }
}

function drawShrub(c, cx, cy, withBerries = false) {
  c.ellipse(cx, cy + 9, 13, 5, PAL.shadow);
  c.ellipse(cx, cy + 1, 13, 10, PAL.ink);
  c.ellipse(cx - 5, cy - 3, 8, 7, PAL.ink);
  c.ellipse(cx + 5, cy - 2, 8, 7, PAL.ink);
  c.ellipse(cx, cy + 1, 11, 8, PAL.leafSh);
  c.ellipse(cx - 4, cy - 2, 7, 6, PAL.leaf1);
  c.ellipse(cx + 4, cy - 1, 7, 6, PAL.leaf1);
  c.ellipse(cx - 2, cy - 5, 6, 4, PAL.leafHi);
  if (withBerries) {
    for (const [bx, by] of [[-5, 0], [3, -3], [6, 2], [-1, 3]]) {
      c.rect(cx + bx, cy + by, 3, 3, PAL.red);
      c.set(cx + bx, cy + by, PAL.redHi);
    }
  } else {
    for (const [bx, by] of [[-4, -2], [4, 1], [0, -5]]) {
      c.rect(cx + bx, cy + by, 3, 3, PAL.goldHi);
    }
  }
}

function drawCropPlot(c, x, y, cols, rows, cropType = "turnip") {
  const w = cols * 24 + 8;
  const h = rows * 20 + 8;
  c.borderedRoundRect(x, y, w, h, 4, PAL.soil, PAL.dirtDeep, 2);
  for (let ry = 0; ry < rows; ry++) {
    const py = y + 6 + ry * 20;
    c.rect(x + 4, py + 12, w - 8, 3, PAL.soilDeep);
    c.rect(x + 4, py, w - 8, 2, PAL.soilHi);
    for (let cx = 0; cx < cols; cx++) {
      const px = x + 16 + cx * 24;
      if (cropType === "turnip") {
        // Classic Harvest Moon white-purple turnip peeking out of soil!
        c.ellipse(px, py + 9, 5, 4, PAL.cream);
        c.rect(px - 3, py + 5, 6, 3, hex("#b987c9"));
        c.rect(px - 5, py + 1, 4, 5, PAL.leaf1);
        c.rect(px + 1, py, 4, 6, PAL.leafHi);
        c.rect(px - 2, py - 2, 4, 4, PAL.leafHi);
      } else if (cropType === "carrot") {
        c.ellipse(px, py + 10, 4, 3, hex("#e87c38"));
        c.rect(px - 5, py + 1, 3, 7, PAL.leaf1);
        c.rect(px - 1, py - 1, 3, 8, PAL.leafHi);
        c.rect(px + 3, py + 2, 3, 6, PAL.leafSh);
      } else {
        // Strawberries!
        c.ellipse(px, py + 6, 7, 5, PAL.leaf1);
        c.ellipse(px - 2, py + 4, 4, 3, PAL.leafHi);
        c.rect(px - 4, py + 7, 3, 4, PAL.red);
        c.rect(px + 2, py + 6, 3, 4, PAL.redHi);
      }
    }
  }
}

function drawWoodenFence(c, x, y, count) {
  for (let i = 0; i < count; i++) {
    const px = x + i * 24;
    if (i < count - 1) {
      c.rect(px + 6, y + 6, 20, 4, PAL.beam);
      c.rect(px + 6, y + 6, 20, 2, PAL.beamHi);
      c.rect(px + 6, y + 14, 20, 4, PAL.beam);
      c.rect(px + 6, y + 14, 20, 2, PAL.beamHi);
    }
    c.box(px, y, 8, 22, PAL.wallTop, PAL.ink, 2);
    c.rect(px + 2, y + 2, 4, 3, PAL.wallTopHi);
  }
}

function drawTree(c, cx, cy, withApples = false) {
  // Ground shadow
  c.ellipse(cx, cy + 20, 24, 10, PAL.shadow);
  // Sturdy oak trunk
  c.borderedRoundRect(cx - 8, cy + 2, 16, 20, 4, PAL.beam, PAL.ink, 2);
  c.rect(cx - 4, cy + 4, 4, 14, PAL.beamHi);
  // Lush layered Harvest Moon leafy crown
  for (const [ox, oy, rx, ry] of [[-14, -4, 14, 13], [14, -4, 14, 13], [0, -14, 17, 14], [0, -2, 18, 13]]) {
    c.ellipse(cx + ox, cy + oy, rx + 2, ry + 2, PAL.ink);
  }
  for (const [ox, oy, rx, ry, col] of [
    [-13, -3, 13, 11, PAL.leafSh],
    [13, -3, 13, 11, PAL.leafSh],
    [0, -1, 17, 12, PAL.leaf1],
    [-8, -10, 12, 10, PAL.leaf1],
    [8, -10, 12, 10, PAL.leaf1],
    [-4, -14, 11, 8, PAL.leafHi],
    [5, -13, 8, 6, PAL.grassSun],
  ]) {
    c.ellipse(cx + ox, cy + oy, rx, ry, col);
  }
  if (withApples) {
    for (const [ax, ay] of [[-12, -2], [2, -8], [12, -1], [-4, 4], [7, 3]]) {
      c.ellipse(cx + ax, cy + ay, 3.5, 3.5, PAL.red);
      c.set(cx + ax - 1, cy + ay - 1, PAL.redHi);
    }
  }
}

/* ---------- Interior Flooring ---------- */

function paintTimberFloor(c, x0, y0, w, h) {
  const r = rng(101);
  const plankH = 16;
  const plankW = 64;
  const seamSoft = alpha(PAL.plankSeam, 125);
  const hiSoft = alpha(PAL.plankHi, 115);
  for (let row = 0; row * plankH < h; row++) {
    const py = y0 + row * plankH;
    const ph = Math.min(plankH, y0 + h - py);
    const offset = (row % 2) * 32;
    for (let x = x0 - offset; x < x0 + w; x += plankW) {
      const px = Math.max(x0, x);
      const pw = Math.min(x0 + w, x + plankW) - px;
      if (pw <= 0) continue;
      const base = r() > 0.48 ? PAL.plank1 : PAL.plank2;
      c.rect(px, py, pw, ph, base);
      // Soft top highlight & subtle warm plank seam
      c.rect(px, py, pw, 1, hiSoft);
      c.rect(px, py + ph - 1, pw, 1, seamSoft);
      if (x >= x0) c.rect(px, py, 1, ph, seamSoft);
      // Subtle grain & tiny nail pegs
      const gy = py + 5 + Math.floor(r() * Math.max(1, ph - 8));
      c.rect(px + 6, gy, Math.max(4, pw - 16), 1, alpha(PAL.plankSh, 72));
      if (pw > 24) {
        c.rect(px + 4, py + 4, 2, 2, alpha(PAL.plankSeam, 95));
        c.rect(px + pw - 6, py + ph - 5, 2, 2, alpha(PAL.plankSeam, 95));
      }
    }
  }
}

function paintTerracottaFloor(c, x0, y0, w, h) {
  const tile = 16;
  for (let y = y0; y < y0 + h; y += tile) {
    for (let x = x0; x < x0 + w; x += tile) {
      const alt = ((Math.floor((x - x0) / tile) + Math.floor((y - y0) / tile)) % 2) === 0;
      const col = alt ? PAL.terra1 : PAL.terra2;
      const hi = alt ? mix(PAL.terra1, PAL.cream, 0.25) : PAL.terraHi;
      const tw = Math.min(tile, x0 + w - x);
      const th = Math.min(tile, y0 + h - y);
      c.rect(x, y, tw, th, col);
      c.rect(x, y, tw, 2, hi);
      c.rect(x, y + th - 2, tw, 2, PAL.terraGrout);
      c.rect(x + tw - 2, y, 2, th, PAL.terraGrout);
    }
  }
}

function paintBathFloor(c, x0, y0, w, h) {
  const tile = 16;
  for (let y = y0; y < y0 + h; y += tile) {
    for (let x = x0; x < x0 + w; x += tile) {
      const alt = ((Math.floor((x - x0) / tile) + Math.floor((y - y0) / tile)) % 2) === 0;
      const tw = Math.min(tile, x0 + w - x);
      const th = Math.min(tile, y0 + h - y);
      c.rect(x, y, tw, th, alt ? PAL.bath1 : PAL.bath2);
      c.rect(x, y, tw, 2, PAL.bathHi);
      c.rect(x, y + th - 1, tw, 1, PAL.bathGrout);
      c.rect(x + tw - 1, y, 1, th, PAL.bathGrout);
    }
  }
}

function paintBarnFloor(c, x0, y0, w, h) {
  const r = rng(303);
  const tile = 24;
  for (let y = y0; y < y0 + h; y += tile) {
    for (let x = x0; x < x0 + w; x += tile) {
      const tw = Math.min(tile, x0 + w - x);
      const th = Math.min(tile, y0 + h - y);
      c.rect(x, y, tw, th, r() > 0.5 ? PAL.barn1 : PAL.barn2);
      c.rect(x + 2, y + 2, Math.max(1, tw - 4), 2, PAL.barnHi);
      c.rect(x, y + th - 2, tw, 2, PAL.barnSh);
      c.rect(x + tw - 2, y, 2, th, PAL.barnSh);
    }
  }
}

/* ---------- Walls, Windows, Porch & Barn Doors ---------- */

function paintTimberWall(c, r) {
  const x = r.x * S;
  const y = r.y * S;
  const w = r.w * S;
  const h = r.h * S;

  // Drop shadow onto floor
  c.rect(x + 4, y + 6, w, h, PAL.shadow);
  // Outer dark timber outline
  c.rect(x, y, w, h, PAL.ink);

  if (w >= h) {
    // Horizontal Harvest Moon timber-and-plaster wall
    c.rect(x + 2, y + 2, w - 4, 10, PAL.wallTop);
    c.rect(x + 2, y + 2, w - 4, 3, PAL.wallTopHi);
    c.rect(x + 2, y + 10, w - 4, 2, PAL.wallTopSh);
    // Warm cream plaster middle fascia
    c.rect(x + 2, y + 12, w - 4, h - 18, PAL.plaster);
    c.rect(x + 2, y + 12, w - 4, 3, PAL.plasterHi);
    // Timber baseboard
    c.rect(x + 2, y + h - 6, w - 4, 4, PAL.beam);
    // Vertical timber posts every 3 tiles
    for (let px = x + 4; px < x + w - 8; px += 96) {
      c.rect(px, y + 12, 6, h - 16, PAL.beam);
      c.rect(px, y + 12, 2, h - 16, PAL.beamHi);
    }
  } else {
    // Vertical timber wall
    c.rect(x + 2, y + 2, w - 4, h - 4, PAL.wallTop);
    c.rect(x + 4, y + 2, 6, h - 4, PAL.wallTopHi);
    c.rect(x + w - 8, y + 2, 6, h - 4, PAL.wallTopSh);
    for (let py = y + 24; py < y + h - 8; py += 64) {
      c.rect(x + 2, py, w - 4, 4, PAL.beamSh);
    }
  }
}

function paintCottageWindow(c, tileX, tileY, tileW = 2) {
  const x = tileX * S;
  const y = tileY * S + 4;
  const w = tileW * S;
  const h = 22;
  c.box(x, y, w, h, PAL.beam, PAL.ink, 2);
  // Warm sky-blue glass panes
  c.rect(x + 4, y + 4, w - 8, h - 8, PAL.waterHi);
  c.rect(x + 4, y + 4, w - 8, 5, hex("#d4f3f8"));
  // Mullions (cottage crossbars)
  c.rect(x + w / 2 - 2, y + 2, 4, h - 4, PAL.cream);
  c.rect(x + 2, y + h / 2 - 1, w - 4, 3, PAL.cream);
  // Flower box right under window sill
  c.box(x + 2, y + h - 2, w - 4, 7, PAL.copper, PAL.ink, 1);
  for (let fx = x + 6; fx < x + w - 8; fx += 10) {
    c.rect(fx, y + h - 5, 6, 4, PAL.leaf1);
    c.rect(fx + 1, y + h - 6, 4, 3, (fx % 20 === 0) ? PAL.redHi : PAL.goldHi);
  }
}

function paintPorchEntrance(c) {
  const x = 22 * S;
  const y = 24 * S;
  // Double farmhouse wooden doors + welcome mat + lanterns!
  c.box(x, y, 2 * S, S, PAL.wallTop, PAL.ink, 2);
  c.rect(x + 4, y + 4, 2 * S - 8, S - 8, PAL.plank1);
  c.rect(x + S - 2, y + 2, 4, S - 4, PAL.beamSh);
  // Brass handles
  c.rect(x + S - 8, y + 14, 4, 4, PAL.goldHi);
  c.rect(x + S + 4, y + 14, 4, 4, PAL.goldHi);
  // Cozy welcome mat inside door
  c.borderedRoundRect(x + 6, y - 22, 2 * S - 12, 18, 4, PAL.red, PAL.redSh, 2);
  c.rect(x + 12, y - 16, 2 * S - 24, 6, PAL.gold);

  // Twin wooden porch lanterns on either side of door
  for (const lx of [x - 16, x + 2 * S + 4]) {
    c.box(lx, y + 16, 12, 14, PAL.goldHi, PAL.ink, 2);
    c.rect(lx + 2, y + 14, 8, 3, PAL.beam);
    c.rect(lx + 4, y + 20, 4, 6, PAL.cream);
  }
  // Classic Harvest Moon Farm Mailbox on front lawn (x=20, y=25)
  const mx = 20 * S + 8;
  const my = 25 * S + 2;
  c.rect(mx + 6, my + 12, 6, 14, PAL.beam);
  c.borderedRoundRect(mx, my, 18, 14, 4, PAL.red, PAL.ink, 2);
  c.rect(mx + 2, my + 2, 14, 3, PAL.redHi);
  c.rect(mx + 14, my + 4, 6, 3, PAL.goldHi); // little raised mail flag!
}

function paintBarnGate(c) {
  const x = 40 * S;
  const y = 24 * S;
  const w = 6 * S;
  c.box(x, y, w, S, PAL.red, PAL.ink, 2);
  // Classic white/cream barn X-brace crossbars!
  c.rect(x + 4, y + 4, w - 8, 4, PAL.cream);
  c.rect(x + 4, y + S - 8, w - 8, 4, PAL.cream);
  c.rect(x + w / 2 - 3, y + 2, 6, S - 4, PAL.cream);
  for (let i = 0; i < 18; i++) {
    c.rect(x + 10 + i * 4, y + 6 + i, 4, 3, PAL.cream);
    c.rect(x + w / 2 + 10 + i * 4, y + 6 + i, 4, 3, PAL.cream);
  }
}

/* ---------- Bespoke Harvest Moon Interior Props ---------- */

function paintProp(c, p) {
  const x = p.x * S;
  const y = p.y * S;
  const w = p.w * S;
  const h = p.h * S;

  switch (p.k) {
    case "kitchen": {
      // Harvest Moon Farmhouse Country Kitchen (Brick Oven + Oak Counter + Sink + Copper Pot)
      c.rect(x + 4, y + 8, w, h - 4, PAL.shadow);
      // Main oak counter
      c.borderedRoundRect(x + 4, y + 14, w - 8, h - 18, 6, PAL.wallTop, PAL.ink, 2);
      c.rect(x + 8, y + 18, w - 16, 18, PAL.cream);
      c.rect(x + 8, y + 36, w - 16, 4, PAL.creamSh);
      // Brick stove hearth on left
      c.borderedRoundRect(x + 10, y + 8, 62, 54, 5, PAL.redSh, PAL.ink, 2);
      c.rect(x + 14, y + 12, 54, 16, PAL.stone);
      c.ellipse(x + 30, y + 20, 9, 6, PAL.ink);
      c.ellipse(x + 52, y + 20, 9, 6, PAL.ink);
      // Simmering copper pot on stove!
      c.borderedRoundRect(x + 20, y + 6, 22, 16, 5, PAL.copper, PAL.ink, 2);
      c.rect(x + 24, y + 8, 14, 4, PAL.copperHi);
      // Warm glowing oven door
      c.box(x + 22, y + 36, 36, 20, PAL.gold, PAL.ink, 2);
      c.rect(x + 28, y + 40, 24, 12, PAL.redHi);
      // Stone farmhouse sink on right
      c.box(x + w - 68, y + 16, 46, 24, PAL.water, PAL.stoneDeep, 3);
      c.rect(x + w - 62, y + 20, 34, 8, PAL.waterHi);
      c.rect(x + w - 48, y + 10, 6, 10, PAL.stoneHi);
      // Cutting board with fresh bread & carrot in center
      c.borderedRoundRect(x + 86, y + 18, 44, 20, 3, PAL.plankHi, PAL.plankSeam, 2);
      c.ellipse(x + 100, y + 28, 10, 6, PAL.gold);
      c.rect(x + 114, y + 25, 10, 5, hex("#e87c38"));
      c.rect(x + 122, y + 26, 4, 3, PAL.leaf1);
      // Hanging copper pans & herb bundle along top shelf
      c.rect(x + 82, y + 4, w - 100, 6, PAL.beam);
      for (const ox of [96, 118, 140]) {
        c.ellipse(x + ox, y + 10, 6, 6, PAL.copper);
        c.set(x + ox - 2, y + 8, PAL.copperHi);
      }
      break;
    }

    case "dining": {
      // Warm farmhouse dining table with red-gingham runner & apple bowl
      c.ellipse(x + w / 2, y + h - 4, w * 0.48, 12, PAL.shadow);
      // Stools north & south
      for (const sx of [x + 24, x + w - 44]) {
        c.borderedRoundRect(sx, y - 10, 20, 18, 5, PAL.plank1, PAL.ink, 2);
        c.borderedRoundRect(sx, y + h - 6, 20, 18, 5, PAL.plank1, PAL.ink, 2);
      }
      c.borderedRoundRect(x + 4, y + 2, w - 8, h - 8, 8, PAL.plank1, PAL.ink, 2);
      c.rect(x + 8, y + 6, w - 16, h - 22, PAL.plankHi);
      c.rect(x + 8, y + h - 16, w - 16, 8, PAL.plankSh);
      // Gingham table runner
      c.rect(x + w / 2 - 22, y + 4, 44, h - 12, PAL.cream);
      for (let gx = x + w / 2 - 20; gx < x + w / 2 + 20; gx += 8) {
        for (let gy = y + 6; gy < y + h - 10; gy += 8) {
          if (((gx + gy) / 8) % 2 === 0) c.rect(gx, gy, 4, 4, alpha(PAL.red, 165));
        }
      }
      // Wooden fruit bowl with apples
      c.ellipse(x + w / 2, y + h / 2 - 4, 14, 9, PAL.beam);
      c.ellipse(x + w / 2 - 4, y + h / 2 - 6, 4, 4, PAL.red);
      c.ellipse(x + w / 2 + 4, y + h / 2 - 5, 4, 4, PAL.redHi);
      c.ellipse(x + w / 2, y + h / 2 - 8, 4, 4, PAL.goldHi);
      break;
    }

    case "bath": {
      // Harvest Moon Hinoki Wooden Hot-Spring Tub!
      c.rect(x + 6, y + 10, w - 8, h - 6, PAL.shadow);
      c.borderedRoundRect(x + 4, y + 4, w - 8, h - 8, 10, PAL.plank1, PAL.ink, 2);
      c.borderedRoundRect(x + 12, y + 12, w - 24, h - 24, 6, PAL.water, PAL.plankSeam, 2);
      // Shimmering hot-spring water ripples
      c.rect(x + 22, y + 20, 36, 4, PAL.waterHi);
      c.rect(x + 48, y + 32, 42, 4, PAL.waterHi);
      c.rect(x + 26, y + 40, 28, 3, hex("#d4f4f9"));
      // Cute hinoki wooden bucket & folded towel on corner
      c.borderedRoundRect(x + w - 26, y + 2, 18, 16, 4, PAL.goldHi, PAL.ink, 2);
      c.borderedRoundRect(x + 8, y + h - 18, 24, 14, 3, PAL.cream, PAL.creamSh, 2);
      break;
    }

    case "bed": {
      // Classic Harvest Moon Farmhouse Wooden Bed with Red-and-Cream Patchwork Quilt!
      c.rect(x + 4, y + 8, w, h - 4, PAL.shadow);
      // Timber headboard & frame
      c.borderedRoundRect(x + 2, y + 2, w - 4, h - 6, 6, PAL.wallTop, PAL.ink, 2);
      c.rect(x + 6, y + 6, w - 12, 16, PAL.beam);
      c.rect(x + 8, y + 8, w - 16, 4, PAL.beamHi);
      // Fluffy cream pillow
      c.borderedRoundRect(x + 10, y + 22, w - 20, 22, 6, PAL.cream, PAL.creamSh, 2);
      c.rect(x + 14, y + 25, w - 28, 6, PAL.plasterHi);
      // Cozy red patchwork quilt
      c.borderedRoundRect(x + 6, y + 46, w - 12, h - 58, 5, PAL.red, PAL.redSh, 2);
      c.rect(x + 6, y + 46, w - 12, 12, PAL.cream); // folded top sheet
      // Quilt squares
      for (let qy = y + 62; qy < y + h - 20; qy += 16) {
        for (let qx = x + 10; qx < x + w - 16; qx += 16) {
          c.rect(qx, qy, 12, 12, ((qx + qy) / 16) % 2 === 0 ? PAL.redHi : PAL.gold);
        }
      }
      break;
    }

    case "lounge": {
      // Cozy Harvest Moon Hearth & Braided Oval Rug Lounge (matches exact walkability blocks!)
      // Braided country rug covering central floor
      c.ellipse(x + w * 0.56, y + h * 0.55, w * 0.40, h * 0.40, PAL.redSh);
      c.ellipse(x + w * 0.56, y + h * 0.55, w * 0.37, h * 0.36, PAL.cream);
      c.ellipse(x + w * 0.56, y + h * 0.55, w * 0.32, h * 0.31, PAL.sage);
      c.ellipse(x + w * 0.56, y + h * 0.55, w * 0.25, h * 0.23, PAL.gold);
      c.ellipse(x + w * 0.56, y + h * 0.55, w * 0.17, h * 0.15, PAL.red);

      // Left-side stone Farmhouse Hearth / Fireplace (tiles x=11, y=19..22)
      const fx = x + 2;
      const fy = y + S + 2;
      c.borderedRoundRect(fx, fy, 34, 4 * S - 6, 5, PAL.stone, PAL.ink, 2);
      for (let by = fy + 6; by < fy + 4 * S - 14; by += 14) {
        c.rect(fx + 4, by, 26, 2, PAL.stoneDeep);
      }
      // Glowing hearth firebox with oak logs
      c.box(fx + 8, fy + 26, 22, 64, PAL.ink, PAL.stoneDeep, 2);
      c.rect(fx + 12, fy + 38, 14, 40, PAL.red);
      c.rect(fx + 14, fy + 46, 10, 24, PAL.goldHi);
      c.rect(fx + 10, fy + 76, 16, 8, PAL.beam);

      // Cozy sage-green farmhouse sofa facing hearth (tiles x=13..14, y=19..22)
      const sx = x + 2 * S + 4;
      const sy = y + S + 4;
      c.rect(sx + 4, sy + 6, 56, 118, PAL.shadow);
      c.borderedRoundRect(sx, sy, 56, 118, 8, PAL.sage, PAL.ink, 2);
      c.rect(sx + 38, sy + 6, 14, 106, PAL.sageSh); // backrest
      for (const cy of [sy + 12, sy + 44, sy + 76]) {
        c.borderedRoundRect(sx + 6, cy, 32, 28, 5, PAL.sageHi, PAL.sageSh, 2);
      }
      // Accent throw pillow
      c.borderedRoundRect(sx + 24, sy + 18, 14, 18, 4, PAL.goldHi, PAL.goldSh, 2);

      // Low rustic oak coffee table with teapot & strawberry plate (tiles x=15..16, y=20..22)
      const tx = x + 4 * S + 6;
      const ty = y + 2 * S + 8;
      c.rect(tx + 4, ty + 6, 52, 76, PAL.shadow);
      c.borderedRoundRect(tx, ty, 52, 76, 6, PAL.plank1, PAL.ink, 2);
      c.rect(tx + 4, ty + 4, 44, 62, PAL.plankHi);
      // Ceramic teapot & cups
      c.ellipse(tx + 26, ty + 26, 10, 9, PAL.cream);
      c.rect(tx + 22, ty + 18, 8, 4, PAL.blue);
      c.ellipse(tx + 26, ty + 52, 11, 8, PAL.cream);
      c.rect(tx + 22, ty + 49, 4, 4, PAL.red);
      c.rect(tx + 27, ty + 51, 4, 4, PAL.redHi);

      // Two cozy cream armchairs (tiles x=18..19, y=19..20 and y=22..23)
      for (const ay of [y + S + 4, y + 4 * S + 2]) {
        const ax = x + 7 * S + 2;
        c.rect(ax + 4, ay + 6, 52, 52, PAL.shadow);
        c.borderedRoundRect(ax, ay, 52, 52, 9, PAL.cream, PAL.ink, 2);
        c.borderedRoundRect(ax + 8, ay + 8, 36, 36, 6, PAL.plasterHi, PAL.creamSh, 2);
        c.borderedRoundRect(ax + 12, ay + 10, 28, 12, 4, PAL.red, PAL.redSh, 1);
      }
      break;
    }

    case "meeting": {
      // Communal Harvest Standup Table with Sunflower Centerpiece & Map Scroll!
      c.ellipse(x + w / 2, y + h - 4, w * 0.48, 12, PAL.shadow);
      // Wooden stools around table
      for (const sx of [x + 18, x + w / 2 - 10, x + w - 38]) {
        c.borderedRoundRect(sx, y - 14, 20, 18, 6, PAL.wallTop, PAL.ink, 2);
        c.rect(sx + 4, y - 10, 12, 8, PAL.gold);
        c.borderedRoundRect(sx, y + h - 4, 20, 18, 6, PAL.wallTop, PAL.ink, 2);
        c.rect(sx + 4, y + h, 12, 8, PAL.gold);
      }
      c.borderedRoundRect(x + 2, y, w - 4, h - 4, 10, PAL.plank1, PAL.ink, 2);
      c.rect(x + 6, y + 4, w - 12, h - 18, PAL.plankHi);
      c.rect(x + 6, y + h - 14, w - 12, 8, PAL.plankSh);
      // Unrolled parchment plan scroll
      c.borderedRoundRect(x + 16, y + 12, 38, 28, 3, PAL.cream, PAL.plankSeam, 2);
      c.rect(x + 22, y + 18, 24, 3, PAL.blue);
      c.rect(x + 22, y + 25, 18, 3, PAL.sage);
      c.rect(x + 22, y + 32, 22, 3, PAL.red);
      // Bright Harvest Moon Sunflower in a terracotta vase!
      const fx = x + w - 34;
      const fy = y + 24;
      c.ellipse(fx, fy + 6, 9, 7, PAL.copper);
      c.ellipse(fx, fy - 4, 11, 11, PAL.goldHi);
      c.ellipse(fx, fy - 4, 6, 6, PAL.beam);
      break;
    }

    case "board": {
      // Classic Harvest Moon Wooden Town Notice Board! (Clickable → /papan)
      c.rect(x + 10, y + h - 16, w - 20, 12, PAL.shadow);
      // Timber posts
      c.box(x + 14, y + 16, 12, h - 22, PAL.beam, PAL.ink, 2);
      c.box(x + w - 26, y + 16, 12, h - 22, PAL.beam, PAL.ink, 2);
      // Cork / timber bulletin frame
      c.borderedRoundRect(x + 8, y + 18, w - 16, h - 38, 6, PAL.plank1, PAL.ink, 2);
      c.rect(x + 14, y + 24, w - 28, h - 50, PAL.dirt);
      // Pitched little wooden shingle roof eave on top!
      c.borderedRoundRect(x + 2, y + 4, w - 4, 20, 5, PAL.red, PAL.ink, 2);
      c.rect(x + 6, y + 8, w - 12, 5, PAL.redHi);
      c.rect(x + 6, y + 16, w - 12, 4, PAL.redSh);
      // Pinned Harvest Moon parchment task cards (two rows when tall) with colorful wax pins!
      const notes = [
        [x + 20, y + 29, 28, 24, PAL.cream, PAL.red],
        [x + 56, y + 27, 30, 26, hex("#fff5d2"), PAL.sage],
        [x + w - 52, y + 30, 28, 22, PAL.cream, PAL.blue],
        [x + 26, y + 60, 32, 22, hex("#fdf2dc"), PAL.gold],
        [x + 68, y + 58, 28, 24, PAL.cream, PAL.red],
        [x + w - 54, y + 60, 28, 22, hex("#f3f8ec"), PAL.sage],
      ];
      for (const [nx, ny, nw, nh, ncol, pin] of notes) {
        if (nx + nw > x + w - 14 || ny + nh > y + h - 22) continue;
        c.box(nx, ny, nw, nh, ncol, PAL.plankSeam, 1);
        c.rect(nx + nw / 2 - 2, ny - 2, 5, 5, pin);
        c.rect(nx + 4, ny + 7, nw - 8, 2, PAL.stoneDeep);
        c.rect(nx + 4, ny + 12, nw - 12, 2, PAL.stone);
        c.rect(nx + 4, ny + 17, nw - 10, 2, PAL.stone);
      }
      break;
    }

    case "server": {
      // Pastoral Timber & Brass Farm Power / AI Engine Cabinet (Clickable → Controls)
      c.rect(x + 6, y + 12, w - 8, h - 10, PAL.shadow);
      c.borderedRoundRect(x + 4, y + 6, w - 8, h - 12, 6, PAL.beam, PAL.ink, 2);
      c.rect(x + 8, y + 10, w - 16, 8, PAL.beamHi);
      // Brass control bays with warm glowing emerald & amber indicators
      for (let i = 0; i < 3; i++) {
        const by = y + 22 + i * 28;
        c.borderedRoundRect(x + 10, by, w - 20, 22, 3, hex("#3d4944"), PAL.ink, 2);
        c.rect(x + 14, by + 6, 8, 8, PAL.grassSun);
        c.rect(x + 26, by + 6, 8, 8, i === 1 ? PAL.goldHi : PAL.waterHi);
        c.rect(x + 38, by + 8, 12, 4, PAL.copperHi);
      }
      // Copper coil gauge on top
      c.ellipse(x + w / 2, y + 8, 10, 6, PAL.copper);
      c.ellipse(x + w / 2, y + 7, 5, 3, PAL.goldHi);
      break;
    }

    case "coffee": {
      // Farmhouse Tea & Coffee Counter (Clickable → Coffee Break!)
      c.rect(x + 4, y + 8, w - 4, h - 4, PAL.shadow);
      c.borderedRoundRect(x + 2, y + 6, w - 4, h - 10, 6, PAL.wallTop, PAL.ink, 2);
      c.rect(x + 6, y + 10, w - 12, 20, PAL.cream);
      // Copper kettle + ceramic mugs + honey biscuit jar
      c.borderedRoundRect(x + 12, y + 2, 22, 20, 5, PAL.copper, PAL.ink, 2);
      c.rect(x + 16, y + 6, 10, 6, PAL.copperHi);
      c.borderedRoundRect(x + 42, y + 10, 14, 14, 3, PAL.cream, PAL.ink, 2);
      c.rect(x + 45, y + 13, 8, 4, PAL.beam);
      c.borderedRoundRect(x + 64, y + 6, 18, 18, 5, PAL.goldHi, PAL.ink, 2);
      c.rect(x + 68, y + 4, 10, 4, PAL.red);
      break;
    }

    case "shelf": {
      // Barn Seed, Blueprint & Supply Shelves
      c.rect(x + 6, y + 10, w - 8, h - 6, PAL.shadow);
      c.borderedRoundRect(x + 4, y + 6, w - 8, h - 12, 5, PAL.wallTop, PAL.ink, 2);
      for (const sy of [y + 24, y + 52]) {
        c.rect(x + 8, sy, w - 16, 6, PAL.beamSh);
      }
      // Colorful seed packets, watering can, jam jars & rolled scrolls
      const items = [
        [x + 14, y + 10, 14, 14, PAL.sage],
        [x + 34, y + 10, 14, 14, PAL.red],
        [x + 54, y + 10, 14, 14, PAL.gold],
        [x + 82, y + 8, 22, 16, PAL.blue], // watering can
        [x + 114, y + 10, 26, 14, PAL.cream],
        [x + 16, y + 34, 18, 16, PAL.copper],
        [x + 44, y + 36, 20, 14, PAL.goldHi],
        [x + 76, y + 34, 24, 16, PAL.sageHi],
        [x + 112, y + 36, 26, 14, PAL.redHi],
      ];
      for (const [ix, iy, iw, ih, icol] of items) {
        if (ix + iw < x + w - 8) c.borderedRoundRect(ix, iy, iw, ih, 3, icol, PAL.ink, 1);
      }
      break;
    }

    case "storage": {
      // Stacked Wooden Harvest Crates, Apple Boxes & Golden Hay Bales
      for (let i = 0; i < 4; i++) {
        const cy = y + 8 + i * 66;
        if (cy + 54 > y + h) break;
        c.rect(x + 8, cy + 6, w - 12, 52, PAL.shadow);
        if (i % 2 === 0) {
          // Wooden apple/turnip crate
          c.borderedRoundRect(x + 4, cy, w - 10, 52, 4, PAL.plank1, PAL.ink, 2);
          c.rect(x + 8, cy + 16, w - 18, 4, PAL.plankSeam);
          c.rect(x + 8, cy + 34, w - 18, 4, PAL.plankSeam);
          // Apples peeking out of top
          for (const [ax, ay] of [[14, 8], [26, 10], [36, 8]]) {
            c.ellipse(x + ax, cy + ay, 5, 4, i === 0 ? PAL.red : PAL.goldHi);
          }
        } else {
          // Golden tied hay bale
          c.borderedRoundRect(x + 4, cy, w - 10, 50, 6, PAL.gold, PAL.ink, 2);
          c.rect(x + 8, cy + 4, w - 18, 10, PAL.goldHi);
          c.rect(x + 16, cy + 2, 4, 46, PAL.redSh);
          c.rect(x + w - 26, cy + 2, 4, 46, PAL.redSh);
        }
      }
      break;
    }

    case "bike": {
      // Vintage Country Farm Bicycle with Wicker Flower Basket!
      c.ellipse(x + w / 2, y + h - 8, w * 0.42, 8, PAL.shadow);
      // Wheels
      c.ellipse(x + 24, y + 36, 15, 15, PAL.ink);
      c.ellipse(x + 24, y + 36, 10, 10, PAL.barn1);
      c.ellipse(x + w - 24, y + 36, 15, 15, PAL.ink);
      c.ellipse(x + w - 24, y + 36, 10, 10, PAL.barn1);
      // Vintage mint/sage frame
      c.rect(x + 24, y + 26, w - 48, 5, PAL.sage);
      c.rect(x + 36, y + 18, 6, 18, PAL.sageSh);
      c.rect(x + w - 34, y + 14, 6, 22, PAL.sage);
      // Leather seat & wicker flower basket
      c.borderedRoundRect(x + 30, y + 14, 18, 8, 3, PAL.beam, PAL.ink, 1);
      c.borderedRoundRect(x + w - 28, y + 10, 18, 16, 3, PAL.plank1, PAL.ink, 1);
      c.ellipse(x + w - 19, y + 10, 8, 5, PAL.leaf1);
      c.rect(x + w - 23, y + 7, 4, 4, PAL.goldHi);
      c.rect(x + w - 17, y + 6, 4, 4, PAL.redHi);
      break;
    }

    case "car": {
      // Iconic Harvest Moon Vintage Red Farm Delivery Truck / Timber Wagon!
      c.roundRect(x + 10, y + 14, w - 16, h - 18, 14, PAL.shadow);
      // Rubber tires
      for (const [tx, ty] of [[x + 4, y + 32], [x + w - 16, y + 32], [x + 4, y + h - 54], [x + w - 16, y + h - 54]]) {
        c.borderedRoundRect(tx, ty, 12, 30, 4, PAL.ink, PAL.ink, 1);
      }
      // Wooden slatted harvest flatbed (top/rear half)
      c.borderedRoundRect(x + 12, y + 10, w - 24, h * 0.52, 8, PAL.wallTop, PAL.ink, 2);
      c.rect(x + 18, y + 16, w - 36, h * 0.52 - 12, PAL.plank1);
      for (let sy = y + 32; sy < y + h * 0.52; sy += 18) {
        c.rect(x + 18, sy, w - 36, 2, alpha(PAL.plankSeam, 130));
      }
      // Harvest crates loaded inside the truck bed!
      c.borderedRoundRect(x + 24, y + 24, 34, 34, 4, PAL.gold, PAL.beam, 2);
      c.borderedRoundRect(x + 64, y + 26, 34, 32, 4, PAL.plankHi, PAL.beam, 2);
      c.ellipse(x + 41, y + 38, 8, 6, PAL.red);
      c.ellipse(x + 81, y + 38, 8, 6, PAL.leaf1);
      // Vintage cherry-red truck cab (bottom/front half) + side mirrors
      const cy = y + Math.floor(h * 0.56);
      const ch = Math.floor(h * 0.38);
      c.rect(x + 4, cy + 16, 8, 6, PAL.stoneHi);
      c.rect(x + w - 12, cy + 16, 8, 6, PAL.stoneHi);
      c.borderedRoundRect(x + 10, cy, w - 20, ch, 12, PAL.red, PAL.ink, 2);
      c.rect(x + 18, cy + 8, w - 36, 18, PAL.redHi);
      // Windshield
      c.borderedRoundRect(x + 20, cy + ch - 34, w - 40, 18, 5, PAL.waterHi, PAL.ink, 2);
      // Chrome headlights
      c.borderedRoundRect(x + 16, cy + ch - 8, 16, 8, 3, PAL.goldHi, PAL.ink, 1);
      c.borderedRoundRect(x + w - 32, cy + ch - 8, 16, 8, 3, PAL.goldHi, PAL.ink, 1);
      break;
    }

    case "plant": {
      // Terracotta potted indoor farmhouse plant / mini sunflower!
      const cx = x + S / 2;
      const cy = y + S / 2;
      c.ellipse(cx, cy + 12, 11, 5, PAL.shadow);
      c.borderedRoundRect(cx - 9, cy + 1, 18, 13, 3, PAL.copper, PAL.ink, 2);
      c.rect(cx - 11, cy - 1, 22, 5, PAL.copperHi);
      c.ellipse(cx, cy - 8, 12, 10, PAL.ink);
      c.ellipse(cx, cy - 8, 10, 8, PAL.leaf1);
      c.ellipse(cx - 3, cy - 11, 6, 5, PAL.leafHi);
      // Tiny bloom
      c.ellipse(cx + 4, cy - 12, 4, 4, PAL.goldHi);
      c.rect(cx + 3, cy - 13, 2, 2, PAL.beam);
      break;
    }
  }
}

/* ---------- 1. Generate Main 1536x896 2x Retina Harvest Moon Farmhouse Floor ---------- */
function generateFarmhouseBg() {
  const c = new Canvas(W, H);

  // Full exterior Harvest Moon sunlit meadow
  paintMeadowRegion(c, 0, 0, W, H, 19, true);

  // North meadow decor: fruit trees, garden plots, wooden fence along y=0..1!
  drawWoodenFence(c, 1 * S, 10, 6);
  drawCropPlot(c, 8 * S, 6, 4, 2, "turnip");
  drawCropPlot(c, 13 * S, 6, 4, 2, "carrot");
  drawTree(c, 22 * S, 24, true);
  drawCropPlot(c, 26 * S, 6, 4, 2, "strawberry");
  drawWoodenFence(c, 32 * S, 10, 5);
  drawTree(c, 42 * S, 24, true);

  // Shimmering little garden duck-pond on top-right meadow (x=37..40, y=0..1)
  c.ellipse(38.5 * S, 34, 42, 20, PAL.dirtSh);
  c.ellipse(38.5 * S, 34, 38, 17, PAL.water);
  c.ellipse(38 * S, 31, 26, 9, PAL.waterHi);

  // South Mineral Town village lane & front porch walkway
  paintVillageLane(c, 0, 26 * S, W, 2 * S, 91);
  // Cobblestone front garden path (x=22..23, y=24..27)
  for (let py = 24 * S; py < 28 * S; py += 16) {
    for (let px = 22 * S + 4; px < 24 * S - 4; px += 20) {
      c.borderedRoundRect(px, py + 2, 16, 12, 4, PAL.stone, PAL.dirtDeep, 1);
      c.rect(px + 3, py + 4, 10, 3, PAL.stoneHi);
    }
  }
  // Barn gravel driveway (x=39..45, y=24..27)
  paintVillageLane(c, 39 * S, 24 * S, 7 * S, 4 * S, 144);

  // Interior room floors (exact match to floor plan!)
  paintTimberFloor(c, 2 * S, 3 * S, 44 * S, 21 * S); // Main hall + owner's study
  paintTerracottaFloor(c, 2 * S, 3 * S, 8 * S, 8 * S); // Country kitchen
  paintBathFloor(c, 2 * S, 12 * S, 8 * S, 4 * S); // Hot-spring bath
  paintBarnFloor(c, 39 * S, 3 * S, 7 * S, 21 * S); // East Greenhouse Barn

  // Cozy crimson-and-gold woven heirloom rug in Owner's Private Study (x=4..9, y=18..22)
  const rx = 4 * S + 8, ry = 18 * S + 8, rw = 5 * S - 12, rh = 3 * S - 8;
  c.borderedRoundRect(rx, ry, rw, rh, 8, PAL.red, PAL.redSh, 3);
  c.borderedRoundRect(rx + 8, ry + 8, rw - 16, rh - 16, 5, PAL.gold, PAL.cream, 2);
  c.borderedRoundRect(rx + 22, ry + 18, rw - 44, rh - 36, 4, PAL.red, PAL.goldSh, 2);
  c.borderedRoundRect(rx + 36, ry + 28, rw - 72, rh - 56, 3, PAL.cream, PAL.goldSh, 1);
  // Subtle woven fringe tassels on left & right ends
  for (let fy = ry + 6; fy < ry + rh - 6; fy += 8) {
    c.rect(rx - 5, fy, 5, 3, PAL.cream);
    c.rect(rx + rw, fy, 5, 3, PAL.cream);
  }

  // Soft diagonal sunlit window shafts across warm honey floorboards
  for (const wx of [12, 19, 31]) {
    for (let step = 0; step < 52; step++) {
      c.rect(wx * S + 6 + Math.floor(step * 0.35), 3 * S + step, 2 * S - 12, 1, [255, 248, 214, Math.max(0, 34 - Math.floor(step * 0.6))]);
    }
  }

  // Soft interior wall ambient shadow along inner north wall
  c.rect(2 * S, 3 * S, 44 * S, 10, PAL.shadow);

  // Timber & plaster farmhouse walls
  for (const wall of PLAN.walls) paintTimberWall(c, wall);

  // Cottage windows with flower boxes (north & south facades!)
  for (const wx of [3, 12, 19, 31, 40, 44]) paintCottageWindow(c, wx, 2, 2);
  for (const wx of [4, 12, 17, 28, 34]) paintCottageWindow(c, wx, 24, 2);

  // All interior props crafted in Harvest Moon style
  for (const prop of PLAN.props) paintProp(c, prop);

  // Porch front door, mailbox, lanterns & red barn double gate
  paintPorchEntrance(c);
  paintBarnGate(c);

  // South front yard shrubs, flowerbeds & wooden garden fencing
  drawWoodenFence(c, 2 * S, 25 * S + 4, 3);
  for (const sx of [7, 10, 14, 18, 26, 30, 34, 37]) {
    drawShrub(c, sx * S + 16, 25 * S + 14, sx % 2 === 0);
  }
  drawCropPlot(c, 27 * S + 4, 25 * S + 2, 2, 1, "turnip");

  fs.writeFileSync(path.join(OUT_DIR, "farmhouse-bg@2x.png"), encodePng(c.w, c.h, c.buf));
}

/* ---------- 2. Seamless Outdoor Surroundings Tiles ---------- */
function generateSurroundingsTiles() {
  // 192x192 seamless meadow tile with wildflowers & occasional tiny clover/crop accents
  const m = new Canvas(192, 192);
  paintMeadowRegion(m, 0, 0, 192, 192, 512, true);
  drawShrub(m, 38, 44, true);
  drawShrub(m, 148, 136, false);
  fs.writeFileSync(path.join(OUT_DIR, "meadow-tile@2x.png"), encodePng(m.w, m.h, m.buf));

  // 192x64 seamless village dirt & cobblestone lane
  const l = new Canvas(192, 64);
  paintVillageLane(l, 0, 0, 192, 64, 712);
  fs.writeFileSync(path.join(OUT_DIR, "lane-tile@2x.png"), encodePng(l.w, l.h, l.buf));
}

/* ---------- 3. Harvest Moon 2x Retina Workstations (Rustic Oak Desks, Chairs, Mug, Herb) ---------- */
function generateWorkstationAssets() {
  // Rustic Oak Desk (72x56 = 36x28 logical @ 2x)
  for (const dir of ["north", "south"]) {
    const d = new Canvas(72, 56);
    // Warm floor drop shadow
    d.roundRect(4, 44, 64, 10, 4, PAL.shadow);
    // Sturdy timber desk legs
    d.borderedRoundRect(6, 26, 12, 26, 3, PAL.beam, PAL.ink, 2);
    d.rect(9, 28, 3, 20, PAL.beamHi);
    d.borderedRoundRect(54, 26, 12, 26, 3, PAL.beam, PAL.ink, 2);
    d.rect(57, 28, 3, 20, PAL.beamHi);
    // Back cross-rail
    d.rect(18, 32, 36, 8, PAL.beamSh);
    // Lush honey-oak tabletop with warm highlight & wood grain
    d.borderedRoundRect(2, 2, 68, 30, 6, PAL.plank1, PAL.ink, 2);
    d.rect(6, 5, 60, 5, PAL.plankHi);
    d.rect(6, 24, 60, 5, PAL.plankSh);
    d.rect(12, 14, 24, 2, alpha(PAL.plankSeam, 120));
    d.rect(40, 18, 20, 2, alpha(PAL.plankSeam, 120));
    if (dir === "south") {
      // Cozy desk drawer handle visible on south-facing front apron
      d.rect(28, 34, 16, 4, PAL.goldHi);
    }
    fs.writeFileSync(path.join(OUT_DIR, `desk-${dir}@2x.png`), encodePng(d.w, d.h, d.buf));
  }

  // Cozy Timber + Sage Cushion Chair North (30x26) & South (30x40)
  const cn = new Canvas(30, 26);
  cn.borderedRoundRect(4, 2, 22, 18, 5, PAL.wallTop, PAL.ink, 2);
  cn.borderedRoundRect(7, 6, 16, 12, 4, PAL.sage, PAL.sageSh, 2);
  cn.rect(10, 8, 10, 3, PAL.sageHi);
  cn.rect(6, 20, 5, 5, PAL.ink);
  cn.rect(19, 20, 5, 5, PAL.ink);
  fs.writeFileSync(path.join(OUT_DIR, "chair-north@2x.png"), encodePng(cn.w, cn.h, cn.buf));

  const cs = new Canvas(30, 40);
  cs.ellipse(15, 35, 11, 4, PAL.shadow);
  cs.borderedRoundRect(4, 14, 22, 18, 5, PAL.wallTop, PAL.ink, 2);
  cs.borderedRoundRect(7, 17, 16, 12, 4, PAL.sage, PAL.sageSh, 2);
  cs.rect(10, 19, 10, 3, PAL.sageHi);
  cs.rect(6, 31, 5, 6, PAL.beam);
  cs.rect(19, 31, 5, 6, PAL.beam);
  // Slatted wooden chair back visible on south seat
  cs.borderedRoundRect(5, 22, 20, 12, 4, PAL.wallTop, PAL.ink, 2);
  cs.rect(8, 25, 14, 3, PAL.wallTopHi);
  fs.writeFileSync(path.join(OUT_DIR, "chair-south@2x.png"), encodePng(cs.w, cs.h, cs.buf));

  // Ceramic Farmhouse Tea Mug (16x18)
  const mug = new Canvas(16, 18);
  mug.borderedRoundRect(3, 5, 9, 11, 3, PAL.cream, PAL.ink, 1);
  mug.rect(5, 7, 5, 2, PAL.beam);
  mug.rect(11, 8, 3, 5, PAL.ink);
  mug.rect(11, 9, 2, 3, PAL.cream);
  mug.rect(5, 10, 5, 2, PAL.red); // cute red stripe
  fs.writeFileSync(path.join(OUT_DIR, "mug@2x.png"), encodePng(mug.w, mug.h, mug.buf));

  // Terracotta Potted Sprout Herb (18x22)
  const herb = new Canvas(18, 22);
  herb.borderedRoundRect(4, 11, 10, 9, 2, PAL.copper, PAL.ink, 1);
  herb.rect(3, 10, 12, 3, PAL.copperHi);
  herb.ellipse(9, 7, 6, 5, PAL.leaf1);
  herb.ellipse(7, 5, 3, 3, PAL.leafHi);
  herb.rect(10, 4, 3, 3, PAL.goldHi);
  herb.outline(PAL.ink);
  fs.writeFileSync(path.join(OUT_DIR, "herb@2x.png"), encodePng(herb.w, herb.h, herb.buf));
}

generateFarmhouseBg();
generateSurroundingsTiles();
generateWorkstationAssets();
console.log("Generated Harvest Moon 2x Retina asset pack in public/art/harvest-v1/.");
