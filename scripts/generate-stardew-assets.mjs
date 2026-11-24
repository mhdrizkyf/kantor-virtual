#!/usr/bin/env node
/**
 * Stardew Valley / Pelican Town Farmhouse Studio — 2x Retina Sprite Compositor.
 *
 * Composes genuine open-source 32x32 hand-pixeled Liberated Pixel Cup (LPC)
 * tilesets (Sharm / HughSpectrum / vendors_table in scripts/vendor-lpc/) with
 * a unified ConcernedApe / Stardew Valley Spring warm color-grading pass,
 * aligned pixel-for-pixel with lib/office-floor-plan.json (48x28 tiles, 32px/tile):
 *   - public/art/stardew-v1/farmhouse-bg@2x.png  (1536x896)
 *   - public/art/stardew-v1/meadow-tile@2x.png   (192x192)
 *   - public/art/stardew-v1/lane-tile@2x.png     (192x64)
 *   - public/art/stardew-v1/desk-north@2x.png    (72x56)
 *   - public/art/stardew-v1/desk-south@2x.png    (72x56)
 *   - public/art/stardew-v1/chair-north@2x.png   (30x26)
 *   - public/art/stardew-v1/chair-south@2x.png   (30x40)
 *   - public/art/stardew-v1/mug@2x.png           (16x18)
 *   - public/art/stardew-v1/herb@2x.png          (18x22)
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.cwd();
const LPC_DIR = path.join(ROOT, "scripts/vendor-lpc");
const PLAN = JSON.parse(fs.readFileSync(path.join(ROOT, "lib/office-floor-plan.json"), "utf8"));
const OUT_DIR = path.join(ROOT, "public/art/stardew-v1");
fs.mkdirSync(OUT_DIR, { recursive: true });

const S = 32; // 2x Retina physical tile size (1:1 match with LPC 32x32 sprites!)
const W = PLAN.cols * S; // 1536
const H = PLAN.rows * S; // 896

/* ---------- Deterministic PRNG ---------- */
function rng(seed) {
  let s = seed | 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
function hex(h, a = 255) {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16), a];
}

/* ---------- Zero-Dependency PNG Decoder & Encoder ---------- */
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
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
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

function decodePng(filePath) {
  const buf = fs.readFileSync(filePath);
  let pos = 8, w = 0, h = 0, colorType = 6, plte = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "PLTE") plte = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const stride = w * bpp;
  const recon = Buffer.alloc(stride * h);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const rowIn = y * (stride + 1) + 1;
    const rowOut = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[rowIn + x];
      const a = x >= bpp ? recon[rowOut + x - bpp] : 0;
      const b = y > 0 ? recon[rowOut - stride + x] : 0;
      const c = x >= bpp && y > 0 ? recon[rowOut - stride + x - bpp] : 0;
      recon[rowOut + x] =
        ft === 1 ? (v + a) & 255 :
        ft === 2 ? (v + b) & 255 :
        ft === 3 ? (v + ((a + b) >> 1)) & 255 :
        ft === 4 ? (v + paeth(a, b, c)) & 255 :
        v;
    }
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (colorType === 6) {
      rgba[i * 4] = recon[i * 4];
      rgba[i * 4 + 1] = recon[i * 4 + 1];
      rgba[i * 4 + 2] = recon[i * 4 + 2];
      rgba[i * 4 + 3] = recon[i * 4 + 3];
    } else if (colorType === 2) {
      rgba[i * 4] = recon[i * 3];
      rgba[i * 4 + 1] = recon[i * 3 + 1];
      rgba[i * 4 + 2] = recon[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    } else if (colorType === 3) {
      const idx = recon[i];
      rgba[i * 4] = plte[idx * 3];
      rgba[i * 4 + 1] = plte[idx * 3 + 1];
      rgba[i * 4 + 2] = plte[idx * 3 + 2];
      rgba[i * 4 + 3] = trns && idx < trns.length ? trns[idx] : 255;
    }
  }
  return { w, h, rgba };
}

/* ---------- Load Real Open-Source LPC 32x32 Sprite Sheets ---------- */
const SHEETS = {
  grass: decodePng(path.join(LPC_DIR, "grass.png")),
  grassalt: decodePng(path.join(LPC_DIR, "grassalt.png")),
  dirt: decodePng(path.join(LPC_DIR, "dirt.png")),
  dirt2: decodePng(path.join(LPC_DIR, "dirt2.png")),
  watergrass: decodePng(path.join(LPC_DIR, "watergrass.png")),
  treetop: decodePng(path.join(LPC_DIR, "treetop.png")),
  trunk: decodePng(path.join(LPC_DIR, "trunk.png")),
  house: decodePng(path.join(LPC_DIR, "house.png")),
  inside: decodePng(path.join(LPC_DIR, "inside.png")),
  kitchen: decodePng(path.join(LPC_DIR, "kitchen.png")),
  country: decodePng(path.join(LPC_DIR, "country.png")),
  cabinets: decodePng(path.join(LPC_DIR, "cabinets.png")),
  barrel: decodePng(path.join(LPC_DIR, "barrel.png")),
  chests: decodePng(path.join(LPC_DIR, "chests.png")),
  buckets: decodePng(path.join(LPC_DIR, "buckets.png")),
  signs: decodePng(path.join(LPC_DIR, "signs.png")),
  rock: decodePng(path.join(LPC_DIR, "rock.png")),
  bridges: decodePng(path.join(LPC_DIR, "bridges.png")),
  table: decodePng(path.join(LPC_DIR, "table.png")),
  castlefloors: decodePng(path.join(LPC_DIR, "castlefloors.png")),
  lights: decodePng(path.join(LPC_DIR, "lights.png")),
  cup: decodePng(path.join(LPC_DIR, "cup.png")),
};

/* ---------- Stardew Valley ConcernedApe Color-Grading Filters ---------- */
// Harmonizes LPC sprite sheets into Stardew Valley's warm sunlit Pelican Town palette.
const GRADE = {
  identity: (r, g, b, a) => [r, g, b, a],

  // Vibrant Stardew Spring meadow grass (golden-chartreuse sunlit highlights, lush emerald midtones)
  stardewGrass: (r, g, b, a) => [
    clamp(r * 1.16 + 16),
    clamp(g * 1.14 + 14),
    clamp(b * 0.92 + 4),
    a,
  ],

  // Sunlit Stardew oak & pine foliage
  stardewFoliage: (r, g, b, a) => [
    clamp(r * 1.08 + 8),
    clamp(g * 1.06 + 8),
    clamp(b * 0.9 + 2),
    a,
  ],

  // Warm Pelican Town golden-ochre dirt & gravel lane
  stardewDirt: (r, g, b, a) => [
    clamp(r * 1.24 + 28),
    clamp(g * 1.18 + 20),
    clamp(b * 1.02 + 12),
    a,
  ],

  // Iconic Stardew Farmhouse honey-oak plank floor (from inside.png's hand-pixeled wood plank tile!)
  stardewHoneyFloor: (r, g, b, a) => [
    clamp(r * 1.62 + 28),
    clamp(g * 1.56 + 22),
    clamp(b * 1.38 + 14),
    a,
  ],

  // Slightly deeper/warmer cedar variation for alternating planks & study
  stardewCedarFloor: (r, g, b, a) => [
    clamp(r * 1.48 + 22),
    clamp(g * 1.4 + 16),
    clamp(b * 1.22 + 10),
    a,
  ],

  // Warm Stardew cottage cream-parchment wallpaper & cedar molding (re-grades inside.png slate-blue wall)
  stardewWall: (r, g, b, a) => {
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    // Preserve warm cream molding highlights, turn blue-slate wall body into warm butter-cream plaster
    if (b > r + 4 && lum < 210) {
      return [clamp(lum * 1.16 + 30), clamp(lum * 1.03 + 22), clamp(lum * 0.8 + 14), a];
    }
    return [clamp(r * 1.04 + 10), clamp(g * 0.98 + 4), clamp(b * 0.84), a];
  },

  // Warm golden-oak Stardew furniture (brightens LPC mahogany slightly so desks & shelves pop on honey floors)
  stardewWood: (r, g, b, a) => [
    clamp(r * 1.2 + 14),
    clamp(g * 1.18 + 10),
    clamp(b * 1.08 + 4),
    a,
  ],

  // Rich walnut desk trim / dark accents
  stardewWalnut: (r, g, b, a) => [
    clamp(r * 1.1 + 8),
    clamp(g * 1.04 + 5),
    clamp(b * 0.94 + 2),
    a,
  ],

  // Warm weathered barn stone flagstone (re-grades castlefloors cool blue-gray cobbles into warm tan stone)
  stardewBarnStone: (r, g, b, a) => {
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    return [clamp(lum * 1.18 + 34), clamp(lum * 1.09 + 24), clamp(lum * 0.92 + 14), a];
  },

  // Soft spa bathhouse turquoise-stone tile
  stardewSpaTile: (r, g, b, a) => {
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    return [clamp(lum * 0.96 + 56), clamp(lum * 1.08 + 64), clamp(lum * 1.06 + 62), a];
  },

  // Cozy crimson Stardew quilt for Owner's farmhouse bed
  stardewBed: (r, g, b, a) => {
    // Shift lavender quilt pixels (b > r + 15) to cozy Stardew burgundy-red quilt while preserving wood & pillow
    if (b > r + 16 && b > g + 16) {
      return [clamp(b * 1.02 + 18), clamp(g * 0.62 + 12), clamp(r * 0.68 + 12), a];
    }
    return [clamp(r * 1.08 + 6), clamp(g * 1.04 + 4), clamp(b * 0.96), a];
  },

  // Bright Pelican Town turquoise-blue pond water
  stardewWater: (r, g, b, a) => {
    if (b > g && b > r + 10) {
      return [clamp(r * 1.05 + 12), clamp(g * 1.18 + 22), clamp(b * 1.1 + 16), a];
    }
    return GRADE.stardewGrass(r, g, b, a);
  },

  // Bright sunlit Stardew cottage window tint (turns dark window glass into cheerful Pelican sky-blue!)
  stardewWindow: (r, g, b, a) => {
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    if (lum < 85 && Math.abs(r - b) < 25) {
      return [clamp(112 + lum * 0.6), clamp(188 + lum * 0.5), clamp(232 + lum * 0.2), a];
    }
    return [clamp(r * 1.04 + 6), clamp(g * 1.0 + 2), clamp(b * 0.9), a];
  },

  // Warm golden-terracotta brick for exterior/hearth
  stardewBrick: (r, g, b, a) => [
    clamp(r * 1.06 + 8),
    clamp(g * 1.02 + 4),
    clamp(b * 0.94),
    a,
  ],
};

/* ---------- Pixel Buffer with Sprite Blitting & Scaling ---------- */
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
  box(x, y, w, h, fill, border, thick = 2) {
    this.rect(x, y, w, h, border);
    this.rect(x + thick, y + thick, w - thick * 2, h - thick * 2, fill);
  }
  roundRect(x0, y0, w, h, r, c) {
    const x1 = x0 + w - 1, y1 = y0 + h - 1;
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
        const cx = Math.max(x0 + r, Math.min(x1 - r, x));
        const cy = Math.max(y0 + r, Math.min(y1 - r, y));
        if (Math.hypot(x - cx, y - cy) <= r + 0.35) this.set(x, y, c);
      }
    }
  }
  borderedRoundRect(x, y, w, h, r, fill, border, thick = 2) {
    this.roundRect(x, y, w, h, r, border);
    this.roundRect(x + thick, y + thick, w - thick * 2, h - thick * 2, Math.max(1, r - thick), fill);
  }
  ellipse(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1.0) this.set(x, y, c);
      }
    }
  }
  circle(cx, cy, r, c) {
    this.ellipse(cx, cy, r, r, c);
  }
  ring(cx, cy, rOuter, rInner, c) {
    for (let y = Math.floor(cy - rOuter); y <= Math.ceil(cy + rOuter); y++) {
      for (let x = Math.floor(cx - rOuter); x <= Math.ceil(cx + rOuter); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= rOuter + 0.25 && d >= rInner - 0.25) this.set(x, y, c);
      }
    }
  }
  line(x0, y0, x1, y1, thick, c) {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    const r = thick / 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      if (thick <= 1.5) this.set(x, y, c);
      else this.circle(x, y, r, c);
    }
  }
  /** Blit a rectangle [sx, sy, sw, sh] from an LPC PNG onto (dx, dy) with optional scaling & Stardew color grade. */
  blit(sheet, sx, sy, sw, sh, dx, dy, opts = {}) {
    const dw = opts.dw ?? sw;
    const dh = opts.dh ?? sh;
    const grade = opts.grade ?? GRADE.identity;
    const flipX = Boolean(opts.flipX);
    const alphaScale = opts.alpha ?? 1;
    for (let y = 0; y < dh; y++) {
      const srcY = sy + Math.floor((y * sh) / dh);
      if (srcY < 0 || srcY >= sheet.h) continue;
      for (let x = 0; x < dw; x++) {
        const relX = Math.floor((x * sw) / dw);
        const srcX = sx + (flipX ? sw - 1 - relX : relX);
        if (srcX < 0 || srcX >= sheet.w) continue;
        const si = (srcY * sheet.w + srcX) * 4;
        const sa = Math.round(sheet.rgba[si + 3] * alphaScale);
        if (sa <= 0) continue;
        const px = grade(sheet.rgba[si], sheet.rgba[si + 1], sheet.rgba[si + 2], sa);
        this.set(dx + x, dy + y, px);
      }
    }
  }
  /** Crisp 1px/2px pixel-art outline around opaque silhouette for standalone sprites. */
  outline(color) {
    const pts = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.getA(x, y) > 0) continue;
        if (
          this.getA(x - 1, y) > 140 ||
          this.getA(x + 1, y) > 140 ||
          this.getA(x, y - 1) > 140 ||
          this.getA(x, y + 1) > 140
        ) {
          pts.push([x, y]);
        }
      }
    }
    for (const [x, y] of pts) this.set(x, y, color);
  }
}

const INK = hex("#2e1e15");
const SHADOW = hex("#23150e", 68);
const SHADOW_SOFT = hex("#23150e", 42);

/* ---------- Reusable Stardew Nature & Interior Compositing Helpers ---------- */

// Exact base RGB of graded LPC grass center pixel so stage & surroundings match pixel-for-pixel!
const MEADOW_BASE = hex("#509a3b");

/**
 * Blit only the organic grass-tuft pixels from Sharm's grass.png (excluding the flat background color)
 * so there are ZERO hard 32x32 tile borders or grid lines anywhere!
 */
function blitGrassTuftsOnly(c, srcX, srcY, dx, dy) {
  const sheet = SHEETS.grass;
  // Sample the tile's own corner pixel as its flat background reference
  const bgI = (srcY * sheet.w + srcX) * 4;
  const bgR = sheet.rgba[bgI], bgG = sheet.rgba[bgI + 1], bgB = sheet.rgba[bgI + 2];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const si = ((srcY + y) * sheet.w + (srcX + x)) * 4;
      const a = sheet.rgba[si + 3];
      if (a < 20) continue;
      const dr = Math.abs(sheet.rgba[si] - bgR);
      const dg = Math.abs(sheet.rgba[si + 1] - bgG);
      const db = Math.abs(sheet.rgba[si + 2] - bgB);
      if (dr + dg + db < 10) continue; // skip flat tile bg -> 100% seamless!
      const px = GRADE.stardewGrass(sheet.rgba[si], sheet.rgba[si + 1], sheet.rgba[si + 2], a);
      c.set(dx + x, dy + y, px);
    }
  }
}

function paintStardewGrassArea(c, tx0, ty0, tw, th, seed = 101, opts = {}) {
  const r = rng(seed);
  const keepBorderClean = Boolean(opts.keepBorderClean);
  // 1) 100% uniform Stardew Spring meadow base (zero tile seams at any DPI!)
  c.rect(tx0 * S, ty0 * S, tw * S, th * S, MEADOW_BASE);
  // 2) Organic hand-pixeled grass tufts from real Sharm LPC grass.png row 5 + varied wildflowers
  for (let ty = ty0; ty < ty0 + th; ty++) {
    for (let tx = tx0; tx < tx0 + tw; tx++) {
      const n = r();
      if (n < 0.42) {
        const vx = Math.floor(r() * 3) * 32;
        blitGrassTuftsOnly(c, vx, 160, tx * S, ty * S);
      }
      // Subtle Stardew wildflowers (daisies, buttercups, pink tulips, blue jazz)
      const f = r();
      if (f < 0.2) {
        const pad = keepBorderClean ? 8 : 6;
        const fx = tx * S + pad + Math.floor(r() * (32 - pad * 2 - 4));
        const fy = ty * S + pad + Math.floor(r() * (32 - pad * 2 - 4));
        const palette = [hex("#fff4b2"), hex("#ff9ab2"), hex("#9ad8ff"), hex("#fffaf0"), hex("#ffd24d")];
        const col = palette[Math.floor(r() * palette.length)];
        c.rect(fx + 2, fy + 4, 2, 4, hex("#3a742b"));
        c.rect(fx, fy + 2, 6, 2, col);
        c.rect(fx + 2, fy, 2, 6, col);
        c.rect(fx + 2, fy + 2, 2, 2, hex("#e89a25"));
      }
    }
  }
}

/** Paint a cute, compact 100% unclipped Stardew berry/garden bush (never overflows stage bounds!). */
function paintStardewBush(c, cx, cy, withBerries = true) {
  c.rect(cx - 12, cy + 5, 24, 5, SHADOW_SOFT);
  // Sample full rounded oak canopy (0, 0, 96, 88) scaled compactly so top & sides stay organically rounded!
  c.blit(SHEETS.treetop, 0, 0, 96, 88, cx - 18, cy - 17, { dw: 36, dh: 28, grade: GRADE.stardewFoliage });
  if (withBerries) {
    c.rect(cx - 8, cy - 6, 3, 3, hex("#e3424a"));
    c.rect(cx + 4, cy - 9, 3, 3, hex("#e3424a"));
    c.rect(cx + 8, cy - 2, 3, 3, hex("#ff7a82"));
    c.rect(cx - 2, cy - 2, 3, 3, hex("#ffe26a"));
  }
}

function paintStardewDirtRoad(c, tx0, ty0, tw, th, seed = 202) {
  const r = rng(seed);
  for (let ty = ty0; ty < ty0 + th; ty++) {
    for (let tx = tx0; tx < tx0 + tw; tx++) {
      // Smooth cohesive Pelican Town dirt lane using dirt.png autotile top-edge & rich gravel fill
      const srcY = ty === ty0 ? 64 : 96;
      c.blit(SHEETS.dirt, 32, srcY, 32, 32, tx * S, ty * S, { grade: GRADE.stardewDirt });
      // Subtle organic pebble texture from row 5 (same palette, zero checkerboard!)
      if (ty > ty0 && r() < 0.42) {
        const vx = Math.floor(r() * 3) * 32;
        c.blit(SHEETS.dirt, vx, 160, 32, 32, tx * S, ty * S, { grade: GRADE.stardewDirt, alpha: 0.48 });
      }
    }
  }
}

/** Paint a pixel-art Stardew Valley tilled soil patch with lush growing crops (parsnips, strawberries, cauliflower). */
function paintStardewCropPlot(c, x, y, cols, rows, cropTypes) {
  const pw = cols * 22 + 8;
  const ph = rows * 18 + 8;
  // Dark rich furrowed Stardew tilled earth border
  c.rect(x - 2, y - 2, pw + 4, ph + 4, hex("#4f331d", 140));
  c.rect(x, y, pw, ph, hex("#8a5733"));
  c.rect(x + 2, y + 2, pw - 4, ph - 4, hex("#754627"));
  for (let ry = 0; ry < rows; ry++) {
    const sy = y + 4 + ry * 18;
    c.rect(x + 3, sy, pw - 6, 12, hex("#683b1f"));
    c.rect(x + 3, sy + 2, pw - 6, 3, hex("#9b653c"));
    c.rect(x + 3, sy + 11, pw - 6, 2, hex("#4e2a15"));
    for (let cx = 0; cx < cols; cx++) {
      const sx = x + 6 + cx * 22;
      const kind = cropTypes[(ry * cols + cx) % cropTypes.length];
      if (kind === "parsnip") {
        // Creamy-white root tip + leafy green crown
        c.rect(sx + 5, sy + 6, 6, 5, hex("#f7ebd0"));
        c.rect(sx + 7, sy + 9, 2, 3, hex("#dfd0ae"));
        c.rect(sx + 3, sy, 4, 6, hex("#479634"));
        c.rect(sx + 7, sy - 2, 4, 8, hex("#65ba44"));
        c.rect(sx + 10, sy + 1, 3, 5, hex("#3a7c29"));
      } else if (kind === "strawberry") {
        // Bushy green leaves + bright ruby strawberries
        c.rect(sx + 2, sy + 1, 12, 8, hex("#3d822e"));
        c.rect(sx + 4, sy - 1, 8, 6, hex("#5cb140"));
        c.rect(sx + 3, sy + 5, 4, 4, hex("#e33b44"));
        c.rect(sx + 4, sy + 5, 2, 2, hex("#ff888e"));
        c.rect(sx + 9, sy + 6, 4, 4, hex("#d12e39"));
      } else if (kind === "cauliflower") {
        // Big plump cream cauliflower head nestled in broad leaves
        c.rect(sx + 1, sy + 2, 14, 9, hex("#3d8432"));
        c.rect(sx + 3, sy + 1, 10, 7, hex("#64b449"));
        c.rect(sx + 4, sy + 2, 8, 6, hex("#fbf4de"));
        c.rect(sx + 5, sy + 1, 6, 2, hex("#ffffff"));
        c.rect(sx + 5, sy + 7, 6, 2, hex("#dcd2b4"));
      } else {
        // Golden Stardew Sunflower / Melon
        c.rect(sx + 6, sy + 3, 4, 8, hex("#3e872e"));
        c.rect(sx + 3, sy - 2, 10, 8, hex("#f7c839"));
        c.rect(sx + 5, sy, 6, 4, hex("#6b3c1b"));
        c.rect(sx + 6, sy + 1, 2, 2, hex("#9c5d2c"));
      }
    }
  }
}

/** Paint a real LPC hand-pixeled Stardew Oak or Pine tree with trunk & lush foliage canopy. */
function paintStardewTree(c, cx, baseY, variant = "oakA") {
  // Ground shadow
  c.rect(cx - 26, baseY - 8, 52, 14, SHADOW_SOFT);
  if (variant === "oakA") {
    c.blit(SHEETS.trunk, 0, 0, 96, 96, cx - 48, baseY - 76, { grade: GRADE.stardewWood });
    c.blit(SHEETS.treetop, 0, 0, 96, 96, cx - 48, baseY - 118, { grade: GRADE.stardewFoliage });
  } else if (variant === "oakB") {
    c.blit(SHEETS.trunk, 96, 0, 96, 96, cx - 48, baseY - 76, { grade: GRADE.stardewWood });
    c.blit(SHEETS.treetop, 96, 0, 96, 96, cx - 48, baseY - 114, { grade: GRADE.stardewFoliage });
  } else if (variant === "pineA") {
    c.blit(SHEETS.treetop, 0, 96, 96, 128, cx - 48, baseY - 118, { grade: GRADE.stardewFoliage });
  } else {
    c.blit(SHEETS.treetop, 96, 96, 96, 128, cx - 48, baseY - 116, { grade: GRADE.stardewFoliage });
  }
}

/** Paint a rich Stardew Honey-Oak wood plank floor using real LPC inside.png plank tile (0,128). */
function paintHoneyOakFloor(c, tx0, ty0, tw, th, variant = "honey") {
  const gA = variant === "cedar" ? GRADE.stardewCedarFloor : GRADE.stardewHoneyFloor;
  const gB = variant === "cedar"
    ? (r, g, b, a) => [clamp(r * 1.42 + 18), clamp(g * 1.34 + 13), clamp(b * 1.18 + 8), a]
    : (r, g, b, a) => [clamp(r * 1.56 + 24), clamp(g * 1.49 + 18), clamp(b * 1.32 + 11), a];
  for (let ty = ty0; ty < ty0 + th; ty++) {
    for (let tx = tx0; tx < tx0 + tw; tx++) {
      const flip = ((tx * 7 + ty * 13) % 3) === 0;
      const grade = ((tx + ty * 2) % 2) === 0 ? gA : gB;
      c.blit(SHEETS.inside, 0, 128, 32, 32, tx * S, ty * S, { grade, flipX: flip });
    }
  }
}

/** Paint a warm Stardew Farmhouse Kitchen checkered terracotta & butter-cream tile floor. */
function paintKitchenFloor(c, tx0, ty0, tw, th) {
  for (let ty = ty0; ty < ty0 + th; ty++) {
    for (let tx = tx0; tx < tx0 + tw; tx++) {
      const x = tx * S, y = ty * S;
      for (let subY = 0; subY < 2; subY++) {
        for (let subX = 0; subX < 2; subX++) {
          const isCream = (tx * 2 + subX + ty * 2 + subY) % 2 === 0;
          const sx = x + subX * 16, sy = y + subY * 16;
          c.rect(sx, sy, 16, 16, hex("#9c6d4c"));
          c.rect(sx + 1, sy + 1, 14, 14, isCream ? hex("#eed9b7") : hex("#d68d60"));
          c.rect(sx + 1, sy + 1, 14, 2, isCream ? hex("#f8ebd4") : hex("#e5a57a"));
          c.rect(sx + 1, sy + 13, 14, 2, isCream ? hex("#d6be9a") : hex("#b56d44"));
        }
      }
    }
  }
}

/** Paint a lush woven Persian / Pelican Town rug using castlefloors.png crimson-gold carpet! */
function paintStardewCarpet(c, x, y, w, h) {
  // Subtle floor shadow
  c.rect(x + 2, y + 4, w, h, SHADOW_SOFT);
  // Tile inner crimson center + golden ornate border from castlefloors.png (32..128, 192..288)
  const border = 16;
  // Center fill
  c.blit(SHEETS.castlefloors, 48, 208, 64, 64, x + border, y + border, { dw: w - border * 2, dh: h - border * 2 });
  // Top & Bottom ornate gold border strips
  c.blit(SHEETS.castlefloors, 48, 192, 64, 16, x + border, y, { dw: w - border * 2, dh: border });
  c.blit(SHEETS.castlefloors, 48, 272, 64, 16, x + border, y + h - border, { dw: w - border * 2, dh: border });
  // Left & Right ornate gold border strips
  c.blit(SHEETS.castlefloors, 32, 208, 16, 64, x, y + border, { dw: border, dh: h - border * 2 });
  c.blit(SHEETS.castlefloors, 112, 208, 16, 64, x + w - border, y + border, { dw: border, dh: h - border * 2 });
  // 4 Corners
  c.blit(SHEETS.castlefloors, 32, 192, 16, 16, x, y);
  c.blit(SHEETS.castlefloors, 112, 192, 16, 16, x + w - border, y);
  c.blit(SHEETS.castlefloors, 32, 272, 16, 16, x, y + h - border);
  c.blit(SHEETS.castlefloors, 112, 272, 16, 16, x + w - border, y + h - border);
  // Woven cream fringe along left & right edges (iconic Stardew rug touch!)
  for (let fy = y + 6; fy < y + h - 4; fy += 6) {
    c.rect(x - 3, fy, 3, 2, hex("#f0dfb4"));
    c.rect(x + w, fy, 3, 2, hex("#f0dfb4"));
  }
}

/** Paint a cozy pixel-art Stardew Valley Potted Fern / Sunflower Plant (1x1 tile). */
function paintStardewPlant(c, x, y, variant = 0) {
  c.rect(x + 6, y + 24, 20, 6, SHADOW);
  // Terracotta pot with crisp Stardew outline
  c.box(x + 8, y + 16, 16, 12, hex("#c86842"), INK, 2);
  c.box(x + 6, y + 13, 20, 6, hex("#db7c52"), INK, 2);
  c.rect(x + 8, y + 15, 16, 2, hex("#f09e74"));
  c.rect(x + 10, y + 19, 4, 6, hex("#e3875e"));
  // Lush layered foliage leaves
  const leaves = variant % 2 === 0
    ? [
        [x + 6, y + 5, 8, 8, hex("#3a7c2e")],
        [x + 18, y + 5, 8, 8, hex("#3a7c2e")],
        [x + 10, y + 2, 12, 11, hex("#52a43c")],
        [x + 12, y + 4, 8, 6, hex("#79cc56")],
      ]
    : [
        [x + 5, y + 6, 9, 7, hex("#377a32")],
        [x + 18, y + 6, 9, 7, hex("#377a32")],
        [x + 9, y + 3, 14, 10, hex("#4ea042")],
        [x + 12, y + 1, 8, 6, hex("#ffd34d")],
        [x + 14, y + 3, 4, 3, hex("#7a441e")],
      ];
  for (const [lx, ly, lw, lh, col] of leaves) {
    c.box(lx, ly, lw, lh, col, INK, 1);
  }
}

/** Paint the iconic Stardew Valley Pelican Town "Help Wanted" Bulletin Board! */
function paintHelpWantedBoard(c, x, y, w, h) {
  // Ground shadow
  c.rect(x + 6, y + h - 10, w - 12, 10, SHADOW);
  // Sturdy cedar posts
  c.box(x + 12, y + 16, 10, h - 18, hex("#7d4824"), INK, 2);
  c.box(x + w - 22, y + 16, 10, h - 18, hex("#7d4824"), INK, 2);
  // Main cork & timber board body
  const bx = x + 6, by = y + 18, bw = w - 12, bh = h - 32;
  c.box(bx, by, bw, bh, hex("#8b5229"), INK, 2);
  c.box(bx + 6, by + 6, bw - 12, bh - 12, hex("#c8935c"), hex("#5c3318"), 2);
  // Cork grain speckles
  const r = rng(bx * 31 + by);
  for (let i = 0; i < 65; i++) {
    const px = bx + 10 + Math.floor(r() * (bw - 20));
    const py = by + 10 + Math.floor(r() * (bh - 20));
    c.rect(px, py, 2, 2, r() > 0.5 ? hex("#b17b46") : hex("#d9a973"));
  }
  // Pinned Stardew Quest Parchments + Calendar!
  const notes = [
    { ox: 12, oy: 12, nw: 28, nh: 30, col: hex("#faf0d2"), pin: hex("#d9443e") }, // Calendar
    { ox: 46, oy: 14, nw: 24, nh: 26, col: hex("#fff7de"), pin: hex("#4d9c48") }, // Quest 1
    { ox: 76, oy: 12, nw: 26, nh: 28, col: hex("#f6e4bc"), pin: hex("#e89a25") }, // Quest 2
  ];
  if (bw >= 132) {
    notes.push({ ox: 108, oy: 15, nw: 24, nh: 24, col: hex("#f9edd0"), pin: hex("#4d82c4") });
  }
  for (const n of notes) {
    if (n.ox + n.nw > bw - 10 || n.oy + n.nh > bh - 10) continue;
    c.rect(bx + n.ox + 2, by + n.oy + 2, n.nw, n.nh, SHADOW_SOFT);
    c.box(bx + n.ox, by + n.oy, n.nw, n.nh, n.col, hex("#6b4a2e"), 1);
    // Pin head
    c.rect(bx + n.ox + Math.floor(n.nw / 2) - 2, by + n.oy + 2, 4, 4, n.pin);
    // Tiny handwritten quest lines
    for (let ly = 9; ly < n.nh - 5; ly += 4) {
      c.rect(bx + n.ox + 4, by + n.oy + ly, n.nw - 8 - (ly % 5), 2, hex("#7d5c42", 170));
    }
  }
  // Shingled wooden Stardew roof eave crowning the board!
  c.box(x + 2, y + 4, w - 4, 18, hex("#a85832"), INK, 2);
  for (let rx = x + 6; rx < x + w - 8; rx += 10) {
    c.rect(rx, y + 6, 8, 6, hex("#c26d42"));
    c.rect(rx + 2, y + 12, 8, 6, hex("#8c4424"));
    c.rect(rx, y + 6, 8, 2, hex("#db8758"));
  }
  // Golden ridge beam
  c.rect(x + 4, y + 4, w - 8, 3, hex("#e8a862"));
}

/** Paint a cozy pixel-art Stardew Valley Lounge Brick Fireplace Hearth (using real house.png brick!). */
function paintStardewHearth(c, x, y, w, h) {
  c.rect(x + 2, y + h - 6, w + 6, 10, SHADOW);
  // Real LPC red-brick body!
  c.blit(SHEETS.house, 0, 0, 96, 96, x, y, { dw: w, dh: h, grade: GRADE.stardewBrick });
  // Crisp outer ink frame & thick wooden mantelpiece
  c.box(x - 2, y, w + 4, 12, hex("#8b502a"), INK, 2);
  c.rect(x + 2, y + 2, w - 4, 3, hex("#bd7846"));
  // Firebox opening (glowing hearth aligned with office-harvest.js ember animation!)
  const fx = x + 10, fy = y + 24, fw = w - 20, fh = h - 38;
  c.box(fx, fy, fw, fh, hex("#241512"), hex("#4c3224"), 2);
  // Logs + warm ember bed
  c.rect(fx + 4, fy + fh - 10, fw - 8, 6, hex("#5e341c"));
  c.rect(fx + 6, fy + fh - 16, fw - 12, 10, hex("#d95b26"));
  c.rect(fx + 10, fy + fh - 14, fw - 20, 6, hex("#ffbe4a"));
  // Mantle brass candlesticks & miniature framed picture
  c.rect(x + 8, y - 8, 4, 8, hex("#e8b84b"));
  c.rect(x + 9, y - 11, 2, 3, hex("#fff2a6"));
  c.box(x + Math.floor(w / 2) - 8, y - 10, 16, 10, hex("#7ab864"), hex("#5e361c"), 2);
}

/** Paint a Stardew Valley cozy green cottage sofa facing South, North (back to viewer), or West. */
function paintStardewSofa(c, x, y, w, h, dir = "south") {
  c.rect(x + 2, y + 4, w, h, SHADOW);
  const fabric = hex("#5b8f56");
  const fabricHi = hex("#7cb570");
  const fabricSh = hex("#3d683b");
  const trim = hex("#7f4926");
  if (dir === "south") {
    c.box(x, y, w, h, fabric, INK, 2);
    // Wooden top rail & armrests
    c.box(x, y, w, 12, trim, INK, 2);
    c.rect(x + 4, y + 2, w - 8, 3, hex("#ad6b3c"));
    c.box(x, y + 8, 12, h - 8, fabricSh, INK, 2);
    c.box(x + w - 12, y + 8, 12, h - 8, fabricSh, INK, 2);
    // Plump segmented seat cushions
    const cushions = Math.max(2, Math.round((w - 24) / 28));
    const cw = Math.floor((w - 24) / cushions);
    for (let i = 0; i < cushions; i++) {
      const cx = x + 12 + i * cw;
      c.box(cx, y + 12, cw, h - 14, fabric, hex("#31542f"), 1);
      c.rect(cx + 3, y + 15, cw - 6, 5, fabricHi);
    }
  } else if (dir === "north") {
    // Facing NORTH (toward TV!) — cushions visible along top, upholstered backrest & walnut rail along bottom!
    c.box(x, y, w, h, fabric, INK, 2);
    const cushions = Math.max(2, Math.round((w - 24) / 34));
    const cw = Math.floor((w - 24) / cushions);
    for (let i = 0; i < cushions; i++) {
      const cx = x + 12 + i * cw;
      c.box(cx, y + 2, cw, h - 14, fabric, hex("#31542f"), 1);
      c.rect(cx + 3, y + 4, cw - 6, 6, fabricHi);
    }
    // Padded side armrests
    c.box(x, y, 12, h - 6, fabricSh, INK, 2);
    c.box(x + w - 12, y, 12, h - 6, fabricSh, INK, 2);
    // Rear backrest & sleek walnut back rail along bottom edge
    c.box(x, y + h - 12, w, 12, trim, INK, 2);
    c.rect(x + 4, y + h - 10, w - 8, 3, hex("#ad6b3c"));
  } else {
    // Cozy side armchair facing WEST
    c.box(x, y, w, h, fabric, INK, 2);
    c.box(x + w - 12, y, 12, h, trim, INK, 2);
    c.box(x, y, w - 8, 10, fabricSh, INK, 2);
    c.box(x, y + h - 10, w - 8, 10, fabricSh, INK, 2);
    c.rect(x + 4, y + 13, w - 18, h - 26, fabricHi);
  }
}

/* ---------- 1. Compose Main Stardew Valley Farmhouse Floor (1536x896) ---------- */
function generateFarmhouseBackground(laneCanvas) {
  const c = new Canvas(W, H);

  // STEP A: 100% seamless Stardew Spring meadow across the entire 48x28 canvas exterior
  paintStardewGrassArea(c, 0, 0, PLAN.cols, PLAN.rows, 404, { keepBorderClean: true });

  // STEP B: Pelican Town dirt village road along bottom (y=26..27) stamped IDENTICALLY from lane-tile@2x
  // (1536 / 192 = 8.0 exact tiles -> ZERO seam at x=0 and x=1536 with surroundings!)
  for (let rx = 0; rx < W; rx += 192) {
    c.blit({ w: laneCanvas.w, h: laneCanvas.h, rgba: laneCanvas.buf }, 0, 0, 192, 64, rx, 26 * S);
  }
  // Welcoming Limestone Flagstone Front Porch Landing & Entry Steps (x=21..24, y=25) connecting door to lane cleanly!
  const porchX = 21 * S + 8, porchY = 25 * S - 2, porchW = 4 * S - 16, porchH = S + 6;
  c.rect(porchX + 2, porchY + 4, porchW, porchH, SHADOW_SOFT);
  c.borderedRoundRect(porchX, porchY, porchW, porchH, 4, hex("#cbbba4"), hex("#6f5b47"), 2);
  // Hand-laid warm limestone flagstones with crisp grout joints & sunlit top bevel
  for (let row = 0; row < 2; row++) {
    const sy = porchY + 3 + row * 16;
    const cols = row === 0 ? [0, 34, 68, 96] : [0, 24, 58, 86];
    for (let i = 0; i < cols.length; i++) {
      const sx = porchX + 3 + cols[i];
      const sw = (i < cols.length - 1 ? cols[i + 1] - cols[i] : (porchW - 6) - cols[i]) - 2;
      const sh = row === 0 ? 14 : 15;
      c.box(sx, sy, sw, sh, (i + row) % 2 === 0 ? hex("#dfd1bc") : hex("#d4c4ac"), hex("#96836c"), 1);
      c.rect(sx + 1, sy + 1, sw - 2, 2, hex("#efe5d5"));
    }
  }
  // Twin Terracotta Porch Planters with Blooming Marigolds flanking the stone entrance steps!
  for (const fx of [21 * S - 4, 24 * S + 16]) {
    const fy = 25 * S + 4;
    c.rect(fx + 2, fy + 16, 18, 6, SHADOW_SOFT);
    c.borderedRoundRect(fx + 2, fy + 10, 16, 12, 3, hex("#c46d45"), INK, 1);
    c.rect(fx + 1, fy + 8, 18, 4, hex("#d98055"));
    c.circle(fx + 10, fy + 6, 7, hex("#479144"));
    c.circle(fx + 7, fy + 5, 3, hex("#ffd54f")); // marigold bloom
    c.circle(fx + 13, fy + 4, 3, hex("#ff9e44"));
    c.circle(fx + 10, fy + 8, 2.5, hex("#fff199"));
  }

  // STEP C: Iconic Stardew Duck Pond in North-East meadow (x=37..39, y=0..1) — fully unclipped inside bounds!
  c.blit(SHEETS.watergrass, 0, 64, 96, 96, 37 * S, 2, { dw: 96, dh: 60, grade: GRADE.stardewWater });

  // STEP D: Stardew Valley Tilled Crop Plots & Wooden Farm Fences in North & South gardens!
  paintStardewCropPlot(c, 4 * S, 6, 5, 2, ["parsnip", "cauliflower", "strawberry", "parsnip", "sunflower"]);
  paintStardewCropPlot(c, 21 * S, 6, 5, 2, ["strawberry", "parsnip", "sunflower", "cauliflower", "strawberry"]);
  paintStardewCropPlot(c, 3 * S, 25 * S + 2, 4, 1, ["parsnip", "strawberry", "cauliflower", "sunflower"]);
  paintStardewCropPlot(c, 28 * S, 25 * S + 2, 5, 1, ["sunflower", "parsnip", "strawberry", "cauliflower", "parsnip"]);

  // Real LPC wooden fences from bridges.png along garden borders (STOPPING at x=38 so Garage Door x=40..45 is 100% unobstructed!)
  for (const fx of [11, 12, 13, 14, 15, 29, 30, 31, 32, 33]) {
    c.blit(SHEETS.bridges, 96, 96, 32, 32, fx * S, 18, { grade: GRADE.stardewWood });
  }
  for (const fx of [10, 11, 12, 13, 14, 15, 16, 17, 36, 37, 38]) {
    c.blit(SHEETS.bridges, 96, 96, 32, 32, fx * S, 25 * S - 6, { grade: GRADE.stardewWood });
  }
  // Smooth Paved Concrete Garage Driveway Apron (x=40..45, y=25) connecting Garage Door straight to main road!
  const drX = 40 * S, drY = 25 * S, drW = 6 * S, drH = S + 4;
  c.rect(drX - 2, drY, drW + 4, drH, hex("#6b727a")); // curb edge
  c.rect(drX, drY, drW, drH, hex("#a3a9b0")); // concrete apron
  c.rect(drX + 2, drY + 1, drW - 4, 3, hex("#c2c8cf")); // top bevel
  for (let gx = drX + S * 2; gx < drX + drW; gx += S * 2) {
    c.rect(gx, drY, 2, drH, hex("#848b94")); // expansion joint
  }
  // Subtle wheel exit guide tracks
  c.rect(drX + 28, drY + 4, 18, drH - 6, hex("#8d949c", 110));
  c.rect(drX + 94, drY + 4, 18, drH - 6, hex("#8d949c", 110));

  // Decorative farm rocks from rock.png (clear of driveway!)
  c.blit(SHEETS.rock, 0, 0, SHEETS.rock.w, SHEETS.rock.h, 16 * S + 8, 22, { dw: 42, dh: 22 });
  c.blit(SHEETS.rock, 0, 0, SHEETS.rock.w, SHEETS.rock.h, 38 * S + 20, 25 * S + 4, { dw: 32, dh: 18 });

  // STEP E: Farmhouse Interior Floors (100% aligned to OFFICE_PLAN walls!)
  // 1) Main Studio Floor (x=11..37, y=3..23) — Iconic Stardew Valley Honey-Oak Planks!
  paintHoneyOakFloor(c, 11, 3, 27, 21, "honey");
  // 2) Founder / CEO Executive Suite (x=2..9, y=17..23) — Rich Deep Espresso-Walnut Executive Hardwood!
  const gradeExecA = (r, g, b, a) => [clamp(r * 1.14 + 10), clamp(g * 1.02 + 6), clamp(b * 0.88 + 3), a];
  const gradeExecB = (r, g, b, a) => [clamp(r * 1.06 + 8), clamp(g * 0.94 + 4), clamp(b * 0.82 + 2), a];
  for (let ty = 17; ty <= 23; ty++) {
    for (let tx = 2; tx <= 9; tx++) {
      c.blit(SHEETS.inside, 0, 128, 32, 32, tx * S, ty * S, {
        grade: (tx + ty) % 2 === 0 ? gradeExecA : gradeExecB,
        flipX: (tx * 5 + ty * 3) % 2 === 0,
      });
    }
  }
  // 3) Modern Cozy Studio Kitchen & Cafe (x=2..9, y=3..10) — Clean Warm Cream Terrazzo Porcelain Tiles!
  for (let ty = 3; ty <= 10; ty++) {
    for (let tx = 2; tx <= 9; tx++) {
      const x = tx * S, y = ty * S;
      const isAlt = (tx + ty) % 2 === 0;
      c.rect(x, y, S, S, hex("#d4cab8")); // fine grout
      c.rect(x + 1, y + 1, S - 2, S - 2, isAlt ? hex("#f3ece0") : hex("#ebe2d2"));
      c.rect(x + 1, y + 1, S - 2, 2, hex("#fbf6ec"));
      // subtle terrazzo speckles
      c.rect(x + 7, y + 10, 2, 2, hex("#d8cbb7"));
      c.rect(x + 21, y + 22, 2, 2, hex("#cbbda6"));
    }
  }
  // 4) Modern Boutique Restroom / Toilet (x=2..9, y=12..15) — Crisp Light Marble-White Studio Tiles!
  for (let ty = 12; ty <= 15; ty++) {
    for (let tx = 2; tx <= 9; tx++) {
      const x = tx * S, y = ty * S;
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const isAlt = (tx + ty + sx + sy) % 2 === 0;
          c.rect(x + sx * 16, y + sy * 16, 16, 16, hex("#d2d6d4"));
          c.rect(x + sx * 16 + 1, y + sy * 16 + 1, 14, 14, isAlt ? hex("#eff3f2") : hex("#e5ecea"));
          c.rect(x + sx * 16 + 1, y + sy * 16 + 1, 14, 1, hex("#ffffff"));
        }
      }
    }
  }
  // 5) Executive Boardroom Floor (x=39..45, y=3..12) — Warm Honey-Oak Parquet + Plush Boardroom Carpet!
  paintHoneyOakFloor(c, 39, 3, 7, 10, "honey");
  // Subtle dark oak border inlay framing the Executive Boardroom perimeter
  c.box(39 * S + 4, 3 * S + 4, 7 * S - 8, 10 * S - 8, hex("#000000", 0), hex("#9e6b3d", 140), 2);

  // 6) Compact Modern Studio Garage (x=39..45, y=14..23) — Smooth Polished Concrete + Painted Parking Bay!
  const garRng = rng(731);
  for (let ty = 14; ty <= 23; ty++) {
    for (let tx = 39; tx <= 45; tx++) {
      const x = tx * S, y = ty * S;
      const shade = garRng() > 0.5 ? hex("#9aa0a6") : hex("#949ba1");
      c.rect(x, y, S, S, shade);
      if (tx % 2 === 0) c.rect(x, y, 1, S, hex("#7d848b"));
      if (ty % 2 === 0) c.rect(x, y, S, 1, hex("#7d848b"));
      for (let sp = 0; sp < 4; sp++) {
        c.rect(x + Math.floor(garRng() * 28), y + Math.floor(garRng() * 28), 2, 2, garRng() > 0.5 ? hex("#aeb4ba", 120) : hex("#7c8289", 120));
      }
    }
  }
  // Crisp painted yellow-amber parking bay guide lines framing the modern car slot (x=39.6..44.2, y=15.6..22.8)
  c.rect(39 * S + 18, 15 * S + 20, 4, 7 * S + 8, hex("#e8be4a", 210));
  c.rect(44 * S + 8, 15 * S + 20, 4, 7 * S + 8, hex("#e8be4a", 210));
  c.rect(39 * S + 18, 15 * S + 20, 5 * S - 6, 4, hex("#e8be4a", 210));
  // Rubber wheel-stop curb at front of parking bay + ribbed rubber entry mat at garage doorway (x=39, y=15..16)
  c.borderedRoundRect(40 * S + 16, 15 * S + 28, 3 * S, 8, 3, hex("#343940"), INK, 1);
  c.rect(40 * S + 28, 15 * S + 30, 14, 4, hex("#f0c64b"));
  c.rect(42 * S + 6, 15 * S + 30, 14, 4, hex("#f0c64b"));
  // Subtle ribbed charcoal entry mat inside garage door
  c.borderedRoundRect(39 * S + 2, 15 * S + 8, 12, 46, 2, hex("#3c424a"), hex("#22262b"), 1);
  for (let my = 15 * S + 14; my < 15 * S + 50; my += 6) c.rect(39 * S + 4, my, 8, 2, hex("#525a63"));

  // Doorway floor thresholds connecting rooms smoothly (Boardroom doorway at x=38, y=7..8; Garage doorway at x=38, y=15..16!)
  paintHoneyOakFloor(c, 10, 8, 1, 2, "honey");
  paintHoneyOakFloor(c, 10, 17, 1, 2, "honey");
  paintHoneyOakFloor(c, 8, 11, 2, 1, "honey");
  paintHoneyOakFloor(c, 38, 7, 1, 2, "honey");
  paintHoneyOakFloor(c, 38, 15, 1, 2, "cedar");
  paintHoneyOakFloor(c, 22, 24, 2, 1, "honey");

  // Subtle ambient occlusion under north wall & left/right partitions for crisp 3D depth!
  c.rect(2 * S, 3 * S, 44 * S, 8, SHADOW_SOFT);
  c.rect(2 * S, 12 * S, 6 * S, 6, SHADOW_SOFT);
  c.rect(2 * S, 17 * S, 8 * S, 6, SHADOW_SOFT);
  c.rect(39 * S, 14 * S, 7 * S, 6, SHADOW_SOFT);

  // STEP F: Farmhouse Walls (exact OFFICE_PLAN.walls!)
  // Render walls with real LPC inside.png warm cottage plaster + cedar timber roof-cap!
  for (const w of PLAN.walls) {
    const wx = w.x * S, wy = w.y * S, ww = w.w * S, wh = w.h * S;
    if (w.h === 1) {
      // Horizontal wall: warm cedar timber crown beam + graded cottage wainscoting
      for (let tx = w.x; tx < w.x + w.w; tx++) {
        const x = tx * S;
        c.blit(SHEETS.inside, 32, 32, 32, 32, x, wy, { grade: GRADE.stardewWall });
        // Rich Stardew cedar top beam
        c.rect(x, wy, S, 12, hex("#8f5228"));
        c.rect(x, wy, S, 2, INK);
        c.rect(x, wy + 2, S, 3, hex("#ba7441"));
        c.rect(x, wy + 10, S, 2, hex("#592f15"));
        // Crisp baseboard along bottom
        c.rect(x, wy + S - 4, S, 2, hex("#7d4824"));
        c.rect(x, wy + S - 2, S, 2, INK);
      }
      // Subtle vertical timber studs every 4 tiles
      for (let tx = w.x; tx < w.x + w.w; tx += 4) {
        c.rect(tx * S, wy + 10, 4, S - 12, hex("#784321", 160));
      }
    } else {
      // Vertical wall: solid cedar log/timber partition with highlight & crisp outline
      c.box(wx, wy, ww, wh, hex("#96582e"), INK, 2);
      c.rect(wx + 4, wy + 2, 6, wh - 4, hex("#b87544"));
      c.rect(wx + ww - 8, wy + 2, 5, wh - 4, hex("#6b3b1c"));
      for (let py = wy + 16; py < wy + wh - 8; py += 24) {
        c.rect(wx + 2, py, ww - 4, 2, hex("#592f16", 150));
      }
    }
  }

  // Real LPC Multipane Cottage Windows (house.png) along North & South farmhouse walls!
  for (const tx of [2, 12, 19, 31, 40, 44]) {
    c.blit(SHEETS.house, 256, 8, 32, 40, tx * S, 2 * S - 2, { dw: 32, dh: 34, grade: GRADE.stardewWindow });
    // Tiny windowsill flowerbox!
    c.box(tx * S + 2, 2 * S + 26, 28, 6, hex("#8a4f28"), INK, 1);
    c.rect(tx * S + 5, 2 * S + 24, 4, 3, hex("#ff8896"));
    c.rect(tx * S + 13, 2 * S + 24, 5, 3, hex("#ffe066"));
    c.rect(tx * S + 22, 2 * S + 24, 4, 3, hex("#88c8ff"));
  }
  for (const tx of [4, 12, 17, 28, 34]) {
    c.blit(SHEETS.house, 224, 0, 32, 32, tx * S, 24 * S + 2, { dw: 32, dh: 28, grade: GRADE.stardewWindow });
  }

  // Cozy Stardew Farmhouse Framed Wall Art symmetrically placed above the North workstation pods!
  for (const [tx, bg, acc] of [
    [15, hex("#7dc2e8"), hex("#55a846")], // Pelican Valley hill painting (above Pod NW)
    [28, hex("#f7e7ba"), hex("#54b350")], // Cute emerald Junimo portrait (above Pod NE left)
    [34, hex("#f2b66d"), hex("#c94b3b")], // Sunset barn painting (above Pod NE right)
  ]) {
    const px = tx * S + 4, py = 2 * S + 10;
    c.box(px, py, 24, 16, bg, hex("#6b3c1c"), 2);
    c.rect(px + 3, py + 8, 18, 5, acc);
    c.rect(px + 15, py + 3, 4, 4, hex("#ffe873"));
  }

  // Modern Sectional Metallic Garage Roller Door along South Garage Wall (x=40..45, y=24)
  c.box(40 * S, 24 * S + 4, 6 * S, 24, hex("#cfd5dc"), INK, 2);
  for (let ry = 24 * S + 9; ry < 24 * S + 26; ry += 5) {
    c.rect(40 * S + 2, ry, 6 * S - 4, 2, hex("#9ba3ad"));
    c.rect(40 * S + 2, ry + 2, 6 * S - 4, 1, hex("#e8edf2"));
  }
  c.rect(42 * S + 24, 24 * S + 21, 16, 3, hex("#4b525c")); // garage door handle

  // IMAGE 2: Grand Cozy Farmhouse Studio Main Entrance (x=22..23, y=24) — Double Cedar & Mullioned-Glass Doors + Brass Carriage Lanterns!
  const doorX = 22 * S, doorY = 24 * S;
  // Crisp warm limestone & cedar threshold sill bridging foyer floor to stone porch
  c.box(doorX, doorY + S - 8, 2 * S, 10, hex("#bfa98e"), hex("#5e4936"), 1);
  c.rect(doorX + 2, doorY + S - 6, 2 * S - 4, 3, hex("#e3d4be"));
  // Carved timber entrance header beam & solid left/right doorposts
  c.box(doorX - 4, doorY, 2 * S + 8, 8, hex("#7d4520"), INK, 2);
  c.rect(doorX - 2, doorY + 2, 2 * S + 4, 2, hex("#b36e3d"));
  c.box(doorX - 4, doorY + 6, 8, S - 6, hex("#8f5228"), INK, 2);
  c.box(doorX + 2 * S - 4, doorY + 6, 8, S - 6, hex("#8f5228"), INK, 2);
  // Open/ajar double cedar-and-glass French studio door leaves tucked cleanly along inner jambs
  for (const isRight of [false, true]) {
    const lx = isRight ? doorX + 2 * S - 14 : doorX + 4;
    c.box(lx, doorY + 6, 10, S - 10, hex("#9c5d30"), INK, 1);
    c.box(lx + 2, doorY + 9, 6, 9, hex("#cde6f0"), hex("#5e361b"), 1); // upper glass mullion pane
    c.rect(lx + 3, doorY + 10, 4, 2, hex("#eef9fc"));
    c.rect(lx + (isRight ? 1 : 7), doorY + 20, 2, 4, hex("#e8be5a")); // brushed brass lever handle!
  }
  // Flanking Symmetrical Warm Brass Carriage Wall Lanterns on South Exterior Wall (clear of doorposts!)
  for (const lx of [21 * S + 10, 24 * S + 10]) {
    const ly = 24 * S + 8;
    c.rect(lx + 4, ly - 1, 6, 3, hex("#2f353d")); // wrought-iron wall mount cap
    c.box(lx + 2, ly + 2, 10, 14, hex("#ffd97d"), hex("#2f353d"), 2); // glowing golden lantern glass
    c.rect(lx + 4, ly + 4, 6, 9, hex("#fff3bd"));
    c.rect(lx + 6, ly + 6, 2, 5, hex("#ffffff"));
    c.rect(lx + 4, ly + 16, 6, 2, hex("#2f353d")); // brass finial base
  }
  // Woven Coir & Forest-Sage Bordered Welcome Mat inside Grand Foyer (x=22..23, y=23)
  c.borderedRoundRect(22 * S + 6, 23 * S + 6, 52, 20, 4, hex("#597d5e"), hex("#324a36"), 2);
  c.borderedRoundRect(22 * S + 10, 23 * S + 9, 44, 14, 2, hex("#cca066"), hex("#875c2e"), 1);
  c.rect(22 * S + 15, 23 * S + 14, 34, 4, hex("#e3be8a"));
  // Iconic Stardew Valley Shipping Bin (real chests.png!) + Farmhouse Mailbox flanking the stone porch!
  c.blit(SHEETS.chests, 0, 0, 32, 32, 20 * S - 6, 25 * S - 4, { dw: 36, dh: 34, grade: GRADE.stardewWood });
  // Little Stardew wooden mailbox at x=25, y=25
  c.box(25 * S + 10, 25 * S + 10, 6, 18, hex("#7d4824"), INK, 1);
  c.box(25 * S + 5, 25 * S + 2, 16, 12, hex("#c8a878"), INK, 2);
  c.rect(25 * S + 17, 25 * S + 4, 3, 6, hex("#d9443e")); // red mail flag!

  // STEP G: Paint EVERY Interior Prop in OFFICE_PLAN!
  // 1) FOUNDER / CEO EXECUTIVE SUITE (x=2..9, y=17..23) — Airy, Uncluttered & Pixel-Centered on CEO Desk (ceoCx = 228)!
  const ceoCx = 6 * S + 36; // Exact visual center X of deskCeo (x=6, width 72px -> 192..264, center = 228)!
  // A) Deep Midnight-Navy & Champagne-Gold Executive Carpet DEAD-CENTERED under CEO Desk & VIP Guest Chairs!
  const erW = 148, erH = 146;
  const erX = ceoCx - Math.floor(erW / 2), erY = 18 * S + 10; // 154..302 x 586..732
  c.rect(erX + 2, erY + 3, erW, erH, SHADOW);
  c.box(erX, erY, erW, erH, hex("#1f2d3d"), hex("#121a24"), 2);
  c.box(erX + 5, erY + 5, erW - 10, erH - 10, hex("#27384c"), hex("#d4af62"), 2);
  c.box(erX + 11, erY + 11, erW - 22, erH - 22, hex("#2d4057"), hex("#475f7a"), 1);
  for (let ry = erY + 18; ry < erY + erH - 18; ry += 16) {
    for (let rx = erX + 18; rx < erX + erW - 18; rx += 20) {
      c.rect(rx, ry, 2, 2, hex("#4c6785", 130));
    }
  }

  // B) Commanding North Backdrop Wall (NO cramped NW bookcase!) — Credenza & Triptych DEAD-CENTERED on ceoCx!
  const crW = 132, crH = 22;
  const crX = ceoCx - Math.floor(crW / 2), crY = 17 * S + 2; // 162..294 — aligned straight behind Founder!
  c.rect(crX + 2, crY + 4, crW, crH, SHADOW);
  c.box(crX, crY, crW, crH, hex("#4f311e"), INK, 2);
  c.rect(crX + 2, crY + 2, crW - 4, 6, hex("#754b30"));
  for (let i = 0; i < 4; i++) {
    const dx = crX + 6 + i * 31;
    c.box(dx, crY + 10, 27, 9, hex("#3e2516"), hex("#26160d"), 1);
    c.rect(dx + 9, crY + 13, 9, 2, hex("#e5bc62")); // brushed brass pulls
  }
  // Golden Founder Award Trophy, strategy books & classic emerald banker's lamp on credenza!
  c.rect(crX + 12, crY - 7, 8, 7, hex("#f0c44d"));
  c.rect(crX + 14, crY - 1, 4, 3, hex("#b38424"));
  c.box(crX + 26, crY - 4, 16, 6, hex("#2c5e63"), INK, 1);
  c.box(crX + crW - 26, crY - 6, 14, 8, hex("#3d825a"), INK, 1); // emerald banker's lamp
  c.rect(crX + crW - 22, crY + 2, 6, 2, hex("#f7de8a"));

  // Executive 3-Panel Gold-Framed Modern Art Triptych DEAD-CENTERED on ceoCx (y=16)!
  for (const [offset, bg, fg] of [
    [-50, "#243647", "#d9a95b"],
    [-14, "#1f2e3d", "#6aa899"],
    [22, "#243647", "#d97a54"],
  ]) {
    const ax = ceoCx + offset;
    c.box(ax, 16 * S + 6, 28, 18, hex(bg), hex("#d4af62"), 2);
    c.rect(ax + 5, 16 * S + 11, 18, 4, hex(fg));
    c.circle(ax + 14, 16 * S + 17, 3, hex("#f5e8c8"));
  }

  // C) Two Sleek Cognac-Leather VIP Guest Chairs SYMMETRICALLY aligned with the CEO Desk on ceoCx!
  for (const gx of [ceoCx - 38, ceoCx + 10]) {
    const gy = 21 * S + 14;
    c.rect(gx + 2, gy + 5, 28, 22, SHADOW);
    c.borderedRoundRect(gx, gy, 28, 22, 5, hex("#9c562c"), INK, 2);
    c.rect(gx + 4, gy + 3, 20, 9, hex("#bd7140"));
    c.box(gx, gy + 15, 28, 7, hex("#783e1c"), INK, 2);
    c.rect(gx + 3, gy + 17, 22, 2, hex("#d4935c"));
  }

  // D) Tall Executive Potted Fiddle-Leaf Fig in Matte-Black & Brass Planter (SE corner x=9, y=23)
  c.circle(9 * S + 16, 23 * S + 18, 10, hex("#262b33"));
  c.ring(9 * S + 16, 23 * S + 18, 10, 8, hex("#d4af62"));
  c.circle(9 * S + 11, 23 * S + 10, 7, hex("#2f6e3a"));
  c.circle(9 * S + 21, 23 * S + 11, 7, hex("#438f4c"));
  c.circle(9 * S + 16, 23 * S + 6, 6, hex("#62b360"));

  // 2) Workstation desk pods (4 uniform 3x2 pods) sit directly on clean warm timber floorboards (no under-desk area rugs)

  // 3) Dedicated Executive Boardroom Carpet & North Presentation Wall (x=39..45, y=3..12)!
  const brX = 39 * S + 22, brY = 4 * S + 18, brW = 5 * S + 20, brH = 7 * S - 6;
  c.rect(brX + 2, brY + 3, brW, brH, SHADOW_SOFT);
  c.box(brX, brY, brW, brH, hex("#d4ddd5"), hex("#5e7865"), 2);
  c.box(brX + 6, brY + 6, brW - 12, brH - 12, hex("#e7eee8"), hex("#9cb2a0"), 2);
  // 75" Wall-Mounted Conference Presentation Screen & Floating Walnut AV Credenza on North Boardroom Wall (x=40.6..44.4, y=2..3)!
  const scrX = 40 * S + 24, scrW = 3 * S + 16;
  // Floating walnut AV credenza flush against North Wall (y=3)
  c.rect(scrX + 2, 3 * S + 5, scrW, 20, SHADOW_SOFT);
  c.box(scrX, 3 * S + 1, scrW, 20, hex("#6b442a"), INK, 2);
  c.rect(scrX + 3, 3 * S + 3, scrW - 6, 4, hex("#96633f"));
  c.box(scrX + Math.floor(scrW / 2) - 18, 3 * S + 9, 36, 6, hex("#232830"), INK, 1); // conference video-bar / speaker!
  c.rect(scrX + Math.floor(scrW / 2) - 2, 3 * S + 11, 4, 2, hex("#5be882"));
  // Huge Wall-Mounted 75" Presentation Display cleanly centered inside North Wall plaster (y=2, between windows x=40 & x=44!)
  c.box(scrX + 8, 2 * S + 10, scrW - 16, 22, hex("#1d232b"), INK, 2);
  c.rect(scrX + 11, 2 * S + 13, scrW - 22, 16, hex("#f4f8fc")); // bright crisp presentation slide
  // Live sprint bar chart & roadmap diagram on boardroom display!
  c.rect(scrX + 15, 2 * S + 16, 26, 3, hex("#32475c"));
  c.rect(scrX + 15, 2 * S + 22, 10, 5, hex("#58a86b"));
  c.rect(scrX + 27, 2 * S + 20, 10, 7, hex("#4a90d9"));
  c.rect(scrX + 39, 2 * S + 18, 10, 9, hex("#e89a48"));
  c.circle(scrX + scrW - 24, 2 * S + 21, 5, hex("#68a88b")); // KPI pie chart
  c.rect(scrX + scrW - 24, 2 * S + 16, 5, 5, hex("#e8c058"));
  // South Boardroom Refreshment Sideboard flush against South divider wall (y=12, x=40..43)
  const sbX = 40 * S + 10, sbY = 12 * S + 6, sbW = 4 * S - 20, sbH = 22;
  c.rect(sbX + 2, sbY + 4, sbW, sbH, SHADOW_SOFT);
  c.box(sbX, sbY, sbW, sbH, hex("#7a4d2e"), INK, 2);
  c.rect(sbX + 3, sbY + 2, sbW - 6, 5, hex("#a87046"));
  c.circle(sbX + 20, sbY + 11, 5, hex("#dcebf0")); // glass water pitcher
  c.circle(sbX + 20, sbY + 11, 3, hex("#8bc4e8"));
  for (const gx of [34, 44, 54]) c.circle(sbX + gx, sbY + 12, 3, hex("#f5f9fc")); // water glasses
  c.box(sbX + sbW - 34, sbY + 6, 22, 10, hex("#f5efe2"), hex("#6b4c32"), 1); // agenda handouts & markers!

  for (const p of PLAN.props) {
    const px = p.x * S, py = p.y * S, pw = p.w * S, ph = p.h * S;

    if (p.k === "kitchen") {
      // IMAGE 1: Architect-Grade Modern Cozy Studio Kitchen (x=2..9, y=3..10 -> 64..320 x 96..320)
      // Anchored 100% FLUSH against North Wall (y=3) & West/East Walls — ZERO floating gap behind fridge or counters!
      const kx = 2 * S, ky = 3 * S; // room NW corner = (64, 96)

      // A) Wall-Mounted Range Hood & Floating Oak Pantry Shelves cleanly INSIDE North Wall plaster band (y=2, Y=74..94)!
      // Matte-black & stainless chimney range hood right above induction cooktop
      c.box(kx + 58, 2 * S + 12, 48, 19, hex("#363d46"), INK, 2);
      c.rect(kx + 62, 2 * S + 15, 40, 4, hex("#697380"));
      c.rect(kx + 64, 2 * S + 27, 36, 2, hex("#ffebb8")); // warm under-hood LED bar!
      // Floating light-oak wall shelf above sink & counter with ceramic mugs, canisters & trailing herb!
      c.box(kx + 124, 2 * S + 22, 118, 6, hex("#c29362"), INK, 1);
      for (const [mx, col] of [[130, "#f5efe4"], [142, "#6a9d76"], [154, "#e59a5c"], [168, "#527c96"], [182, "#f5efe4"], [198, "#d47e52"], [210, "#f5efe4"]]) {
        c.box(kx + mx, 2 * S + 13, 8, 9, hex(col), INK, 1);
      }
      c.circle(kx + 230, 2 * S + 15, 6, hex("#52a44c")); // cute trailing kitchen pothos!
      c.rect(kx + 226, 2 * S + 19, 8, 4, hex("#c96d46"));

      // B) Sleek Brushed-Stainless Side-by-Side Refrigerator flush in NW corner (X=65..111, Y=96..158)
      c.rect(kx + 4, ky + 6, 46, 62, SHADOW);
      c.borderedRoundRect(kx + 1, ky, 46, 64, 4, hex("#d7dde2"), INK, 2);
      c.rect(kx + 5, ky + 3, 38, 10, hex("#eef2f5")); // crisp top crown
      c.rect(kx + 23, ky + 14, 2, 36, hex("#8d969f")); // side-by-side seam
      c.rect(kx + 3, ky + 50, 42, 2, hex("#8d969f")); // freezer drawer seam
      c.rect(kx + 18, ky + 20, 3, 20, hex("#5d6670")); // left brushed steel handle
      c.rect(kx + 27, ky + 20, 3, 20, hex("#5d6670")); // right brushed steel handle
      c.box(kx + 8, ky + 22, 8, 13, hex("#363e47"), hex("#8c96a0"), 1); // chilled water/ice dispenser
      c.rect(kx + 10, ky + 24, 4, 3, hex("#75d4f5")); // crisp LED readout
      // Compact matte-black recycling/compost bin tucked cleanly against West Wall just south of fridge!
      c.rect(kx + 4, ky + 72, 18, 22, SHADOW_SOFT);
      c.borderedRoundRect(kx + 2, ky + 70, 18, 22, 3, hex("#353c45"), INK, 1);
      c.rect(kx + 5, ky + 74, 12, 4, hex("#56606d"));

      // C) Seamless Modern Nordic L-Shaped Oak & White-Quartz Kitchenette flush against North (y=3) & East (x=9) Walls!
      // North run (X=114..318, Y=96..138 -> flush to East Wall!)
      const cx0 = kx + 50, cw = 256 - 52; // width 204px -> right edge = 318px!
      c.rect(cx0 + 2, ky + 8, cw, 44, SHADOW);
      c.box(cx0, ky + 2, cw, 44, hex("#b88a5a"), INK, 2); // oak base cabinetry
      for (let bx = cx0 + 6; bx < cx0 + cw - 34; bx += 28) {
        c.box(bx, ky + 26, 24, 17, hex("#a37548"), hex("#78522d"), 1);
        c.rect(bx + 8, ky + 30, 8, 2, hex("#343940")); // matte-black pull
      }
      // East L-Return Breakfast & Pantry Counter along East Wall (X=284..318, Y=136..196 -> clear of doorway y=8..9!)
      const retX = kx + 256 - 36, retY = ky + 42, retW = 34, retH = 56;
      c.rect(retX - 3, retY + 4, retW + 3, retH, SHADOW);
      c.box(retX, retY, retW, retH, hex("#b88a5a"), INK, 2);
      c.box(retX + 2, retY + 2, retW - 4, retH - 12, hex("#f6f3ed"), hex("#a8a296"), 1); // quartz return top
      c.rect(retX + 4, retY + retH - 8, retW - 8, 6, hex("#a37548"));
      c.rect(retX + 12, retY + retH - 6, 10, 2, hex("#343940"));

      // Continuous crisp white quartz countertop slab across North run + seamless L-corner turn!
      c.box(cx0, ky, cw, 25, hex("#f6f3ed"), INK, 2);
      c.rect(cx0 + 2, ky + 2, cw - 4, 4, hex("#ffffff"));
      c.rect(retX + 2, ky + 22, retW - 4, 24, hex("#f6f3ed")); // seamless white quartz L-corner!
      c.rect(retX, ky + 25, 2, 20, INK); // crisp inner L-corner edge

      // 1. 4-Burner Black Glass Induction Cooktop (cx0+8..cx0+56)
      c.box(cx0 + 8, ky + 4, 46, 17, hex("#23272e"), hex("#545b66"), 1);
      c.ring(cx0 + 20, ky + 12, 5.5, 3.5, hex("#e85d44")); // active glowing induction burner!
      c.ring(cx0 + 38, ky + 12, 4.5, 3, hex("#4c535e"));
      c.circle(cx0 + 20, ky + 12, 3.5, hex("#d4935a")); // warm copper sauté pan / kettle!

      // 2. Walnut Prep Cutting Board + Undermount Brushed-Stainless Sink & Gooseneck Faucet (cx0+62..cx0+120)
      c.box(cx0 + 60, ky + 6, 14, 13, hex("#b87c4b"), hex("#6e4624"), 1); // walnut cutting board
      c.box(cx0 + 78, ky + 4, 36, 17, hex("#adb6bf"), hex("#5c6570"), 2); // stainless sink
      c.rect(cx0 + 82, ky + 7, 28, 11, hex("#c7d0d9"));
      c.circle(cx0 + 96, ky + 12, 2, hex("#4c545e"));
      c.rect(cx0 + 94, ky + 1, 4, 7, hex("#3b414a")); // matte-black faucet
      c.box(cx0 + 116, ky + 5, 5, 7, hex("#7ab38e"), INK, 1); // soap pump

      // 3. Built-In Toaster Oven / Microwave + Pantry Espresso Setup on NE & East Return (cx0+128..retX+28)
      c.box(cx0 + 128, ky + 4, 28, 17, hex("#2d323a"), INK, 1); // sleek matte-black microwave/oven
      c.rect(cx0 + 131, ky + 7, 17, 10, hex("#5d6875"));
      c.rect(cx0 + 150, ky + 8, 3, 8, hex("#b5bec7"));
      // Compact Pantry Drip Coffee Maker + Mug Tray + Fruit Bowl along East L-Return!
      c.box(retX + 6, retY + 4, 22, 18, hex("#30363f"), INK, 1); // pantry drip brewer
      c.rect(retX + 9, retY + 7, 16, 6, hex("#b8c2cc"));
      c.circle(retX + 17, retY + 17, 4, hex("#5a351d")); // fresh brewed pot
      c.circle(retX + 17, retY + 32, 8, hex("#f7f4ec")); // ceramic fruit bowl!
      c.circle(retX + 14, retY + 31, 3, hex("#e86a48")); // apple
      c.circle(retX + 20, retY + 31, 3, hex("#f2c249")); // lemon
      c.circle(retX + 17, retY + 35, 3, hex("#74b856")); // pear

      // D) Warm Terracotta Olive/Herb Planter in Kitchen South-West Corner (x=2, y=10)
      c.circle(kx + 18, 10 * S + 16, 10, hex("#c26a43"));
      c.ring(kx + 18, 10 * S + 16, 10, 8, hex("#7d3d22"));
      c.circle(kx + 14, 10 * S + 11, 6, hex("#478f4a"));
      c.circle(kx + 22, 10 * S + 12, 6, hex("#5ca856"));
      c.circle(kx + 18, 10 * S + 7, 5, hex("#78c26b"));
    } else if (p.k === "dining") {
      // Modern Light-Oak Studio Cafe Dining Table & 4 Sculpted Sage Chairs (centered cleanly in Kitchen south half!)
      const dx = px - 8, dy = py - 8, dw = pw - 4, dh = ph - 4;
      c.rect(dx + 6, dy + 12, dw - 12, dh - 8, SHADOW);
      // 4 Modern Scandinavian Dining Chairs (2 north, 2 south)
      for (const ox of [22, dw - 46]) {
        // North chair (facing south)
        c.borderedRoundRect(dx + ox, dy - 10, 24, 18, 4, hex("#689472"), INK, 2);
        c.rect(dx + ox + 4, dy - 8, 16, 4, hex("#89b592"));
        // South chair (facing north)
        c.borderedRoundRect(dx + ox, dy + dh - 10, 24, 18, 4, hex("#689472"), INK, 2);
        c.rect(dx + ox + 3, dy + dh + 2, 18, 4, hex("#496e52"));
      }
      // Sleek light-oak rounded tabletop
      c.borderedRoundRect(dx + 6, dy + 4, dw - 12, dh - 12, 6, hex("#d6a974"), INK, 2);
      c.rect(dx + 10, dy + 7, dw - 20, 4, hex("#e8c392"));
      // Minimalist linen runner + pour-over coffee carafe + pastry plate + bud vase
      c.rect(dx + Math.floor(dw / 2) - 14, dy + 6, 28, dh - 16, hex("#f4efe4"));
      c.circle(dx + Math.floor(dw / 2), dy + 22, 6, hex("#5a3924")); // glass coffee carafe
      c.circle(dx + Math.floor(dw / 2), dy + 22, 3, hex("#966341"));
      c.circle(dx + Math.floor(dw / 2) - 24, dy + 24, 6, hex("#fbf8f2")); // ceramic plate
      c.circle(dx + Math.floor(dw / 2) - 24, dy + 24, 3, hex("#d99a54")); // croissant!
      c.circle(dx + Math.floor(dw / 2) + 22, dy + 22, 4, hex("#7ab86b")); // tiny bud vase
      c.rect(dx + Math.floor(dw / 2) + 21, dy + 17, 3, 3, hex("#ffe066"));
    } else if (p.k === "bath") {
      // MODERN ARCHITECT-GRADE BOUTIQUE STUDIO RESTROOM (interior x=2..9, y=12..15 -> 64..320 x 384..512)
      // Every fixture is flush against a real plumbing wall, with the single north entrance (x=8..9, y=11 -> 256..320) 100% unobstructed!
      const rx = 2 * S, ry = 12 * S; // room NW corner = (64, 384)

      // Subtle warm oak threshold strip across the single north bathroom doorway (x=8..9, y=12 top)
      c.rect(8 * S + 2, ry - 2, 2 * S - 4, 4, hex("#b38452"));
      c.rect(8 * S + 2, ry + 2, 2 * S - 4, 2, hex("#805932"));

      // 1) WET ZONE — Corner Walk-In Glass Rain Shower flush against West (x=2), North (y=12), & South (y=15) walls!
      const shX = rx, shY = ry, shW = 68, shH = 4 * S - 2; // 64..132 x 384..510
      // Recessed cool-slate wet-zone shower tray
      c.box(shX, shY, shW, shH, hex("#d4e1de"), hex("#5a6a70"), 2);
      c.rect(shX + 2, shY + 2, shW - 4, 5, hex("#becfd0")); // north curb shadow
      // Recessed matte-slate shampoo & bodywash wall niche on West Wall
      c.box(shX + 2, shY + 46, 6, 30, hex("#4b5860"), hex("#2e373d"), 1);
      c.rect(shX + 4, shY + 50, 3, 7, hex("#e8d5b7")); // shampoo bottle
      c.rect(shX + 4, shY + 60, 3, 6, hex("#6ea68c")); // eucalyptus wash
      c.rect(shX + 4, shY + 68, 3, 5, hex("#f5f5f2")); // conditioner
      // Warm slatted teak shower duckboard centered in wet zone
      for (let sy = shY + 24; sy <= shY + shH - 22; sy += 9) {
        c.rect(shX + 12, sy, shW - 22, 6, hex("#c29362"));
        c.rect(shX + 12, sy, shW - 22, 1, hex("#deb686"));
        c.rect(shX + 12, sy + 5, shW - 22, 1, hex("#94693d"));
      }
      // Sleek brushed-stainless linear trench drain near south edge
      c.box(shX + 12, shY + shH - 12, shW - 22, 6, hex("#8d99a2"), hex("#4d565e"), 1);
      c.rect(shX + 15, shY + shH - 10, shW - 28, 2, hex("#c5cfd6"));
      // Wall-mounted chrome rainfall showerhead + mixer on North plumbing wall (flush to y=12!)
      c.rect(shX + 31, shY + 1, 6, 8, hex("#475159")); // shower arm extending from north wall
      c.rect(shX + 19, shY + 2, 10, 4, hex("#2d3338")); // matte-black thermostatic mixer bar
      c.circle(shX + 34, shY + 13, 7, hex("#e7eef2")); // overhead rainfall disc
      c.ring(shX + 34, shY + 13, 7, 5, hex("#59656e"));
      c.rect(shX + 32, shY + 11, 4, 4, hex("#c8d6de"));
      // Frameless tinted glass partition (right edge, top 68% solid glass + open bottom walk-in entry!)
      const glassH = 84;
      c.rect(shX + shW - 2, shY, 5, glassH, hex("#7cb8c9", 195));
      c.rect(shX + shW - 2, shY, 1, glassH, hex("#d2f0f7", 220));
      c.rect(shX + shW + 2, shY, 1, glassH, hex("#3d616e", 210));
      c.rect(shX + shW - 3, shY + 16, 7, 4, hex("#2f363d")); // matte-black glass clamp
      c.rect(shX + shW - 3, shY + glassH - 16, 7, 4, hex("#2f363d"));
      // Plush sage-green shower step-out mat directly outside the open walk-in shower entrance!
      c.borderedRoundRect(shX + shW + 7, shY + glassH + 6, 26, 32, 4, hex("#7ca38b"), hex("#4c6e59"), 2);
      c.rect(shX + shW + 12, shY + glassH + 11, 16, 22, hex("#95bba3"));

      // 2) TOILET ZONE — Modern Wall-Backed Flush WC flush against North Plumbing Wall (y=12)!
      const wcX = rx + 82, wcY = ry + 1; // cistern strictly flush against north wall (y=385)!
      c.rect(wcX + 2, wcY + 5, 30, 45, SHADOW_SOFT);
      // Clean porcelain cistern tank flush to North Wall
      c.borderedRoundRect(wcX + 2, wcY, 28, 12, 3, hex("#f7f9fa"), INK, 2);
      c.rect(wcX + 11, wcY + 4, 10, 4, hex("#343b42")); // matte-black dual-flush plate
      c.rect(wcX + 15, wcY + 4, 2, 4, hex("#747f8a"));
      // Contoured one-piece ceramic oval bowl & soft-close seat
      c.ellipse(wcX + 16, wcY + 28, 12, 16, INK);
      c.ellipse(wcX + 16, wcY + 28, 10, 14, hex("#ffffff"));
      c.ellipse(wcX + 16, wcY + 29, 7, 9.5, hex("#dce5e8"));
      c.ellipse(wcX + 16, wcY + 29, 5, 7, hex("#bfe0eb"));
      // Matte-black toilet roll holder & slim covered waste bin beside WC against modesty divider
      c.box(wcX + 33, wcY + 14, 7, 10, hex("#fafaf7"), INK, 1); // tissue roll
      c.circle(wcX + 36, wcY + 5, 4, hex("#3c434a")); // compact matte-black pedal bin
      c.circle(wcX + 36, wcY + 5, 2.5, hex("#59626b"));
      // Sleek Walnut & Frosted-Glass Modesty Half-Partition separating WC from Vanity!
      const divX = rx + 125;
      c.rect(divX + 2, ry + 2, 4, 48, SHADOW_SOFT);
      c.box(divX, ry, 5, 48, hex("#9c6b43"), hex("#3a2415"), 1);
      c.rect(divX + 1, ry + 4, 3, 40, hex("#cde3ea", 200));

      // 3) VANITY ZONE — Floating Oak Vanity + Wall-Mounted Backlit Mirror on Solid North Wall (x=6..7.8, y=12)
      // Strictly LEFT of x=8 (256px) so the single doorway (x=8..9, y=11) stays 100% wide open!
      const vx = rx + 134, vy = ry + 1, vw = 54, vh = 27; // x = 198..252 (4px clear left of doorway!)
      c.rect(vx + 2, vy + 5, vw, vh, SHADOW);
      // Backlit LED Vanity Mirror mounted cleanly INSIDE the North Wall plaster face (y=366..381, zero clipping!)
      c.rect(vx + 4, 11 * S + 13, vw - 8, 17, hex("#fff4cc", 170)); // soft warm LED halo
      c.box(vx + 6, 11 * S + 15, vw - 12, 13, hex("#cfe8f0"), hex("#2e363e"), 1);
      c.rect(vx + 8, 11 * S + 17, vw - 16, 3, hex("#eef9fc")); // mirror glass reflection
      // Floating warm-oak vanity cabinet + crisp white marble countertop
      c.box(vx, vy, vw, vh, hex("#c29463"), INK, 2);
      c.box(vx + 2, vy + 2, vw - 4, vh - 7, hex("#f7f6f1"), hex("#a8a49c"), 1);
      // Centered ceramic vessel basin + matte-black minimalist faucet + soap & folded towel
      const sinkX = vx + 22;
      c.circle(sinkX, vy + 12, 8.5, hex("#4b525a"));
      c.circle(sinkX, vy + 12, 6.5, hex("#ffffff"));
      c.circle(sinkX, vy + 12, 4, hex("#d6e4e8"));
      c.rect(sinkX - 2, vy + 2, 4, 6, hex("#2b3036")); // matte-black faucet
      c.box(vx + 36, vy + 5, 5, 7, hex("#5e9478"), INK, 1); // botanical hand soap pump
      c.box(vx + 43, vy + 6, 8, 12, hex("#ffffff"), hex("#9ca4ac"), 1); // folded hand towel
      c.rect(vx + 45, vy + 10, 4, 2, hex("#dce2e6"));
      // Soft woven vanity runner mat centered directly in front of sink (clear of doorway!)
      c.borderedRoundRect(vx + 4, vy + 33, vw - 8, 16, 4, hex("#80a68e"), hex("#4d6e59"), 2);
      c.rect(vx + 9, vy + 37, vw - 18, 8, hex("#9bc0a8"));

      // 4) EAST-WALL TOWEL RAIL & SOUTH-EAST SPA CORNER (strictly south of entry foyer y=12..13.5!)
      // Wall-mounted matte-black heated towel bar flush against East Wall (x=9 right edge)
      const trX = 10 * S - 15, trY = 13 * S + 24;
      c.rect(trX + 1, trY + 2, 13, 34, SHADOW_SOFT);
      c.box(trX + 9, trY, 4, 34, hex("#2d333a"), INK, 1); // vertical wall bracket
      c.box(trX, trY + 4, 11, 11, hex("#f4f1ea"), hex("#8c887e"), 1); // folded warm cream towel
      c.rect(trX + 2, trY + 7, 7, 2, hex("#dfd9cc"));
      c.box(trX, trY + 19, 11, 11, hex("#83a890"), hex("#4b6b57"), 1); // folded sage spa towel
      c.rect(trX + 2, trY + 22, 7, 2, hex("#a1c4ad"));

      // Chic South-East Corner: woven seagrass towel basket + stoneware snake plant!
      c.circle(8 * S + 26, 15 * S + 18, 9, hex("#c9a370")); // woven seagrass laundry/towel basket
      c.ring(8 * S + 26, 15 * S + 18, 9, 7, hex("#7d5b34"));
      c.circle(8 * S + 26, 15 * S + 18, 5, hex("#f4efe4")); // rolled cream spa towel inside
      c.circle(9 * S + 18, 15 * S + 18, 8.5, hex("#f2efe9")); // stoneware pot
      c.ring(9 * S + 18, 15 * S + 18, 8.5, 6.5, hex("#68635a"));
      c.rect(9 * S + 14, 15 * S + 5, 3, 13, hex("#448f4c"));
      c.rect(9 * S + 18, 15 * S + 3, 3, 15, hex("#5cb062"));
      c.rect(9 * S + 22, 15 * S + 7, 3, 11, hex("#3c7d44"));
    } else if (p.k === "bed") {
      // FOUNDER / CEO AIRY WEST VIP LOUNGE CORNER (x=2..3.8, y=17.5..22.5 — clean, spacious, zero bookcase clutter!)
      // 1) Warm Sculptural Brass Executive Floor Lamp in the open NW corner (x=2.5, y=17.6)
      c.circle(px + 22, 17 * S + 22, 10, SHADOW_SOFT);
      c.circle(px + 20, 17 * S + 20, 9, hex("#262b33")); // matte-black base
      c.circle(px + 20, 17 * S + 20, 7, hex("#d4aa52")); // warm brass lamp dome
      c.circle(px + 20, 17 * S + 20, 3.5, hex("#fff4c4"));

      // 2) Refined 2-Seater Cognac-Leather Executive Sofa flush cleanly against West Wall (centered vertically on Navy Rug!)
      const sx = px + 4, sy = py + 10, sw = 34, sh = 92; // 68..102 x 618..710
      c.rect(sx + 3, sy + 5, sw, sh, SHADOW);
      c.borderedRoundRect(sx, sy, sw, sh, 5, hex("#9c562c"), INK, 2);
      c.box(sx, sy, 11, sh, hex("#783e1c"), INK, 2); // tufted backrest along West wall
      c.box(sx, sy, sw - 2, 10, hex("#824420"), INK, 2); // top armrest
      c.box(sx, sy + sh - 10, sw - 2, 10, hex("#824420"), INK, 2); // bottom armrest
      for (let ci = 0; ci < 2; ci++) {
        const cy = sy + 11 + ci * 36;
        c.box(sx + 11, cy, sw - 13, 34, hex("#ab6235"), hex("#633115"), 1);
        c.rect(sx + 14, cy + 4, sw - 19, 7, hex("#c97d49"));
        c.rect(sx + 5, cy + 16, 2, 2, hex("#d9b15f")); // Chesterfield brass tuft
      }

      // 3) Slim Smoked-Glass & Walnut Coffee Table cleanly spaced between Sofa & Navy Rug (22px clear aisle!)
      const tx = px + 46, ty = py + 28, tw = 20, th = 56; // 110..130 (24px clear left of Navy Rug at 154!)
      c.rect(tx + 2, ty + 4, tw, th, SHADOW_SOFT);
      c.borderedRoundRect(tx, ty, tw, th, 4, hex("#4f311e"), INK, 2);
      c.rect(tx + 3, ty + 3, tw - 6, th - 6, hex("#303e4d"));
      c.line(tx + 5, ty + 8, tx + 14, ty + 18, 2, hex("#8cb4d6", 80));
      c.box(tx + 5, ty + 20, 10, 14, hex("#f7f2e8"), hex("#5e4a38"), 1); // investor pitch deck
      c.circle(tx + 10, ty + 43, 3.5, hex("#ffffff")); // espresso cup
      c.circle(tx + 10, ty + 43, 1.8, hex("#4a2915"));
    } else if (p.k === "lounge") {
      // IMAGE 5: Harmonious Cozy Studio Breakout Lounge (x=11..20, y=18..23 -> 352..672 x 576..768)
      // Every seating piece sits cleanly INSIDE the woven terracotta lounge rug, hearth flush on West wall, zero overhang!
      // 1) Refined Woven Terracotta & Warm-Cream Studio Lounge Rug anchoring the conversation circle
      paintStardewCarpet(c, px + 60, py + 24, 232, 152);
      // 2) Brick Hearth Fireplace flush against West Wall (x=11, y=19.2..21.8 — zero overlap with rug!)
      paintStardewHearth(c, px + 4, py + 38, 46, 82);
      // Stacked birch firewood basket tucked neatly below hearth + SW corner lush Monstera & brass floor lamp
      c.borderedRoundRect(px + 10, py + 126, 32, 18, 4, hex("#8f5d34"), INK, 1);
      for (const lx of [15, 22, 29, 35]) {
        c.circle(px + lx, py + 135, 3.5, hex("#d4b48c"));
        c.circle(px + lx, py + 135, 1.5, hex("#8c6239"));
      }
      // Warm brass floor lamp tucked cleanly beside the SW corner plant (x=11, y=23 prop)
      c.circle(px + 42, py + 170, 6, hex("#d4aa52")); // warm brass floor lamp shade
      c.circle(px + 42, py + 170, 3.5, hex("#fff1bd"));

      // 3) North Media Console & Smart TV centered over conversation pit (facing SOUTH toward sofa!)
      const tvX = px + 114, tvY = py + 12, tvW = 118, tvH = 24;
      c.rect(tvX + 4, tvY + 14, tvW, 20, SHADOW);
      // Sleek mid-century walnut media console
      c.borderedRoundRect(tvX, tvY + 10, tvW, 22, 3, hex("#6e4428"), INK, 2);
      c.rect(tvX + 4, tvY + 12, tvW - 8, 5, hex("#96613c"));
      c.box(tvX + 6, tvY + 20, 30, 8, hex("#54331d"), hex("#382011"), 1);
      c.box(tvX + tvW - 36, tvY + 20, 30, 8, hex("#54331d"), hex("#382011"), 1);
      c.box(tvX + 42, tvY + 19, 34, 6, hex("#252a32"), INK, 1); // matte-black soundbar
      c.rect(tvX + 57, tvY + 21, 4, 2, hex("#68e38a"));
      // Wide Flat-Screen Smart TV facing SOUTH into lounge
      c.borderedRoundRect(tvX + 12, tvY - 12, tvW - 24, 25, 3, hex("#1c222b"), INK, 2);
      c.rect(tvX + 16, tvY - 8, tvW - 32, 17, hex("#4aa4d8"));
      c.rect(tvX + 16, tvY + 2, tvW - 32, 7, hex("#54ad4e"));
      c.circle(tvX + 30, tvY - 3, 3, hex("#ffe675"));
      c.rect(tvX + 58, tvY - 3, 14, 8, hex("#c9543e"));
      c.rect(tvX + 61, tvY - 1, 4, 3, hex("#ffe99c"));
      c.line(tvX + 20, tvY - 7, tvX + 30, tvY + 7, 2, hex("#ffffff", 90));
      c.rect(tvX + Math.floor(tvW / 2) - 5, tvY + 11, 10, 5, hex("#2e343d"));
      // Flanking accent plant (left of TV) & mini walnut vinyl/magazine side table (right of TV)
      c.circle(tvX - 20, tvY + 22, 8, hex("#d98055")); // terracotta pot
      c.circle(tvX - 20, tvY + 17, 6, hex("#54a852"));
      c.circle(tvX - 24, tvY + 21, 4, hex("#3e873e"));
      c.borderedRoundRect(tvX + tvW + 10, tvY + 12, 22, 20, 3, hex("#8f5932"), INK, 1); // vinyl/book side stand
      c.rect(tvX + tvW + 14, tvY + 15, 14, 10, hex("#f4efe4"));
      c.rect(tvX + tvW + 16, tvY + 17, 10, 2, hex("#c95b42"));

      // 4) Balanced Conversation Grouping — ALL tucked cleanly INSIDE the lounge rug!
      // Natural Oak Rounded Coffee Table centered between TV, South Sofa, West Pouf & East Loveseat
      const ctX = px + 122, ctY = py + 72, ctW = 102, ctH = 36;
      c.rect(ctX + 2, ctY + 6, ctW, ctH, SHADOW);
      c.borderedRoundRect(ctX, ctY, ctW, ctH, 6, hex("#96613a"), INK, 2);
      c.rect(ctX + 4, ctY + 3, ctW - 8, 4, hex("#bd8152"));
      // Coffee mugs on coasters, open studio art book & game controller
      c.circle(ctX + 18, ctY + 18, 5, hex("#f7f2e8"));
      c.circle(ctX + 18, ctY + 18, 3, hex("#5c351c"));
      c.box(ctX + 34, ctY + 10, 22, 16, hex("#faf4e6"), hex("#6b4c32"), 1); // open studio art book
      c.rect(ctX + 44, ctY + 11, 2, 14, hex("#c9bca6"));
      c.rect(ctX + 37, ctY + 14, 5, 6, hex("#68a383"));
      c.borderedRoundRect(ctX + 64, ctY + 12, 20, 12, 3, hex("#2c323b"), INK, 1); // game controller
      c.rect(ctX + 68, ctY + 16, 3, 3, hex("#68d67a"));
      c.rect(ctX + 76, ctY + 16, 3, 3, hex("#ff7070"));
      c.circle(ctX + 91, ctY + 18, 4.5, hex("#f7f2e8")); // second mug
      c.circle(ctX + 91, ctY + 18, 2.5, hex("#6b3f22"));

      // Cozy Woven Round Pouf / Ottoman near Fireplace on West side of rug (balances East loveseat!)
      c.circle(px + 86, py + 92, 13, SHADOW_SOFT);
      c.circle(px + 84, py + 90, 12, hex("#d4a46a"));
      c.ring(px + 84, py + 90, 12, 10, INK);
      c.circle(px + 84, py + 90, 7, hex("#e8c390"));

      // Plush 3-Seater Sage Sofa at SOUTH side facing NORTH toward TV + Cream & Terracotta Throw Pillows!
      paintStardewSofa(c, px + 106, py + 134, 134, 36, "north");
      c.borderedRoundRect(px + 122, py + 140, 14, 12, 3, hex("#f2e7d3"), hex("#8c7352"), 1); // cream throw pillow
      c.borderedRoundRect(px + 210, py + 140, 14, 12, 3, hex("#d46d4c"), hex("#78321d"), 1); // terracotta pillow

      // Matching 2-Seater Sage Loveseat tucked INWARD on East side of rug (strictly inside rug right edge!)
      paintStardewSofa(c, px + 248, py + 52, 38, 72, "west");
      c.borderedRoundRect(px + 258, py + 66, 12, 14, 3, hex("#f2e7d3"), hex("#8c7352"), 1); // cozy accent pillow
    } else if (p.k === "meeting") {
      // DEDICATED EXECUTIVE BOARDROOM CONFERENCE TABLE & 8 ERGONOMIC CHAIRS (x=41..43, y=6..9 -> 96x128px)!
      c.rect(px + 8, py + 8, pw - 12, ph - 10, SHADOW);
      // 6 Side Ergonomic Walnut-and-Sage Chairs (3 West facing East, 3 East facing West)
      for (const oy of [14, 52, 90]) {
        // West chairs (facing East)
        c.rect(px - 10, py + oy + 2, 18, 24, SHADOW_SOFT);
        c.borderedRoundRect(px - 12, py + oy, 18, 24, 5, hex("#5e8767"), INK, 2);
        c.rect(px - 12, py + oy + 3, 6, 18, hex("#6b4428")); // curved walnut backrest
        c.rect(px - 11, py + oy + 4, 2, 16, hex("#9c6b43"));
        // East chairs (facing West)
        c.rect(px + pw - 6, py + oy + 2, 18, 24, SHADOW_SOFT);
        c.borderedRoundRect(px + pw - 6, py + oy, 18, 24, 5, hex("#5e8767"), INK, 2);
        c.rect(px + pw + 6, py + oy + 3, 6, 18, hex("#6b4428"));
        c.rect(px + pw + 7, py + oy + 4, 2, 16, hex("#9c6b43"));
      }
      // 2 Head-of-Table Executive Chairs (North & South heads!)
      const headX = px + Math.floor(pw / 2) - 13;
      c.borderedRoundRect(headX, py - 12, 26, 18, 5, hex("#4b7355"), INK, 2);
      c.rect(headX + 3, py - 12, 20, 6, hex("#59351e"));
      c.borderedRoundRect(headX, py + ph - 6, 26, 18, 5, hex("#4b7355"), INK, 2);
      c.rect(headX + 3, py + ph + 6, 20, 6, hex("#59351e"));

      // Grand Boat-Shaped Warm-Walnut Executive Boardroom Table with vertical grain & center AV spine!
      c.borderedRoundRect(px + 6, py + 4, pw - 12, ph - 8, 12, hex("#a87243"), INK, 2);
      c.rect(px + 14, py + 6, pw - 28, 4, hex("#cca06e"));
      for (let gx = px + 22; gx < px + pw - 18; gx += 16) {
        c.rect(gx, py + 8, 1, ph - 16, hex("#8a582e", 130));
      }
      // Central recessed matte-black power, microphone & HDMI conference hub spine
      const hubX = px + Math.floor(pw / 2) - 6, hubY = py + 34;
      c.box(hubX, hubY, 12, 60, hex("#2b313a"), hex("#14171c"), 1);
      c.rect(hubX + 3, hubY + 8, 6, 8, hex("#65707d"));
      c.circle(hubX + 6, hubY + 30, 4, hex("#4c5663")); // conference speakerphone puck!
      c.circle(hubX + 6, hubY + 30, 1.5, hex("#68e38a")); // green call LED
      c.rect(hubX + 3, hubY + 44, 6, 8, hex("#65707d"));

      // Realistic Boardroom Props: 3 Open Silver Laptops, Strategy Notebook, Center Succulent & Coffee Mugs!
      // West-side laptop (facing East)
      c.box(px + 12, py + 18, 14, 18, hex("#303845"), INK, 1);
      c.rect(px + 14, py + 20, 10, 14, hex("#8bc4f2"));
      c.rect(px + 25, py + 18, 3, 18, hex("#cfd6de"));
      // East-side laptop (facing West)
      c.box(px + pw - 26, py + 54, 14, 18, hex("#303845"), INK, 1);
      c.rect(px + pw - 24, py + 56, 10, 14, hex("#93d1b2"));
      c.rect(px + pw - 28, py + 54, 3, 18, hex("#cfd6de"));
      // South-head executive laptop (facing North toward 75" screen!)
      c.box(px + Math.floor(pw / 2) - 10, py + ph - 24, 20, 13, hex("#303845"), INK, 1);
      c.rect(px + Math.floor(pw / 2) - 8, py + ph - 22, 16, 9, hex("#f7d58b"));
      // Open notebook & pen (west-south)
      c.box(px + 14, py + 84, 14, 16, hex("#faf4e6"), hex("#6b4a2e"), 1);
      c.rect(px + 17, py + 88, 8, 2, hex("#a89882"));
      c.rect(px + 17, py + 93, 6, 2, hex("#a89882"));
      // Center-north ceramic succulent & coffee mugs on coasters
      c.circle(px + Math.floor(pw / 2), py + 20, 6, hex("#f2efe9"));
      c.circle(px + Math.floor(pw / 2), py + 20, 4, hex("#58a856"));
      for (const [mx, my] of [[px + 18, py + 54], [px + pw - 18, py + 28], [px + pw - 18, py + 94]]) {
        c.circle(mx, my, 4, hex("#c29362"));
        c.circle(mx, my, 3, hex("#faf7f0"));
        c.circle(mx, my, 1.5, hex("#5a351c"));
      }
    } else if (p.k === "board") {
      // Iconic Stardew Valley Pelican Town "Help Wanted" Bulletin Board!
      paintHelpWantedBoard(c, px, py, pw, ph);
    } else if (p.k === "hub") {
      // IMAGE 3: Airy Central Studio Resource & Greenery Hub (x=22..24, y=12..13 -> 96x64px)
      // Calm, refined workstation companion hub (Laser Printer + Bonsai/Library + Filtered Water Station) — zero clutter!
      // Subtle woven sage-linen accent mat grounding the island cleanly in the central avenue
      const rx = px - 10, ry = py - 12, rw = pw + 20, rh = ph + 24;
      c.rect(rx + 2, ry + 3, rw, rh, SHADOW_SOFT);
      c.borderedRoundRect(rx, ry, rw, rh, 6, hex("#ced7cc", 205), hex("#738775", 215), 2);
      c.box(rx + 6, ry + 6, rw - 12, rh - 12, hex("#dfe6dd", 190), hex("#a6b8a5", 190), 1);

      // Sleek Low-Profile Warm-Walnut & Matte-Cream Studio Credenza Island (centered inside mat!)
      const ix = px + 2, iy = py + 8, iw = pw - 4, ih = ph - 16; // 92x48px
      c.rect(ix + 2, iy + 5, iw, ih, SHADOW);
      c.borderedRoundRect(ix, iy, iw, ih, 5, hex("#7d4e2d"), INK, 2); // walnut base cabinet
      c.box(ix + 3, iy + 3, iw - 6, ih - 14, hex("#f2ede3"), hex("#b5aa98"), 1); // warm stone/cream top slab
      // Front walnut cabinet doors with subtle brass pulls
      for (const bx of [ix + 6, ix + 34, ix + 62]) {
        c.box(bx, iy + ih - 10, 24, 7, hex("#683e22"), hex("#472915"), 1);
        c.rect(bx + 8, iy + ih - 8, 8, 2, hex("#e3b95d"));
      }

      // 1) Left: Sleek Modern Studio Multifunction Laser Printer + Crisp Printed Report Sheet!
      const prX = ix + 7, prY = iy + 6;
      c.borderedRoundRect(prX, prY, 26, 22, 3, hex("#e6e9ed"), INK, 1);
      c.rect(prX + 3, prY + 3, 20, 6, hex("#2f3640")); // sleek dark scanner lid & touch strip
      c.rect(prX + 18, prY + 5, 3, 2, hex("#5be882")); // green ready LED
      c.box(prX + 5, prY + 12, 16, 13, hex("#ffffff"), hex("#9aa4b0"), 1); // freshly printed wireframe sheet!
      c.rect(prX + 7, prY + 15, 10, 2, hex("#7d8ea0"));
      c.rect(prX + 7, prY + 19, 12, 2, hex("#a8b4c0"));

      // 2) Center: Minimalist Stoneware Bonsai/Succulent Planter + Stacked Studio Reference Books!
      c.box(ix + 38, iy + 18, 16, 10, hex("#5c8c72"), INK, 1); // hardcover design guide
      c.box(ix + 40, iy + 14, 14, 7, hex("#d47b52"), INK, 1); // stacked product playbook
      c.circle(ix + 46, iy + 10, 6, hex("#f5f1e8")); // minimalist stoneware bonsai pot
      c.circle(ix + 44, iy + 8, 4, hex("#47914a"));
      c.circle(ix + 49, iy + 9, 3.5, hex("#66b562"));

      // 3) Right: Modern Filtered Cold/Hot Studio Water Bar + Crystal Glass Tumblers!
      const wtX = ix + 61, wtY = iy + 6;
      c.borderedRoundRect(wtX, wtY, 15, 22, 3, hex("#eef3f7"), INK, 1); // matte-white water station
      c.circle(wtX + 7, wtY + 7, 5, hex("#9ad4f2")); // chilled filtered water reservoir
      c.circle(wtX + 7, wtY + 7, 3, hex("#d6f0fc"));
      c.rect(wtX + 4, wtY + 15, 3, 2, hex("#3c9de8")); // cold blue LED
      c.rect(wtX + 9, wtY + 15, 3, 2, hex("#e8664a")); // hot coral LED
      c.box(wtX + 3, wtY + 18, 9, 3, hex("#4b535e"), INK, 1); // stainless drip tray
      // Two crystal water tumblers on a tiny slate coaster beside the dispenser
      c.circle(ix + 82, iy + 12, 3.5, hex("#dceef7"));
      c.ring(ix + 82, iy + 12, 3.5, 2, hex("#7d9bb0"));
      c.circle(ix + 82, iy + 22, 3.5, hex("#dceef7"));
      c.ring(ix + 82, iy + 22, 3.5, 2, hex("#7d9bb0"));
    } else if (p.k === "server") {
      // Sleek Unified Modern Walnut & Matte-Charcoal AI Compute Tower Cabinet tucked cleanly in NE corner (x=36..37, y=3..5)!
      const sx = px + 6, sy = py + 4, sw = pw - 10, sh = ph - 8; // 54x88 crisp unified rack cabinet
      c.rect(sx + 4, sy + 6, sw, sh, SHADOW);
      c.borderedRoundRect(sx, sy, sw, sh, 4, hex("#6b442a"), INK, 2);
      c.box(sx + 2, sy + 2, sw - 4, 12, hex("#8f5d3c"), hex("#472a17"), 1);
      for (let vx = sx + 8; vx < sx + sw - 10; vx += 8) {
        c.rect(vx, sy + 5, 4, 4, hex("#362013"));
      }
      c.box(sx + 6, sy + 16, sw - 12, sh - 22, hex("#232830"), hex("#12151a"), 2);
      // 3 Crisp Horizontal Codex / AI Compute Blades with glowing emerald & cyan status LEDs
      for (let bi = 0; bi < 3; bi++) {
        const by = sy + 21 + bi * 20;
        c.box(sx + 10, by, sw - 20, 15, hex("#323944"), hex("#181c22"), 1);
        c.rect(sx + 13, by + 3, 14, 3, hex("#4b5563"));
        c.rect(sx + 13, by + 8, 14, 3, hex("#4b5563"));
        c.rect(sx + sw - 22, by + 5, 4, 4, hex("#5be882"));
        c.rect(sx + sw - 16, by + 5, 4, 4, bi === 1 ? hex("#fbd35c") : hex("#6ad6f2"));
      }
      c.line(sx + 10, sy + 20, sx + 22, sy + 36, 2, hex("#ffffff", 45));
      c.rect(sx + sw - 9, sy + 42, 2, 14, hex("#d9b15f"));
    } else if (p.k === "coffee") {
      // IMAGE 1: Boutique Specialty Espresso Bar & Café Corner (x=27..36, y=18..23 — mirrors Breakout Lounge across foyer!)
      // 1) Warm Woven Sage-Oatmeal Café Area Rug with subtle woven dots aligned with Breakout Lounge rug!
      const crX = 27 * S + 16, crY = 18 * S + 20, crW = 9 * S + 16, crH = 5 * S - 6; // 880..1184 x 596..750
      const cafeCx = crX + Math.floor(crW / 2); // exact horizontal center = 1032!
      c.rect(crX + 2, crY + 3, crW, crH, SHADOW_SOFT);
      c.borderedRoundRect(crX, crY, crW, crH, 6, hex("#ced7cc", 220), hex("#657a68", 225), 2);
      c.box(crX + 6, crY + 6, crW - 12, crH - 12, hex("#e3e9e0", 215), hex("#a1b5a2", 205), 1);
      for (let wy = crY + 18; wy < crY + crH - 14; wy += 16) {
        for (let wx = crX + 18; wx < crX + crW - 14; wx += 18) {
          c.rect(wx, wy, 2, 2, hex("#b8c7b6", 140));
        }
      }

      // 2) Hero Specialty Coffee Machine Bar Counter centered on cafeCx (160x46px) with fluted walnut & Carrara marble!
      const bw = 160, bh = 46;
      const bx = cafeCx - Math.floor(bw / 2), by = py + 4; // 952..1112 x 580..626
      c.rect(bx + 3, by + 6, bw, bh, SHADOW);
      c.borderedRoundRect(bx, by + 2, bw, bh, 4, hex("#7d4e2d"), INK, 2);
      for (let fx = bx + 8; fx < bx + bw - 18; fx += 29) {
        c.box(fx, by + 29, 25, 15, hex("#683e22"), hex("#472915"), 1);
        c.rect(fx + 8, by + 32, 9, 2, hex("#e3b95d"));
      }
      // Crisp white Carrara marble countertop slab with subtle front oak bar lip
      c.box(bx, by, bw, 27, hex("#f7f5f0"), INK, 2);
      c.rect(bx + 2, by + 2, bw - 4, 4, hex("#ffffff"));

      // Commercial Dual-Group Espresso Machine (left-center of bar!)
      const ex = bx + 14;
      c.box(ex, by - 2, 42, 25, hex("#262b33"), INK, 2);
      c.rect(ex + 3, by, 36, 7, hex("#cfd6de"));
      c.rect(ex + 6, by + 1, 6, 5, hex("#faf7f0"));
      c.rect(ex + 14, by + 1, 6, 5, hex("#faf7f0"));
      c.rect(ex + 4, by + 9, 34, 8, hex("#9aa5b1"));
      c.rect(ex + 8, by + 11, 8, 4, hex("#2b313a"));
      c.rect(ex + 24, by + 11, 8, 4, hex("#2b313a"));
      c.rect(ex + 10, by + 15, 4, 3, hex("#d49e52")); // brass portafilters!
      c.rect(ex + 26, by + 15, 4, 3, hex("#d49e52"));
      c.rect(ex + 3, by + 17, 36, 5, hex("#cfd6de"));
      c.rect(ex + 9, by + 17, 6, 4, hex("#ffffff"));
      c.rect(ex + 25, by + 17, 6, 4, hex("#ffffff"));
      c.rect(ex + 36, by + 11, 2, 8, hex("#dce3eb"));

      // Conical Burr Grinder + Roasted Bean Hopper
      c.box(ex + 48, by + 3, 14, 20, hex("#3a414d"), INK, 2);
      c.circle(ex + 55, by + 2, 5.5, hex("#59351c"));
      c.circle(ex + 55, by + 2, 3, hex("#85522d"));

      // Syrups + Glass Pastry Dome (Croissants!) + Ceramic Cup Stack
      c.box(ex + 68, by + 4, 5, 8, hex("#b86b35"), INK, 1);
      c.box(ex + 75, by + 4, 5, 8, hex("#5f9473"), INK, 1);
      c.circle(ex + 97, by + 14, 9.5, hex("#dcebf0"));
      c.ring(ex + 97, by + 14, 9.5, 8, hex("#7d949e"));
      c.circle(ex + 95, by + 14, 3.5, hex("#d9944a"));
      c.circle(ex + 100, by + 16, 3, hex("#c97e38"));
      for (const [mx, my, col] of [[113, 5, "#f7f4ec"], [123, 5, "#6c9e79"], [113, 14, "#e08d55"], [123, 14, "#f7f4ec"]]) {
        c.box(ex + mx, by + my, 7, 7, hex(col), INK, 1);
      }

      // 3) THREE SLEEK MODERN BAR STOOLS (Cognac Leather & Walnut + Brass Footrest Ring!) tucked along Espresso Bar!
      for (const sx of [cafeCx - 48, cafeCx, cafeCx + 48]) {
        const sy = by + bh + 14; // cleanly tucked in front of bar counter!
        c.circle(sx + 1, sy + 3, 11, SHADOW_SOFT);
        c.ring(sx, sy, 11, 9, hex("#d4af62")); // brushed brass circular footrest ring!
        c.circle(sx, sy, 9.5, INK);
        c.circle(sx, sy, 8, hex("#9c562c")); // stitched cognac leather stool cushion
        c.circle(sx, sy - 1, 5.5, hex("#c27744")); // sunlit leather highlight
        // Slim curved walnut low-back lip facing north toward bar
        c.borderedRoundRect(sx - 8, sy + 6, 16, 5, 2, hex("#5e371c"), INK, 1);
        c.rect(sx - 6, sy + 7, 12, 2, hex("#8c5832"));
      }

      // 4) Flanking Symmetrical Café Accents: A-Frame Chalkboard Menu (West) & Terracotta Olive Plant (East)!
      c.rect(crX + 20, crY + 18, 22, 26, SHADOW_SOFT);
      c.borderedRoundRect(crX + 18, crY + 14, 22, 26, 3, hex("#293036"), hex("#7d4f2b"), 2); // cafe menu chalkboard
      c.rect(crX + 22, crY + 19, 14, 2, hex("#f5efe2"));
      c.rect(crX + 22, crY + 24, 12, 1, hex("#b7c4cc"));
      c.rect(crX + 22, crY + 28, 14, 1, hex("#b7c4cc"));
      c.rect(crX + 26, crY + 32, 6, 4, hex("#f2c879"));

      c.circle(crX + crW - 28, crY + 28, 10, hex("#c46d45")); // lush potted café olive plant
      c.ring(crX + crW - 28, crY + 28, 10, 8, hex("#7d3d22"));
      c.circle(crX + crW - 32, crY + 23, 6, hex("#479144"));
      c.circle(crX + crW - 24, crY + 24, 6, hex("#5cb058"));
      c.circle(crX + crW - 28, crY + 19, 5, hex("#78c26b"));

      // 5) Two Refined Round Marble-and-Brass Café Bistro Tables + 4 Sculpted Curved Café Chairs (south row y=22)!
      for (const [tx, hasPlate] of [[cafeCx - 76, false], [cafeCx + 76, true]]) {
        const ty = 22 * S + 4;
        // Pair of sculpted walnut-and-sage curved café chairs (left & right)
        c.rect(tx - 33, ty - 8, 16, 20, SHADOW_SOFT);
        c.borderedRoundRect(tx - 34, ty - 10, 16, 20, 6, hex("#5e8767"), INK, 2); // rounded sage seat
        c.borderedRoundRect(tx - 35, ty - 9, 6, 18, 3, hex("#6b4428"), INK, 1); // curved walnut backrest
        c.rect(tx - 33, ty - 7, 2, 14, hex("#9c6b43"));

        c.rect(tx + 19, ty - 8, 16, 20, SHADOW_SOFT);
        c.borderedRoundRect(tx + 18, ty - 10, 16, 20, 6, hex("#5e8767"), INK, 2);
        c.borderedRoundRect(tx + 29, ty - 9, 6, 18, 3, hex("#6b4428"), INK, 1);
        c.rect(tx + 31, ty - 7, 2, 14, hex("#9c6b43"));

        // Crisp Carrara Marble Round Café Table with Warm Brass Rim!
        c.circle(tx + 1, ty + 3, 17, SHADOW_SOFT);
        c.circle(tx, ty, 17, INK);
        c.circle(tx, ty, 15.5, hex("#d4af62")); // brushed brass table rim!
        c.circle(tx, ty, 13.5, hex("#f7f4ee")); // crisp white marble tabletop
        c.line(tx - 8, ty - 5, tx + 6, ty + 7, 1, hex("#dcd6cc", 140)); // delicate marble vein
        // Latte art cup + croissant plate or tiny bud vase
        c.circle(tx - 5, ty - 2, 4, hex("#ffffff"));
        c.circle(tx - 5, ty - 2, 2.2, hex("#6e4324"));
        c.rect(tx - 6, ty - 3, 2, 1, hex("#f5efe2")); // latte art heart!
        if (hasPlate) {
          c.circle(tx + 5, ty + 2, 4.5, hex("#ffffff"));
          c.circle(tx + 5, ty + 2, 2.5, hex("#d9944a"));
        } else {
          c.circle(tx + 5, ty + 2, 3.5, hex("#5ca856"));
          c.rect(tx + 4, ty, 2, 2, hex("#ffe066"));
        }
      }
    } else if (p.k === "shelf") {
      // IMAGE 4: Modern Garage Steel Mechanic Workbench & Tool Pegboard (x=40..44, y=4..6)!
      c.rect(px + 4, py + 24, pw - 8, ph - 18, SHADOW);
      // Wall pegboard with neatly hung tools (wrenches, hammer, drill)
      c.box(px + 6, py + 2, pw - 12, 30, hex("#3c434d"), INK, 2);
      for (let tx = px + 14; tx < px + pw - 18; tx += 18) {
        c.rect(tx, py + 8, 4, 16, hex("#b8c2cc")); // silver wrenches / screwdrivers
        c.rect(tx - 1, py + 18, 6, 6, tx % 36 === 0 ? hex("#d9483b") : hex("#e8b948")); // colored grips!
      }
      // Red & charcoal rolling steel mechanic tool chests + warm butcher-block workbench top!
      c.box(px + 4, py + 34, pw - 8, 52, hex("#c93b34"), INK, 2);
      c.box(px + 4, py + 34, pw - 8, 14, hex("#d9aa73"), INK, 2); // butcher-block wood top
      c.rect(px + 6, py + 36, pw - 12, 3, hex("#efd0a2"));
      for (let bx = px + 10; bx < px + pw - 14; bx += 48) {
        for (const dy of [52, 62, 72]) {
          c.box(bx, py + dy, 42, 8, hex("#b22f29"), hex("#6e1a16"), 1);
          c.rect(bx + 14, py + dy + 3, 14, 2, hex("#e3e8ee")); // chrome drawer handle
        }
      }
    } else if (p.k === "storage") {
      // IMAGE 1: Modern Studio Garage — Flush North Wall Workbench Cabinet (y=14) + Sleek East Wall EV Wallbox Charger (x=45)!
      // A) Built-In Matte-Charcoal & Butcher-Block Garage Storage Bench flush against North Garage Wall (y=14, x=39.6..44.8)
      const gbX = 39 * S + 20, gbY = 14 * S + 1, gbW = 5 * S + 6, gbH = 26;
      c.rect(gbX + 2, gbY + 5, gbW, gbH, SHADOW_SOFT);
      c.box(gbX, gbY, gbW, gbH, hex("#363d47"), INK, 2); // matte-charcoal cabinet
      c.box(gbX + 2, gbY + 2, gbW - 4, 11, hex("#cfa06b"), hex("#78522d"), 1); // warm oak butcher-block top
      c.rect(gbX + 4, gbY + 3, gbW - 8, 2, hex("#ebd0a2"));
      for (let dx = gbX + 8; dx < gbX + gbW - 22; dx += 32) {
        c.box(dx, gbY + 15, 26, 8, hex("#48515e"), hex("#232830"), 1);
        c.rect(dx + 8, gbY + 18, 10, 2, hex("#d6dde6")); // brushed aluminum drawer pull
      }
      // Neat red mechanic toolbox + detailing bottles resting on the butcher-block bench
      c.box(gbX + 12, gbY + 3, 20, 9, hex("#c93834"), INK, 1);
      c.rect(gbX + 18, gbY + 6, 8, 2, hex("#e8edf2"));
      c.box(gbX + gbW - 26, gbY + 4, 5, 7, hex("#5998b8"), INK, 1);
      c.box(gbX + gbW - 18, gbY + 4, 5, 7, hex("#e8b948"), INK, 1);
      // Slim wall-mounted tool strip inside the y=13 divider wall plaster above the bench!
      c.box(gbX + 36, 13 * S + 16, 72, 11, hex("#2b313a"), INK, 1);
      for (let tx = gbX + 43; tx < gbX + 102; tx += 11) {
        c.rect(tx, 13 * S + 18, 3, 7, hex("#c5ced6"));
      }

      // B) Modern Architectural EV Wallbox Charger mounted cleanly on East Wall beside Car (x=45, y=17..19)!
      const evX = px + 2, evY = 17 * S + 16;
      c.rect(evX + 2, evY + 5, 24, 50, SHADOW);
      c.borderedRoundRect(evX, evY, 26, 52, 6, hex("#f0f4f7"), INK, 2); // satin-white EV charger body
      c.rect(evX + 2, evY + 2, 22, 6, hex("#ffffff"));
      c.borderedRoundRect(evX + 4, evY + 10, 18, 22, 3, hex("#1f252d"), hex("#545e6b"), 1); // obsidian display
      c.ring(evX + 13, evY + 19, 5, 3, hex("#4ce37d")); // glowing emerald EV ready halo
      c.rect(evX + 8, evY + 27, 10, 2, hex("#68d6f0")); // charge bar
      // Coiled charging cable + wall dock holster below charger
      c.borderedRoundRect(evX + 6, evY + 38, 14, 10, 2, hex("#323942"), INK, 1);
      c.ring(evX - 4, evY + 42, 7, 4.5, hex("#232830")); // neatly coiled matte-black cable loop!
    } else if (p.k === "car") {
      // IMAGE 1: Executive Sculpted Modern Fastback / Sporty SUV (Crimson Metallic, x=40..43, y=16..21 -> 128x192px)!
      // Tapered aerodynamic front nose & rear deck, wide muscular fenders, smoked glass cabin, clearcoat highlights!
      const cx = px + 14, cy = py + 8, cw = pw - 28, ch = ph - 14; // 100x178px sculpted silhouette!
      const midX = cx + Math.floor(cw / 2);

      // Soft contoured ground shadow
      c.roundRect(cx - 2, cy + 6, cw + 8, ch + 3, 24, SHADOW);

      // 4 Recessed Wide Sport Tires inside subtle dark wheel-arch recesses
      for (const [tx, ty] of [
        [cx - 3, cy + 24], [cx + cw - 5, cy + 24],
        [cx - 3, cy + ch - 56], [cx + cw - 5, cy + ch - 56],
      ]) {
        c.borderedRoundRect(tx, ty, 8, 30, 3, hex("#1a1e24"), INK, 1);
        c.rect(tx + 2, ty + 5, 2, 20, hex("#3d4550")); // tire tread sheen
      }

      // Rich Multi-Tone Metallic Ruby-Crimson Sculpted Body
      const bodyDeep = hex("#7d191e");
      const bodyBase = hex("#ba2930");
      const bodyMid = hex("#d43b40");
      const bodySpec = hex("#f07872");

      // Tapered Rear Haunch & Front Nose Cap (gives genuine car taper instead of boxy rectangle!)
      c.borderedRoundRect(cx + 6, cy, cw - 12, ch, 20, bodyBase, INK, 2);
      // Wide Muscular Mid-Body & Wheel-Arch Fenders
      c.borderedRoundRect(cx, cy + 16, cw, ch - 32, 16, bodyBase, INK, 2);
      // Smooth inner body blend covering the taper join seams
      c.roundRect(cx + 3, cy + 14, cw - 6, ch - 28, 14, bodyMid);
      c.roundRect(cx + 8, cy + 4, cw - 16, ch - 8, 16, bodyMid);
      c.roundRect(cx + 12, cy + 8, cw - 24, ch - 16, 12, bodyBase);

      // Crisp Metallic Shoulder Lines & Sculpted Hood Power-Domes!
      c.rect(cx + 4, cy + 26, 3, ch - 54, bodySpec); // left sculpted fender highlight
      c.rect(cx + cw - 7, cy + 26, 3, ch - 54, bodySpec); // right sculpted fender highlight
      c.line(cx + 20, cy + ch - 44, cx + 26, cy + ch - 14, 2, bodySpec); // sculpted V-hood crease L
      c.line(cx + cw - 20, cy + ch - 44, cx + cw - 26, cy + ch - 14, 2, bodySpec); // sculpted V-hood crease R
      c.rect(cx + 10, cy + ch - 16, cw - 20, 2, bodyDeep); // front hood shutline

      // Aerodynamic Body-Colored Side Wing Mirrors
      c.borderedRoundRect(cx - 10, cy + ch - 70, 12, 8, 3, bodyMid, INK, 2);
      c.rect(cx - 8, cy + ch - 68, 6, 2, bodySpec);
      c.borderedRoundRect(cx + cw - 2, cy + ch - 70, 12, 8, 3, bodyMid, INK, 2);
      c.rect(cx + cw + 2, cy + ch - 68, 6, 2, bodySpec);

      // Wrap-Around Smoked Glass Cabin Greenhouse (dark A/B/C pillars + continuous sleek roof glass!)
      c.borderedRoundRect(cx + 13, cy + 18, cw - 26, 114, 12, hex("#1c242e"), INK, 2); // dark glass greenhouse frame
      // Rear Fastback Window (north)
      c.borderedRoundRect(cx + 17, cy + 21, cw - 34, 20, 6, hex("#2f4357"), hex("#141b24"), 1);
      c.line(cx + 24, cy + 24, cx + 34, cy + 36, 3, hex("#7ab0d9", 150));
      // Glossy Tinted Panoramic Sunroof framed by painted roof rails
      c.borderedRoundRect(cx + 16, cy + 43, cw - 32, 54, 6, bodyMid, bodyDeep, 1);
      c.borderedRoundRect(cx + 21, cy + 47, cw - 42, 46, 5, hex("#233242"), hex("#121921"), 1);
      c.line(cx + 26, cy + 54, cx + 52, cy + 84, 5, hex("#6898bf", 130)); // soft glass sky sheen
      c.line(cx + 42, cy + 52, cx + 62, cy + 74, 2, hex("#b3daf5", 130));
      // Shark-fin roof antenna
      c.box(midX - 2, cy + 43, 4, 7, hex("#22272e"), INK, 1);

      // Swept Curved Front Windshield (south, facing garage roller door!)
      c.borderedRoundRect(cx + 15, cy + 99, cw - 30, 30, 8, hex("#2e4459"), hex("#141c24"), 1);
      c.line(cx + 22, cy + 104, cx + 38, cy + 122, 4, hex("#89c2eb", 170));
      c.line(cx + 36, cy + 103, cx + 48, cy + 117, 2, hex("#d4edff", 160));
      // Subtle windshield wiper blades
      c.line(cx + 22, cy + 125, cx + 42, cy + 121, 2, hex("#14181d"));
      c.line(cx + 52, cy + 125, cx + 74, cy + 121, 2, hex("#14181d"));

      // Flush Chrome Door Handles & Side Character Line
      c.rect(cx + 7, cy + 76, 3, 7, hex("#e3e9ef"));
      c.rect(cx + cw - 10, cy + 76, 3, 7, hex("#e3e9ef"));

      // Sleek Full-Width Smoked-Ruby Rear LED Tail Light Bar (north bumper) + Rear Spoiler Lip
      c.rect(cx + 16, cy + 12, cw - 32, 3, bodyDeep); // rear lip spoiler
      c.box(cx + 15, cy + 4, cw - 30, 6, hex("#ff3d47"), hex("#5e0d12"), 1);
      c.rect(cx + 17, cy + 6, 20, 2, hex("#ff9e9e")); // bright LED signature L
      c.rect(cx + cw - 37, cy + 6, 20, 2, hex("#ff9e9e")); // bright LED signature R
      c.box(midX - 9, cy + 1, 18, 4, hex("#f4f6f8"), INK, 1); // clean license plate

      // Sharp Modern LED DRL Headlights + Recessed Matte-Black Front Grille & Silver Emblem (south nose!)
      c.borderedRoundRect(cx + 14, cy + ch - 13, 22, 8, 3, hex("#fffbe0"), hex("#3c434d"), 1);
      c.borderedRoundRect(cx + cw - 36, cy + ch - 13, 22, 8, 3, hex("#fffbe0"), hex("#3c434d"), 1);
      c.rect(cx + 17, cy + ch - 10, 16, 3, hex("#ffffff")); // crisp white DRL blade
      c.rect(cx + cw - 33, cy + ch - 10, 16, 3, hex("#ffffff"));
      c.borderedRoundRect(cx + 38, cy + ch - 10, cw - 76, 7, 2, hex("#1f242b"), INK, 1); // recessed sport grille
      c.circle(midX, cy + ch - 7, 2.5, hex("#dde4ec")); // metallic studio badge!
    } else if (p.k === "plant") {
      paintStardewPlant(c, px, py, p.x + p.y);
    }
  }

  // STEP H: Compact, 100% unclipped Stardew berry bushes & garden stones inside the north yard
  // (All tall Oak & Pine forest trees are rendered unclipped on the infinite surroundings canvas so ZERO trees are ever sliced at the stage edge!)
  paintStardewBush(c, 2 * S + 16, 34, true);
  paintStardewBush(c, 18 * S + 16, 34, false);
  paintStardewBush(c, 35 * S + 16, 34, true);
  paintStardewBush(c, 45 * S + 16, 34, true);

  return c;
}

/* ---------- 2. Seamless Pelican Town Meadow Tile (192x192 — zero rocks, zero wrap seams!) ---------- */
function generateMeadowTile() {
  const c = new Canvas(192, 192);
  paintStardewGrassArea(c, 0, 0, 6, 6, 808, { keepBorderClean: true });
  return c;
}

/* ---------- 3. Seamless Pelican Town Dirt Village Lane Tile (192x64) ---------- */
function generateLaneTile() {
  const c = new Canvas(192, 64);
  paintStardewDirtRoad(c, 0, 0, 6, 2, 909);
  return c;
}

/* ---------- 3b. Unclipped Pelican Town Forest Sprites for Seamless Infinite Surroundings ---------- */
function generateOakTreeSprite() {
  // 96x140 (48x70 logical) — full unclipped Stardew Oak tree with trunk.png's organic hand-pixeled ground shadow!
  const c = new Canvas(96, 140);
  c.blit(SHEETS.trunk, 0, 0, 96, 96, 0, 42, { grade: GRADE.stardewWood });
  c.blit(SHEETS.treetop, 0, 0, 96, 96, 0, 2, { grade: GRADE.stardewFoliage });
  return c;
}

function generatePineTreeSprite() {
  // 96x136 (48x68 logical) — full unclipped Stardew Pine tree with trunk & organic ground shadow!
  const c = new Canvas(96, 136);
  c.blit(SHEETS.trunk, 96, 0, 96, 96, 0, 40, { grade: GRADE.stardewWood });
  c.blit(SHEETS.treetop, 0, 96, 96, 128, 0, 0, { grade: GRADE.stardewFoliage });
  return c;
}

function generateBushSprite() {
  // 48x40 (24x20 logical) — full unclipped Stardew berry bush!
  const c = new Canvas(48, 40);
  paintStardewBush(c, 24, 24, true);
  return c;
}

/* ---------- 4. Hand-Pixeled Stardew Oak Workstations (Desks, Chairs, Mug, Plant) ---------- */
function generateDesk(dir) {
  // Exact 72x56 dimensions matching public/office-harvest.js & tests/harvest-theme.test.ts!
  const c = new Canvas(72, 56);
  // Soft warm floor contact shadow
  c.rect(4, 48, 64, 6, SHADOW);
  // Clean crop of real LPC hand-pixeled wooden table in cabinets.png (96, 266, 64, 38 — zero stray row 7 pixels!)
  c.blit(SHEETS.cabinets, 96, 266, 64, 38, 4, 6, { dw: 64, dh: 44, grade: GRADE.stardewWood });
  // Sunlit oak top edge highlight
  c.rect(6, 7, 60, 2, hex("#f2c98a", 165));
  if (dir === "south") {
    // Crisp brass drawer pulls on front apron
    c.rect(18, 39, 8, 3, hex("#e8b84b"));
    c.rect(46, 39, 8, 3, hex("#e8b84b"));
  }
  c.outline(INK);
  return c;
}

function generateChair(dir) {
  if (dir === "north") {
    // Exact 30x26 — cropped directly from country.png wooden chair facing south (64, 0, 32, 32)!
    const c = new Canvas(30, 26);
    c.blit(SHEETS.country, 64, 2, 32, 28, -1, 0, { dw: 32, dh: 26, grade: GRADE.stardewWood });
    return c;
  }
  // Exact 30x40 — positioned near top (y=0..34) so seated characters sit snugly ON the chair with zero floor gap!
  const c = new Canvas(30, 40);
  c.rect(4, 30, 22, 5, SHADOW_SOFT);
  c.blit(SHEETS.country, 64, 32, 32, 32, -1, 0, { dw: 32, dh: 34, grade: GRADE.stardewWood });
  return c;
}

function generateCeoDesk() {
  // Exact 72x56 — Bespoke Founder/CEO Deep Espresso-Walnut Executive Desk with Black Leather Blotter & Gold Nameplate!
  const c = new Canvas(72, 56);
  c.rect(2, 48, 68, 6, SHADOW);
  // Commanding wide dark-walnut desktop + paneled executive front modesty apron
  c.borderedRoundRect(2, 4, 68, 46, 4, hex("#4f311e"), INK, 2);
  c.box(4, 6, 64, 22, hex("#6b442a"), hex("#361f12"), 1); // polished walnut top
  c.rect(6, 7, 60, 2, hex("#946240")); // sunlit edge sheen
  // Executive black leather desk blotter pad in center
  c.box(16, 10, 40, 14, hex("#23272e"), hex("#12151a"), 1);
  // Front executive walnut paneling + brushed brass CEO nameplate!
  c.box(6, 30, 60, 18, hex("#422717"), hex("#26150c"), 1);
  c.box(10, 33, 18, 12, hex("#52321e"), hex("#2e1a0e"), 1);
  c.box(44, 33, 18, 12, hex("#52321e"), hex("#2e1a0e"), 1);
  c.box(29, 34, 14, 7, hex("#e5bc62"), hex("#7d5b18"), 1); // Gold "CEO" nameplate!
  c.rect(31, 37, 10, 1, hex("#593e0c"));
  return c;
}

function generateCeoChair() {
  // Exact 30x26 — High-Back Tufted Black-Leather Executive Swivel Chair with Brushed-Brass Trim!
  const c = new Canvas(30, 26);
  c.borderedRoundRect(3, 1, 24, 23, 5, hex("#262b33"), INK, 2);
  c.borderedRoundRect(6, 3, 18, 16, 3, hex("#363d47"), hex("#181b21"), 1);
  c.rect(8, 5, 14, 3, hex("#545e6e")); // headrest leather sheen
  // Brushed brass armrest caps left & right
  c.rect(2, 11, 3, 9, hex("#d4af62"));
  c.rect(25, 11, 3, 9, hex("#d4af62"));
  return c;
}

function generateMug() {
  // Exact 16x18 handmade Stardew stoneware coffee mug!
  const c = new Canvas(16, 18);
  c.rect(3, 14, 10, 3, SHADOW_SOFT);
  // Handle
  c.box(10, 7, 5, 6, hex("#d9c29c"), INK, 1);
  c.rect(11, 9, 2, 2, hex("#000000", 0));
  // Mug body
  c.box(3, 4, 9, 11, hex("#f4e4c4"), INK, 1);
  c.rect(4, 5, 7, 2, hex("#5c331a")); // rich hot coffee inside!
  c.rect(4, 8, 3, 5, hex("#fff9eb")); // ceramic specular highlight
  c.rect(4, 12, 7, 2, hex("#d1b588"));
  return c;
}

function generateHerb() {
  // Exact 18x22 potted Stardew sprout/fern!
  const c = new Canvas(18, 22);
  c.rect(4, 18, 10, 3, SHADOW_SOFT);
  // Terracotta mini pot
  c.box(4, 12, 10, 8, hex("#c86842"), INK, 1);
  c.box(3, 10, 12, 4, hex("#df8257"), INK, 1);
  c.rect(5, 11, 8, 1, hex("#f4a982"));
  // Sprout leaves
  c.box(3, 5, 6, 6, hex("#439134"), INK, 1);
  c.box(9, 4, 6, 6, hex("#59b142"), INK, 1);
  c.box(6, 2, 6, 7, hex("#7ad158"), INK, 1);
  return c;
}

/* ---------- 5. Cute 2x Retina Interactive Workspace Critters (Chickens, Cats, Rabbits!) ---------- */
function generateChickenSprite(variant) {
  // 64x32 horizontal strip: Frame 0 = walking/standing right, Frame 1 = pecking/wing-hop!
  const c = new Canvas(64, 32);
  const body = variant === "brown" ? hex("#c97e44") : hex("#faf7ef");
  const bodySh = variant === "brown" ? hex("#99582a") : hex("#dfd7c5");
  const wing = variant === "brown" ? hex("#b06834") : hex("#ede6d6");
  const comb = hex("#d93b3b");
  const beak = hex("#f0a42b");
  for (let f = 0; f < 2; f++) {
    const ox = f * 32;
    const bob = f === 1 ? 2 : 0;
    // Soft ground shadow
    c.ellipse(ox + 16, 27, 8, 3, SHADOW_SOFT);
    // Tiny orange chicken feet
    c.rect(ox + 12, 24, 2, 4, beak);
    c.rect(ox + 18, 24 - (f === 1 ? 1 : 0), 2, 4, beak);
    // Plump oval chicken body
    c.ellipse(ox + 15, 19 + bob, 9, 7, INK);
    c.ellipse(ox + 15, 19 + bob, 7.5, 5.5, body);
    c.ellipse(ox + 14, 21 + bob, 6, 3, bodySh);
    // Tail feathers (left)
    c.rect(ox + 5, 14 + bob, 4, 5, bodySh);
    c.rect(ox + 6, 13 + bob, 3, 4, body);
    // Wing detail
    c.ellipse(ox + 14, 19 + bob - (f === 1 ? 1 : 0), 4, 2.5, wing);
    // Head + red comb + orange beak + bright eye!
    const hx = f === 1 ? ox + 22 : ox + 20;
    const hy = f === 1 ? 18 : 13;
    c.circle(hx, hy, 5.2, INK);
    c.circle(hx, hy, 4, body);
    // Red comb & wattle
    c.rect(hx - 2, hy - 6, 4, 3, comb);
    c.rect(hx + 1, hy - 5, 2, 2, comb);
    c.rect(hx + 2, hy + 2, 2, 2, comb);
    // Orange beak & cute eye
    c.rect(hx + 3, hy, 4, 2, beak);
    c.rect(hx + 1, hy - 1, 2, 2, INK);
  }
  return c;
}

function generateCatSprite(variant) {
  // 96x32 horizontal strip: Frame 0 = walk1, Frame 1 = walk2, Frame 2 = cozy curled catnap!
  const c = new Canvas(96, 32);
  const fur = variant === "ginger" ? hex("#e39344") : hex("#333842");
  const furSh = variant === "ginger" ? hex("#b86927") : hex("#1e2229");
  const patch = variant === "ginger" ? hex("#fae6c3") : hex("#f7f6f2");
  const earIn = hex("#f29aa8");
  for (let f = 0; f < 3; f++) {
    const ox = f * 32;
    if (f < 2) {
      // Walking / strolling cat facing right
      c.ellipse(ox + 16, 27, 10, 3, SHADOW_SOFT);
      // Curved expressive tail wagging!
      const tailY = f === 0 ? 11 : 13;
      c.line(ox + 6, 19, ox + 4, tailY, 3, INK);
      c.line(ox + 6, 19, ox + 4, tailY, 1.5, fur);
      // Legs alternating walk stride
      const l1 = f === 0 ? 23 : 24, l2 = f === 0 ? 24 : 23;
      c.box(ox + 9, l1, 4, 5, patch, INK, 1);
      c.box(ox + 18, l2, 4, 5, patch, INK, 1);
      // Body
      c.borderedRoundRect(ox + 7, 15, 16, 10, 4, fur, INK, 1);
      c.rect(ox + 10, 17, 3, 4, furSh); // tabby stripe / shading
      c.rect(ox + 15, 17, 3, 4, furSh);
      // Cute round head + pointy cat ears + whiskers
      c.circle(ox + 22, 13, 6, INK);
      c.circle(ox + 22, 13, 5, fur);
      c.rect(ox + 18, 6, 3, 4, fur); c.rect(ox + 19, 8, 1, 2, earIn);
      c.rect(ox + 23, 6, 3, 4, fur); c.rect(ox + 24, 8, 1, 2, earIn);
      // Muzzle & bright eyes
      c.rect(ox + 21, 14, 5, 3, patch);
      c.rect(ox + 20, 12, 2, 2, hex("#22252b"));
      c.rect(ox + 24, 12, 2, 2, hex("#22252b"));
      c.rect(ox + 23, 14, 2, 1, earIn); // pink nose
    } else {
      // Frame 2: Adorable curled-up napping cat ball!
      c.ellipse(ox + 16, 26, 11, 4, SHADOW_SOFT);
      c.ellipse(ox + 16, 20, 10, 7, INK);
      c.ellipse(ox + 16, 20, 8.5, 5.5, fur);
      c.ellipse(ox + 14, 22, 6, 3, furSh);
      c.circle(ox + 20, 17, 5, INK);
      c.circle(ox + 20, 17, 4, fur);
      c.rect(ox + 17, 12, 2, 3, fur);
      c.rect(ox + 21, 12, 2, 3, fur);
      c.rect(ox + 19, 17, 2, 1, INK); // closed sleepy eyes
      c.rect(ox + 22, 17, 2, 1, INK);
      c.line(ox + 8, 22, ox + 15, 25, 2.5, patch); // tucked tail tip
    }
  }
  return c;
}

function generateRabbitSprite(variant) {
  // 64x32 horizontal strip: Frame 0 = sitting/sniffing, Frame 1 = joyful mid-hop!
  const c = new Canvas(64, 32);
  const fur = variant === "cinnamon" ? hex("#c9986d") : hex("#faf9f5");
  const furSh = variant === "cinnamon" ? hex("#9c6e49") : hex("#ddd9cf");
  const earIn = hex("#f5a6b8");
  for (let f = 0; f < 2; f++) {
    const ox = f * 32;
    const hopY = f === 1 ? -4 : 0;
    c.ellipse(ox + 16, 27, 8, 3, SHADOW_SOFT);
    // Fluffy cotton tail (left)
    c.circle(ox + 8, 21 + hopY, 3.5, INK);
    c.circle(ox + 8, 21 + hopY, 2.5, hex("#ffffff"));
    // Plump rabbit body
    c.ellipse(ox + 15, 21 + hopY, 7.5, 6, INK);
    c.ellipse(ox + 15, 21 + hopY, 6, 4.5, fur);
    c.ellipse(ox + 14, 23 + hopY, 5, 2.5, furSh);
    // Feet (tucked or hopping!)
    c.rect(ox + 11, 25 + hopY, 4, 2, furSh);
    c.rect(ox + 17, 25 + hopY, 4, 2, furSh);
    // Cute head + tall upright rabbit ears!
    c.circle(ox + 20, 16 + hopY, 5, INK);
    c.circle(ox + 20, 16 + hopY, 4, fur);
    // Long upright bunny ears
    c.box(ox + 16, 6 + hopY, 4, 9, fur, INK, 1);
    c.rect(ox + 17, 8 + hopY, 2, 5, earIn);
    c.box(ox + 20, 5 + hopY, 4, 9, fur, INK, 1);
    c.rect(ox + 21, 7 + hopY, 2, 5, earIn);
    // Bright eye & pink bunny nose
    c.rect(ox + 21, 15 + hopY, 2, 2, INK);
    c.rect(ox + 23, 17 + hopY, 2, 2, earIn);
  }
  return c;
}

/* ---------- Write All 2x Retina Stardew Valley PNGs ---------- */
const laneCanvas = generateLaneTile();
const outputs = [
  ["farmhouse-bg@2x.png", generateFarmhouseBackground(laneCanvas)],
  ["meadow-tile@2x.png", generateMeadowTile()],
  ["lane-tile@2x.png", laneCanvas],
  ["tree-oak@2x.png", generateOakTreeSprite()],
  ["tree-pine@2x.png", generatePineTreeSprite()],
  ["bush@2x.png", generateBushSprite()],
  ["desk-north@2x.png", generateDesk("north")],
  ["desk-south@2x.png", generateDesk("south")],
  ["desk-ceo@2x.png", generateCeoDesk()],
  ["chair-north@2x.png", generateChair("north")],
  ["chair-south@2x.png", generateChair("south")],
  ["chair-ceo@2x.png", generateCeoChair()],
  ["mug@2x.png", generateMug()],
  ["herb@2x.png", generateHerb()],
  ["chicken-white@2x.png", generateChickenSprite("white")],
  ["chicken-brown@2x.png", generateChickenSprite("brown")],
  ["cat-ginger@2x.png", generateCatSprite("ginger")],
  ["cat-tuxedo@2x.png", generateCatSprite("tuxedo")],
  ["rabbit-white@2x.png", generateRabbitSprite("white")],
  ["rabbit-cinnamon@2x.png", generateRabbitSprite("cinnamon")],
];

for (const [name, canvas] of outputs) {
  const png = encodePng(canvas.w, canvas.h, canvas.buf);
  const outPath = path.join(OUT_DIR, name);
  fs.writeFileSync(outPath, png);
  console.log(`Generated ${path.relative(ROOT, outPath)} (${canvas.w}x${canvas.h}, ${(png.length / 1024).toFixed(1)} KB)`);
}
