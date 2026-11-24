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
  paintStardewDirtRoad(c, 21, 24, 4, 2, 509);
  // Stepping stones leading up to front porch from dirt2.png
  c.blit(SHEETS.dirt2, 0, 0, 32, 64, 22 * S, 25 * S, { grade: GRADE.stardewDirt });

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
  // 2) Owner's Modern Executive Studio (x=2..9, y=17..23) — Rich Warm Walnut-Oak Wide Planks!
  paintHoneyOakFloor(c, 2, 17, 8, 7, "cedar");
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
  // 5) Modern Studio Garage (x=39..45, y=3..23) — Smooth Polished Concrete + Painted Parking Bay!
  const garRng = rng(731);
  for (let ty = 3; ty <= 23; ty++) {
    for (let tx = 39; tx <= 45; tx++) {
      const x = tx * S, y = ty * S;
      const shade = garRng() > 0.5 ? hex("#9aa0a6") : hex("#949ba1");
      c.rect(x, y, S, S, shade);
      // subtle concrete expansion joint every 2 tiles
      if (tx % 2 === 0) c.rect(x, y, 1, S, hex("#7d848b"));
      if (ty % 2 === 0) c.rect(x, y, S, 1, hex("#7d848b"));
      for (let sp = 0; sp < 4; sp++) {
        c.rect(x + Math.floor(garRng() * 28), y + Math.floor(garRng() * 28), 2, 2, garRng() > 0.5 ? hex("#aeb4ba", 120) : hex("#7c8289", 120));
      }
    }
  }
  // Crisp painted yellow-amber parking bay guide lines framing the modern car slot (x=39.6..44.2, y=14.6..22.6)
  c.rect(39 * S + 18, 14 * S + 18, 4, 8 * S + 6, hex("#e8be4a", 210));
  c.rect(44 * S + 8, 14 * S + 18, 4, 8 * S + 6, hex("#e8be4a", 210));
  c.rect(39 * S + 18, 14 * S + 18, 5 * S - 6, 4, hex("#e8be4a", 210));
  // Rubber wheel-stop curb at front of parking bay
  c.borderedRoundRect(40 * S + 16, 14 * S + 28, 3 * S, 10, 3, hex("#3c4149"), INK, 1);
  c.rect(40 * S + 28, 14 * S + 30, 14, 6, hex("#f0c64b"));
  c.rect(42 * S + 6, 14 * S + 30, 14, 6, hex("#f0c64b"));

  // Doorway floor thresholds connecting rooms smoothly
  paintHoneyOakFloor(c, 10, 8, 1, 2, "honey");
  paintHoneyOakFloor(c, 10, 17, 1, 2, "honey");
  paintHoneyOakFloor(c, 8, 11, 2, 1, "honey");
  paintHoneyOakFloor(c, 8, 16, 2, 1, "cedar");
  paintHoneyOakFloor(c, 38, 13, 1, 2, "cedar");
  paintHoneyOakFloor(c, 22, 24, 2, 1, "honey");

  // Subtle ambient occlusion under north wall & left/right partitions for crisp 3D depth!
  c.rect(2 * S, 3 * S, 44 * S, 8, SHADOW_SOFT);
  c.rect(2 * S, 12 * S, 6 * S, 6, SHADOW_SOFT);
  c.rect(2 * S, 17 * S, 6 * S, 6, SHADOW_SOFT);

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
  for (const tx of [3, 12, 19, 31, 40, 44]) {
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

  // Cozy Stardew Farmhouse Framed Wall Art (landscape, Junimo sprout, and warm sconces on North wall!)
  for (const [tx, bg, acc] of [
    [15, hex("#7dc2e8"), hex("#55a846")], // Pelican Valley hill painting
    [24, hex("#f7e7ba"), hex("#54b350")], // Cute little emerald Junimo portrait!
    [35, hex("#f2b66d"), hex("#c94b3b")], // Sunset barn painting
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

  // Front Farmhouse Entrance Doorway (x=22..23, y=24) — Wide-open foyer with woven welcome mat & porch steps!
  c.blit(SHEETS.bridges, 0, 96, 64, 32, 22 * S, 24 * S + 10, { grade: GRADE.stardewWood });
  // Woven welcome mat inside grand unobstructed front foyer
  c.borderedRoundRect(22 * S + 6, 23 * S + 6, 52, 22, 4, hex("#c89352"), hex("#6b401e"), 2);
  c.rect(22 * S + 12, 23 * S + 12, 40, 10, hex("#e3b97c"));
  // Flanking brass porch torches/lanterns from lights.png
  c.blit(SHEETS.lights, 0, 0, 32, 32, 21 * S + 8, 24 * S - 6);
  c.blit(SHEETS.lights, 0, 0, 32, 32, 24 * S - 8, 24 * S - 6);

  // Iconic Stardew Valley Shipping Bin (real chests.png!) + Farmhouse Mailbox right beside front porch!
  c.blit(SHEETS.chests, 0, 0, 32, 32, 20 * S - 6, 25 * S - 6, { dw: 36, dh: 34, grade: GRADE.stardewWood });
  // Little Stardew wooden mailbox at x=25, y=25
  c.box(25 * S + 8, 25 * S + 10, 6, 18, hex("#7d4824"), INK, 1);
  c.box(25 * S + 3, 25 * S + 2, 16, 12, hex("#c8a878"), INK, 2);
  c.rect(25 * S + 15, 25 * S + 4, 3, 6, hex("#d9443e")); // red mail flag!

  // STEP G: Paint EVERY Interior Prop in OFFICE_PLAN!
  // 1) Owner's Modern Executive Studio (x=2..9, y=17..23) — Sleek Architectural Rug + Modern Credenza + Corner Plant!
  // Modern warm charcoal-cream woven studio rug centered cleanly under Executive Desk (x=6, y=19) & visitor area!
  const erX = 4 * S + 10, erY = 18 * S + 6, erW = 5 * S - 10, erH = 4 * S + 10;
  c.rect(erX + 2, erY + 3, erW, erH, SHADOW_SOFT);
  c.box(erX, erY, erW, erH, hex("#d9d0c0"), hex("#5e574e"), 2);
  c.box(erX + 6, erY + 6, erW - 12, erH - 12, hex("#ece4d6"), hex("#a89d8c"), 2);
  // Subtle modern geometric herringbone accent stripes on rug
  for (let rx = erX + 14; rx < erX + erW - 16; rx += 16) {
    c.rect(rx, erY + 12, 8, 2, hex("#9c8f7d", 140));
    c.rect(rx, erY + erH - 14, 8, 2, hex("#9c8f7d", 140));
  }
  // Mid-Century Modern Walnut Executive Credenza against North Wall (x=4..7, y=17) — behind Owner's chair!
  const crX = 4 * S + 12, crY = 17 * S + 2, crW = 3 * S + 24, crH = 24;
  c.rect(crX + 2, crY + 4, crW, crH, SHADOW);
  c.box(crX, crY, crW, crH, hex("#6b442b"), INK, 2);
  c.rect(crX + 2, crY + 2, crW - 4, 7, hex("#8f5d3c")); // sunlit walnut top
  // Slatted cabinet doors + brass handles
  for (let dx = crX + 8; dx < crX + crW - 12; dx += 28) {
    c.box(dx, crY + 11, 24, 10, hex("#593722"), hex("#3b2214"), 1);
    c.rect(dx + 9, crY + 14, 6, 2, hex("#e5bc62"));
  }
  // Decor on credenza: modern framed gallery art on wall, vinyl/books, golden award, mini desk lamp
  c.box(5 * S + 2, 16 * S + 8, 36, 16, hex("#304352"), hex("#c79d52"), 2);
  c.circle(5 * S + 14, 16 * S + 15, 4, hex("#e89a5a"));
  c.rect(5 * S + 22, 16 * S + 12, 10, 8, hex("#7fb39c"));
  c.box(crX + 10, crY - 4, 14, 8, hex("#3c6e71"), INK, 1); // design art book stack
  c.box(crX + crW - 26, crY - 6, 12, 10, hex("#f7e8b2"), INK, 1); // warm modern ceramic lamp!
  // Modern ceramic potted Monstera plant in bottom-right corner of Owner Studio (x=9, y=23 — non-blocking corner)
  c.circle(9 * S + 16, 23 * S + 18, 9, hex("#ebe7df"));
  c.ring(9 * S + 16, 23 * S + 18, 9, 7, hex("#5a554c"));
  c.circle(9 * S + 12, 23 * S + 11, 6, hex("#3c8444"));
  c.circle(9 * S + 20, 23 * S + 12, 6, hex("#52a458"));
  c.circle(9 * S + 16, 23 * S + 8, 5, hex("#72c46c"));

  // 2) Modern Conference Rug beneath relocated Meeting Table (x=30..33, y=12..13)!
  const mrX = 29 * S + 14, mrY = 11 * S + 6, mrW = 5 * S + 4, mrH = 3 * S + 20;
  c.rect(mrX + 2, mrY + 3, mrW, mrH, SHADOW_SOFT);
  c.box(mrX, mrY, mrW, mrH, hex("#d6ddd4"), hex("#6f8574"), 2);
  c.box(mrX + 6, mrY + 6, mrW - 12, mrH - 12, hex("#e8eee5"), hex("#a4b8a6"), 2);

  for (const p of PLAN.props) {
    const px = p.x * S, py = p.y * S, pw = p.w * S, ph = p.h * S;

    if (p.k === "kitchen") {
      // IMAGE 1: Modern Cozy Studio Kitchen & Espresso Pantry (x=2..8, y=4..6)!
      // Sleek matte stainless-steel French-door Refrigerator on left (px+2..px+46, py-16..py+68)
      c.rect(px + 6, py + 4, 46, 70, SHADOW);
      c.borderedRoundRect(px + 2, py - 14, 46, 84, 4, hex("#d7dde2"), INK, 2);
      c.rect(px + 6, py - 10, 38, 12, hex("#eef2f5")); // crisp top face
      c.rect(px + 24, py + 4, 2, 46, hex("#8d969f")); // French door split
      c.rect(px + 4, py + 50, 42, 2, hex("#8d969f")); // bottom freezer drawer seam
      c.rect(px + 19, py + 14, 3, 22, hex("#5d6670")); // left brushed steel handle
      c.rect(px + 28, py + 14, 3, 22, hex("#5d6670")); // right brushed steel handle
      c.box(px + 9, py + 16, 8, 14, hex("#363e47"), hex("#8c96a0"), 1); // water/ice dispenser!
      c.rect(px + 11, py + 18, 4, 3, hex("#75d4f5")); // blue LED display

      // Continuous Modern Light-Oak Cabinetry with Crisp White Quartz Countertop (px+52..px+222)
      const cx0 = px + 52, cw = pw - 54;
      c.rect(cx0 + 2, py + 32, cw, 44, SHADOW);
      // Warm light-oak base cabinets
      c.box(cx0, py + 24, cw, 48, hex("#b88a5a"), INK, 2);
      for (let bx = cx0 + 6; bx < cx0 + cw - 12; bx += 28) {
        c.box(bx, py + 48, 24, 20, hex("#a37548"), hex("#78522d"), 1);
        c.rect(bx + 8, py + 52, 8, 2, hex("#343940")); // sleek matte-black pull
      }
      // Crisp white quartz countertop slab
      c.box(cx0, py + 22, cw, 26, hex("#f6f3ed"), INK, 2);
      c.rect(cx0 + 2, py + 24, cw - 4, 4, hex("#ffffff"));

      // Modern Overhead Floating Light-Oak Wall Shelves & Range Hood along North Wall (py-20..py+14)
      // Sleek matte-black & stainless range hood above induction stove
      c.box(cx0 + 8, py - 24, 46, 22, hex("#383e46"), INK, 2);
      c.rect(cx0 + 12, py - 20, 38, 4, hex("#67717d"));
      c.rect(cx0 + 14, py - 6, 34, 2, hex("#ffebb8")); // warm under-hood LED strip!
      // Floating oak pantry shelves on right with ceramic mugs, matcha canisters & trailing herb plant
      c.box(cx0 + 82, py - 18, 82, 8, hex("#c29362"), INK, 1);
      c.box(cx0 + 82, py - 2, 82, 8, hex("#c29362"), INK, 1);
      for (const [mx, col] of [[88, "#f5efe4"], [99, "#6a9d76"], [110, "#e59a5c"], [124, "#527c96"], [138, "#f5efe4"]]) {
        c.box(cx0 + mx, py - 26, 8, 9, hex(col), INK, 1);
      }
      c.circle(cx0 + 154, py - 22, 6, hex("#52a44c")); // cute trailing kitchen plant!
      c.box(cx0 + 149, py - 10, 10, 9, hex("#d47e52"), INK, 1);

      // 4-Burner Black Glass Induction Cooktop (cx0+8..cx0+54)
      c.box(cx0 + 8, py + 26, 46, 18, hex("#23272e"), hex("#545b66"), 1);
      c.ring(cx0 + 20, py + 35, 6, 4, hex("#e85d44")); // active glowing induction ring!
      c.ring(cx0 + 38, py + 35, 5, 3, hex("#4c535e"));
      c.circle(cx0 + 20, py + 35, 4, hex("#c8ced6")); // sleek stainless pour-over kettle!

      // Under-mount Brushed Stainless Sink + Gooseneck Chrome Faucet (cx0+64..cx0+104)
      c.box(cx0 + 64, py + 26, 36, 18, hex("#adb6bf"), hex("#5c6570"), 2);
      c.rect(cx0 + 68, py + 29, 28, 12, hex("#c7d0d9"));
      c.circle(cx0 + 82, py + 35, 2, hex("#4c545e")); // drain
      c.rect(cx0 + 80, py + 20, 4, 9, hex("#3b414a")); // matte-black gooseneck faucet
      c.rect(cx0 + 80, py + 20, 9, 3, hex("#3b414a"));
      c.box(cx0 + 96, py + 24, 6, 8, hex("#d8e6dc"), INK, 1); // hand soap dispenser

      // Commercial Boutique Espresso Machine & Grinder Station (cx0+112..cx0+164)
      c.box(cx0 + 114, py + 12, 34, 28, hex("#2d323a"), INK, 2);
      c.rect(cx0 + 118, py + 14, 26, 7, hex("#c9d1d9")); // chrome cup-warmer tray
      c.rect(cx0 + 120, py + 24, 22, 8, hex("#9aa4b0")); // chrome grouphead
      c.rect(cx0 + 122, py + 34, 8, 4, hex("#f7f2e8")); // espresso cup
      c.rect(cx0 + 132, py + 34, 8, 4, hex("#f7f2e8")); // espresso cup
      c.box(cx0 + 152, py + 18, 12, 22, hex("#404752"), INK, 2); // coffee grinder
      c.circle(cx0 + 158, py + 16, 5, hex("#5c3a22")); // coffee bean hopper!
    } else if (p.k === "dining") {
      // Modern Light-Oak Studio Cafe Dining Table & Sage Cushioned Chairs (x=4..7, y=8..9)!
      c.rect(px + 6, py + 12, pw - 12, ph - 8, SHADOW);
      // 4 Modern Scandinavian Dining Chairs (2 north, 2 south)
      for (const ox of [20, pw - 44]) {
        // North chair (facing south)
        c.borderedRoundRect(px + ox, py - 10, 24, 18, 4, hex("#689472"), INK, 2);
        c.rect(px + ox + 4, py - 8, 16, 4, hex("#89b592"));
        // South chair (facing north)
        c.borderedRoundRect(px + ox, py + ph - 10, 24, 18, 4, hex("#689472"), INK, 2);
        c.rect(px + ox + 3, py + ph + 2, 18, 4, hex("#496e52"));
      }
      // Sleek light-oak rounded tabletop
      c.borderedRoundRect(px + 6, py + 4, pw - 12, ph - 12, 6, hex("#d6a974"), INK, 2);
      c.rect(px + 10, py + 7, pw - 20, 4, hex("#e8c392"));
      // Minimalist linen runner + pour-over coffee carafe + pastry plate + bud vase
      c.rect(px + Math.floor(pw / 2) - 14, py + 6, 28, ph - 16, hex("#f4efe4"));
      c.circle(px + Math.floor(pw / 2), py + 20, 6, hex("#5a3924")); // glass coffee carafe
      c.circle(px + Math.floor(pw / 2), py + 20, 3, hex("#966341"));
      c.circle(px + Math.floor(pw / 2) - 24, py + 24, 6, hex("#fbf8f2")); // ceramic plate
      c.circle(px + Math.floor(pw / 2) - 24, py + 24, 3, hex("#d99a54")); // croissant!
      c.circle(px + Math.floor(pw / 2) + 22, py + 22, 4, hex("#7ab86b")); // tiny bud vase
      c.rect(px + Math.floor(pw / 2) + 21, py + 17, 3, 3, hex("#ffe066"));
    } else if (p.k === "bath") {
      // IMAGE 2: Modern Boutique Studio Restroom / Toilet (x=2..8, y=12..14)!
      // A) Left half (x=2..3, y=13..14): Modern Frameless Glass Walk-In Rain Shower!
      const sw = 62, sh = 60;
      c.box(px + 2, py + 2, sw, sh, hex("#d5e2df"), hex("#47545c"), 2);
      // Warm slatted teak shower floor duckboard + chrome linear drain
      for (let sy = py + 8; sy < py + sh - 8; sy += 8) {
        c.rect(px + 8, sy, sw - 16, 5, hex("#c29362"));
        c.rect(px + 8, sy, sw - 16, 1, hex("#dbb07e"));
      }
      c.rect(px + 10, py + sh - 10, sw - 20, 4, hex("#8b969e")); // linear chrome drain
      // Chrome rain showerhead & frosted glass right divider panel
      c.circle(px + 24, py + 18, 6, hex("#e3eaee"));
      c.ring(px + 24, py + 18, 6, 4, hex("#5c6670"));
      c.rect(px + sw - 2, py + 2, 4, sh, hex("#78b4c4", 190)); // sleek glass partition

      // B) Right half of bath prop (x=4..5, y=13..14): Modern Ceramic Flush Toilet (WC)!
      const tx = px + 78, ty = py + 4;
      c.rect(tx + 2, ty + 6, 36, 48, SHADOW_SOFT);
      // Clean porcelain cistern tank against wall
      c.borderedRoundRect(tx + 4, ty, 30, 14, 3, hex("#f7f9fa"), INK, 2);
      c.rect(tx + 14, ty + 4, 10, 4, hex("#3c434a")); // matte-black dual-flush plate!
      // Contoured ceramic oval bowl & soft-close seat
      c.ellipse(tx + 19, ty + 30, 14, 18, INK);
      c.ellipse(tx + 19, ty + 30, 12, 16, hex("#ffffff"));
      c.ellipse(tx + 19, ty + 31, 8, 11, hex("#dce5e8"));
      c.ellipse(tx + 19, ty + 31, 6, 8, hex("#bfe0eb")); // clean water inside bowl
      // Wall-mounted matte-black toilet roll holder beside WC
      c.box(tx + 38, ty + 14, 8, 12, hex("#fafaf7"), INK, 1);

      // C) Modern Floating Oak Vanity with Dual Vessel Sinks & Backlit LED Mirror (x=6..8, y=12)!
      const vx = px + pw + 8, vy = py - 28, vw = 90, vh = 32;
      c.rect(vx + 2, vy + 6, vw, vh, SHADOW);
      // Backlit modern vanity mirror along wall above vanity
      c.box(vx + 6, vy - 10, vw - 12, 10, hex("#cfe8f0"), hex("#3a424a"), 1);
      c.rect(vx + 8, vy - 2, vw - 16, 2, hex("#fff5d1")); // warm LED backlight strip!
      // Oak vanity cabinet + crisp white marble countertop
      c.box(vx, vy, vw, vh, hex("#c29463"), INK, 2);
      c.box(vx + 2, vy + 2, vw - 4, vh - 8, hex("#f6f5f0"), hex("#a8a49c"), 1);
      // Twin ceramic vessel basins + matte-black minimalist faucets
      for (const sx of [vx + 24, vx + 66]) {
        c.circle(sx, vy + 14, 10, hex("#4b525a"));
        c.circle(sx, vy + 14, 8, hex("#ffffff"));
        c.circle(sx, vy + 14, 5, hex("#d6e4e8"));
        c.rect(sx - 2, vy + 3, 4, 7, hex("#2b3036")); // matte-black faucet
      }
      // Neatly folded white spa towels & soap bottle between sinks
      c.box(vx + 40, vy + 8, 10, 10, hex("#ffffff"), hex("#9ca4ac"), 1);
      c.box(vx + 43, vy + 20, 4, 6, hex("#5e9478"), INK, 1);
      // Soft woven sage bath mat on floor in front of vanity
      c.borderedRoundRect(vx + 14, vy + 42, 62, 22, 4, hex("#7aa188"), hex("#4c6e58"), 2);
      c.rect(vx + 20, vy + 47, 50, 12, hex("#93b89f"));
    } else if (p.k === "bed") {
      // IMAGE 3: Modern Executive Studio Daybed / Lounge Sofa-Bed (x=2..3, y=19..22 — ZERO dark shadow box!)
      c.rect(px + 6, py + 12, pw - 8, ph - 16, SHADOW_SOFT);
      // Sleek round walnut bedside table + glowing warm brass lamp above bed (x=2, y=18)
      c.circle(px + 20, py - 14, 12, INK);
      c.circle(px + 20, py - 14, 10, hex("#7d5034"));
      c.circle(px + 20, py - 14, 5, hex("#f7d674")); // warm brass bedside lamp!
      c.circle(px + 20, py - 14, 2, hex("#fffbe0"));
      // Modern tailored walnut platform bed frame
      c.borderedRoundRect(px + 4, py + 6, pw - 8, ph - 14, 5, hex("#734930"), INK, 2);
      // Crisp tailored ivory duvet + upholstered charcoal headboard
      c.box(px + 8, py + 10, pw - 16, 12, hex("#495057"), INK, 1);
      c.borderedRoundRect(px + 8, py + 22, pw - 16, ph - 34, 4, hex("#f5f1e8"), hex("#a89f91"), 2);
      // Plush twin ivory pillows
      c.borderedRoundRect(px + 11, py + 25, 19, 14, 3, hex("#ffffff"), hex("#c7bfb2"), 1);
      c.borderedRoundRect(px + 34, py + 25, 19, 14, 3, hex("#ffffff"), hex("#c7bfb2"), 1);
      // Folded modern sage-slate throw blanket across foot of bed
      c.box(px + 10, py + ph - 42, pw - 20, 26, hex("#54786b"), hex("#375248"), 2);
      c.rect(px + 12, py + ph - 38, pw - 24, 4, hex("#71998a"));
    } else if (p.k === "lounge") {
      // IMAGE 1: Realistic 3/4 Top-Down Breakout Lounge — Smart TV on NORTH facing SOUTH into the room, Plush Sofa on SOUTH facing NORTH toward the TV!
      // 1) Large ornate crimson & gold woven Stardew rug!
      paintStardewCarpet(c, px + 44, py + 24, pw - 72, ph - 40);
      // 2) Brick Hearth Fireplace along left wall (x=11..12, y=19..22 — aligned with live firelight!)
      paintStardewHearth(c, px + 4, py + 34, 48, 86);
      // 3) Sleek Walnut TV Media Console + Wide Flat-Screen Smart TV at NORTH side facing SOUTH toward sofa!
      const tvX = px + 96, tvY = py + 12, tvW = 116, tvH = 26;
      c.rect(tvX + 4, tvY + 14, tvW, 20, SHADOW);
      // Low-profile mid-century walnut media console
      c.borderedRoundRect(tvX, tvY + 10, tvW, 22, 3, hex("#6e4428"), INK, 2);
      c.rect(tvX + 4, tvY + 12, tvW - 8, 5, hex("#96613c"));
      c.box(tvX + 6, tvY + 20, 30, 8, hex("#54331d"), hex("#382011"), 1);
      c.box(tvX + tvW - 36, tvY + 20, 30, 8, hex("#54331d"), hex("#382011"), 1);
      c.box(tvX + 42, tvY + 19, 32, 6, hex("#252a32"), INK, 1); // matte-black soundbar facing room!
      c.rect(tvX + 56, tvY + 21, 4, 2, hex("#68e38a")); // green power LED
      // Wide Flat-Screen Smart TV facing SOUTH into the lounge (crisp dark bezel + vivid glowing display!)
      c.borderedRoundRect(tvX + 12, tvY - 12, tvW - 24, 25, 3, hex("#1c222b"), INK, 2);
      c.rect(tvX + 16, tvY - 8, tvW - 32, 17, hex("#4aa4d8")); // sunlit sky
      c.rect(tvX + 16, tvY + 2, tvW - 32, 7, hex("#54ad4e")); // valley hills
      c.circle(tvX + 30, tvY - 3, 3, hex("#ffe675")); // warm sun
      c.rect(tvX + 58, tvY - 3, 14, 8, hex("#c9543e")); // cozy cottage on TV!
      c.rect(tvX + 61, tvY - 1, 4, 3, hex("#ffe99c"));
      c.line(tvX + 20, tvY - 7, tvX + 30, tvY + 7, 2, hex("#ffffff", 90)); // subtle glass sheen
      c.rect(tvX + Math.floor(tvW / 2) - 5, tvY + 11, 10, 5, hex("#2e343d")); // stand neck
      // 4) Modern Walnut Coffee Table centered between TV & South Sofa!
      c.rect(px + 106, py + 76, 96, 34, SHADOW);
      c.borderedRoundRect(px + 104, py + 70, 96, 36, 5, hex("#8f5932"), INK, 2);
      c.rect(px + 108, py + 73, 88, 4, hex("#b87a4a"));
      c.circle(px + 124, py + 86, 5, hex("#f7f2e8")); // coffee mug
      c.circle(px + 124, py + 86, 3, hex("#5c351c"));
      c.borderedRoundRect(px + 144, py + 80, 22, 12, 3, hex("#2c323b"), INK, 1); // game controller!
      c.rect(px + 148, py + 84, 4, 4, hex("#68d67a"));
      c.rect(px + 158, py + 84, 4, 4, hex("#ff7070"));
      c.circle(px + 182, py + 87, 5, hex("#f7f2e8")); // snack plate
      c.circle(px + 182, py + 87, 2.5, hex("#e5a44c"));
      // 5) Plush 3-Seater Sage Sofa at SOUTH side facing NORTH directly toward the TV + East Loveseat facing WEST!
      paintStardewSofa(c, px + 88, py + ph - 50, 132, 38, "north");
      paintStardewSofa(c, px + pw - 50, py + 54, 40, 74, "west");
    } else if (p.k === "meeting") {
      // IMAGE 5: Relocated Modern-Cozy Community Standup Conference Table (x=30..33, y=12..13 — clear of front door!)
      c.rect(px + 4, py + 10, pw - 8, ph - 8, SHADOW);
      // 6 ergonomic conference chairs tucked north & south
      for (const ox of [14, 50, 86]) {
        c.blit(SHEETS.country, 64, 0, 32, 32, px + ox, py - 12, { grade: GRADE.stardewWood });
        c.blit(SHEETS.country, 64, 32, 32, 32, px + ox, py + ph - 16, { grade: GRADE.stardewWood });
      }
      // Sleek oak conference table with warm beveled top & center cable hub
      c.borderedRoundRect(px + 2, py + 6, pw - 4, ph - 14, 6, hex("#c28a52"), INK, 2);
      c.rect(px + 6, py + 9, pw - 12, 4, hex("#dfa96e"));
      c.box(px + Math.floor(pw / 2) - 22, py + 24, 44, 10, hex("#3c434d"), hex("#22262c"), 1); // recessed power/HDMI hub!
      // Presentation tablet/notebook + coffee cups
      c.box(px + 22, py + 16, 18, 13, hex("#fbf4e2"), hex("#6b4a2e"), 1);
      c.box(px + pw - 42, py + 28, 18, 12, hex("#384252"), INK, 1);
      c.rect(px + pw - 40, py + 30, 14, 8, hex("#7db5e8")); // glowing tablet chart
      c.circle(px + 48, py + 18, 3, hex("#f7f2e8"));
      c.circle(px + pw - 20, py + 18, 3, hex("#f7f2e8"));
    } else if (p.k === "board") {
      // Iconic Stardew Valley Pelican Town "Help Wanted" Bulletin Board!
      paintHelpWantedBoard(c, px, py, pw, ph);
    } else if (p.k === "server") {
      // IMAGE 6: Sleek Unified Modern Walnut & Matte-Charcoal AI Engine Tower Cabinet (x=27..28, y=3..6 — clean separation from wall clock!)
      const sx = px + 4, sy = py + 10, sw = pw - 10, sh = ph - 16; // 54x112 crisp unified rack cabinet
      c.rect(sx + 4, sy + 8, sw, sh, SHADOW);
      // Outer warm walnut architectural enclosure
      c.borderedRoundRect(sx, sy, sw, sh, 4, hex("#6b442a"), INK, 2);
      // Top beveled walnut lid with cooling vent slots
      c.box(sx + 2, sy + 2, sw - 4, 14, hex("#8f5d3c"), hex("#472a17"), 1);
      for (let vx = sx + 8; vx < sx + sw - 10; vx += 8) {
        c.rect(vx, sy + 6, 4, 5, hex("#362013"));
      }
      // Recessed matte-charcoal tempered glass equipment bay
      c.box(sx + 6, sy + 18, sw - 12, sh - 26, hex("#232830"), hex("#12151a"), 2);
      // 4 Clean Horizontal Codex / AI Compute Blades with crisp status LEDs & airflow mesh
      for (let bi = 0; bi < 4; bi++) {
        const by = sy + 24 + bi * 20;
        c.box(sx + 10, by, sw - 20, 15, hex("#323944"), hex("#181c22"), 1);
        c.rect(sx + 13, by + 3, 14, 3, hex("#4b5563")); // intake louver
        c.rect(sx + 13, by + 8, 14, 3, hex("#4b5563"));
        // Crisp glowing emerald & cyan LED indicators
        c.rect(sx + sw - 22, by + 5, 4, 4, hex("#5be882"));
        c.rect(sx + sw - 16, by + 5, 4, 4, bi === 1 ? hex("#fbd35c") : hex("#6ad6f2"));
      }
      // Subtle diagonal glass door reflection + brass handle
      c.line(sx + 10, sy + 24, sx + 22, sy + 42, 2, hex("#ffffff", 45));
      c.rect(sx + sw - 9, sy + 52, 2, 16, hex("#d9b15f"));
    } else if (p.k === "coffee") {
      // Cozy Stardew Coffee & Tea Sideboard (x=34..36, y=3..4)!
      c.rect(px + 4, py + 14, pw - 8, ph - 10, SHADOW);
      c.blit(SHEETS.cabinets, 96, 266, 64, 38, px + 2, py + 10, { dw: pw - 4, dh: ph - 14, grade: GRADE.stardewWood });
      c.box(px + 14, py + 4, 18, 16, hex("#c86e3c"), INK, 2);
      c.rect(px + 18, py + 7, 6, 4, hex("#f0a672"));
      c.blit(SHEETS.cabinets, 128, 64, 32, 32, px + 44, py + 4);
      c.blit(SHEETS.cabinets, 160, 64, 32, 32, px + 68, py + 8);
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
      // IMAGE 4: Modern Garage Heavy-Duty Racks, Stacked Totes, Spare Alloy Tire & Wall EV Charger (x=44..45, y=8..16)!
      // Top steel rack with labeled modern storage bins
      for (const oy of [6, 72]) {
        c.rect(px + 8, py + oy + 6, 48, 54, SHADOW);
        c.box(px + 6, py + oy, 50, 56, hex("#3d444e"), INK, 2);
        c.box(px + 10, py + oy + 6, 42, 20, hex("#597896"), hex("#2c3e50"), 1);
        c.rect(px + 22, py + oy + 12, 18, 5, hex("#f5efe2")); // white label
        c.box(px + 10, py + oy + 30, 42, 20, hex("#d99a3b"), hex("#7a5116"), 1);
        c.rect(px + 22, py + oy + 36, 18, 5, hex("#f5efe2"));
      }
      // Stacked Spare Rubber Tire with Metallic Alloy Rim!
      c.circle(px + 32, py + 162, 20, INK);
      c.circle(px + 32, py + 162, 18, hex("#2b2f36"));
      c.circle(px + 32, py + 162, 10, hex("#b8c2cc"));
      c.circle(px + 32, py + 162, 4, hex("#4a525c"));
      // Modern EV Wallbox Charger beside Car Bay (glowing emerald LED ring + coiled cable!)
      c.rect(px + 12, py + 206, 38, 48, SHADOW);
      c.borderedRoundRect(px + 10, py + 200, 38, 50, 6, hex("#eef2f5"), INK, 2);
      c.box(px + 16, py + 208, 26, 20, hex("#282e36"), hex("#5e6873"), 1);
      c.ring(px + 29, py + 218, 6, 4, hex("#4ce37d")); // glowing emerald EV ready ring!
      c.line(px + 10, py + 236, px - 6, py + 252, 3, hex("#262b31")); // coiled EV cable
    } else if (p.k === "bike") {
      // IMAGE 4: REAL Detailed Pixel-Art Bicycle with Round Spoked Wheels, Diamond Frame & Handlebars (x=40..42, y=8..9)!
      const yWheel = py + 39;
      const xRear = px + 24;
      const xFront = px + pw - 24;
      const rWheel = 15;
      // Ground shadow beneath tires
      c.ellipse(xRear, yWheel + 13, 14, 4, SHADOW);
      c.ellipse(xFront, yWheel + 13, 14, 4, SHADOW);
      // Two genuinely ROUND black rubber tires + aluminum rims + hubs + wire spokes!
      for (const wx of [xRear, xFront]) {
        c.ring(wx, yWheel, rWheel, rWheel - 3, hex("#20242a")); // rubber tire
        c.ring(wx, yWheel, rWheel - 3, rWheel - 5, hex("#cfd6de")); // alloy rim
        // 8 crisp silver spokes
        for (let a = 0; a < 4; a++) {
          const ang = (a * Math.PI) / 4;
          const dx = Math.cos(ang) * (rWheel - 4), dy = Math.sin(ang) * (rWheel - 4);
          c.line(wx - dx, yWheel - dy, wx + dx, yWheel + dy, 1, hex("#9ba5b0", 190));
        }
        c.circle(wx, yWheel, 3, hex("#4b535e")); // hub
      }
      // Authentic Diamond Road/City Bicycle Frame (Teal-Emerald metallic tubes!)
      const frame = hex("#2f9c8c");
      const frameHi = hex("#5ec9b6");
      const bbX = px + 46, bbY = yWheel; // bottom bracket / crank
      const seatTopX = px + 38, seatTopY = py + 17;
      const headTopX = px + pw - 32, headTopY = py + 16;
      const headBotX = px + pw - 29, headBotY = py + 24;
      // Chainstay & seatstay (rear triangle)
      c.line(xRear, yWheel, bbX, bbY, 2.5, hex("#23272e")); // chain!
      c.line(xRear, yWheel, seatTopX, seatTopY, 3, frame);
      // Main diamond triangle (seat tube, top tube, down tube)
      c.line(bbX, bbY, seatTopX, seatTopY, 3.5, frame);
      c.line(seatTopX, seatTopY, headTopX, headTopY, 3.5, frame);
      c.line(seatTopX, seatTopY - 1, headTopX, headTopY - 1, 1.2, frameHi);
      c.line(bbX, bbY, headBotX, headBotY, 3.5, frame);
      // Front fork to front axle
      c.line(headTopX, headTopY, xFront, yWheel, 3, frame);
      // Crankset & pedal
      c.circle(bbX, bbY, 5, hex("#454d57"));
      c.circle(bbX, bbY, 2, hex("#cfd6de"));
      // Seatpost & sculpted leather saddle
      c.line(seatTopX, seatTopY, seatTopX - 2, py + 10, 2.5, hex("#c8d0d8"));
      c.borderedRoundRect(seatTopX - 11, py + 6, 17, 6, 3, hex("#5c3a24"), INK, 1);
      // Stem, curved handlebars & front LED headlight!
      c.line(headTopX, headTopY, headTopX + 2, py + 8, 2.5, hex("#c8d0d8"));
      c.line(headTopX - 4, py + 8, headTopX + 9, py + 10, 3, hex("#2a2f36"));
      c.circle(headTopX + 10, py + 13, 3, hex("#ffe680")); // chrome/LED headlight!
    } else if (p.k === "car") {
      // IMAGE 4: REAL Detailed Top-Down Pixel-Art Modern Sporty Car (Crimson Metallic Hatchback/SUV, x=40..43, y=15..21)!
      const cx = px + 14, cy = py + 14, cw = pw - 28, ch = ph - 28; // 100x196 px modern vehicle!
      // Soft grounded drop shadow
      c.roundRect(cx - 2, cy + 5, cw + 8, ch + 4, 22, SHADOW);
      // 4 Curved Black Rubber Tires tucked cleanly into wheel arches!
      for (const [tx, ty] of [
        [cx - 4, cy + 28], [cx + cw - 5, cy + 28],
        [cx - 4, cy + ch - 62], [cx + cw - 5, cy + ch - 62],
      ]) {
        c.borderedRoundRect(tx, ty, 9, 34, 4, hex("#1f2329"), INK, 1);
        c.rect(tx + 2, ty + 6, 2, 22, hex("#3c434d"));
      }
      // Sculpted Metallic Crimson Car Body (outer outline + deep side bevel + bright hood/roof sheen!)
      const paint = hex("#c93838");
      const paintHi = hex("#e55852");
      const paintDark = hex("#8a1e22");
      c.borderedRoundRect(cx, cy, cw, ch, 20, paint, INK, 2);
      // Subtle metallic side shading & body-line highlights
      c.roundRect(cx + 4, cy + 4, cw - 8, ch - 8, 17, paintHi);
      c.roundRect(cx + 10, cy + 8, cw - 20, ch - 16, 13, paint);
      // Sculpted hood character creases (south end = front facing garage door!)
      c.rect(cx + 22, cy + ch - 48, 3, 34, paintHi);
      c.rect(cx + cw - 25, cy + ch - 48, 3, 34, paintHi);
      // Side wing mirrors (left & right near front windshield!)
      c.borderedRoundRect(cx - 10, cy + ch - 74, 12, 9, 3, paint, INK, 2);
      c.borderedRoundRect(cx + cw - 2, cy + ch - 74, 12, 9, 3, paint, INK, 2);

      // Cabin Greenhouse: Rear Window (north), Panoramic Sunroof (center), Curved Front Windshield (south)!
      // Rear window (north end)
      c.borderedRoundRect(cx + 15, cy + 20, cw - 30, 24, 7, hex("#2c3c4c"), INK, 2);
      c.line(cx + 22, cy + 24, cx + 34, cy + 38, 3, hex("#6a94b8", 160));
      // Roof & Panoramic Tinted Glass Sunroof
      c.borderedRoundRect(cx + 13, cy + 46, cw - 26, 68, 8, paintHi, paintDark, 2);
      c.borderedRoundRect(cx + 20, cy + 54, cw - 40, 48, 6, hex("#23303d"), hex("#141a21"), 2);
      c.line(cx + 26, cy + 62, cx + 56, cy + 92, 5, hex("#5983a8", 120)); // glass reflection!
      c.line(cx + 42, cy + 60, cx + 64, cy + 82, 2, hex("#9ac4e6", 110));
      // Sleek roof rails & shark-fin antenna
      c.rect(cx + 14, cy + 48, 3, 64, hex("#3c434d"));
      c.rect(cx + cw - 17, cy + 48, 3, 64, hex("#3c434d"));
      c.box(cx + Math.floor(cw / 2) - 2, cy + 48, 4, 8, hex("#262b31"), INK, 1);

      // Large Curved Front Windshield (south half, facing garage door!)
      c.borderedRoundRect(cx + 13, cy + 116, cw - 26, 30, 8, hex("#2c3c4c"), INK, 2);
      c.line(cx + 20, cy + 122, cx + 38, cy + 140, 4, hex("#7ab2db", 170));
      c.line(cx + 34, cy + 121, cx + 48, cy + 135, 2, hex("#c2e3fa", 160));
      // Wiper blades at base of windshield
      c.line(cx + 22, cy + 142, cx + 42, cy + 138, 2, hex("#181c20"));
      c.line(cx + 52, cy + 142, cx + 74, cy + 138, 2, hex("#181c20"));

      // Door panel seams & chrome handles
      c.rect(cx + 5, cy + 82, 4, 2, paintDark);
      c.rect(cx + cw - 9, cy + 82, 4, 2, paintDark);
      c.rect(cx + 6, cy + 96, 3, 8, hex("#e3e8ee"));
      c.rect(cx + cw - 9, cy + 96, 3, 8, hex("#e3e8ee"));

      // Rear LED Tail Light Bar (north bumper) + License Plate
      c.box(cx + 14, cy + 4, 22, 6, hex("#ff4a4a"), hex("#5e1010"), 1);
      c.box(cx + cw - 36, cy + 4, 22, 6, hex("#ff4a4a"), hex("#5e1010"), 1);
      c.rect(cx + 38, cy + 5, cw - 76, 4, hex("#d42c2c"));
      c.box(cx + Math.floor(cw / 2) - 10, cy + 1, 20, 4, hex("#f4f6f8"), INK, 1);

      // Front LED Headlights + Modern Grille (south nose facing garage roller door!)
      c.borderedRoundRect(cx + 12, cy + ch - 12, 22, 8, 3, hex("#fff9d6"), hex("#4a4f57"), 1);
      c.borderedRoundRect(cx + cw - 34, cy + ch - 12, 22, 8, 3, hex("#fff9d6"), hex("#4a4f57"), 1);
      c.rect(cx + 16, cy + ch - 9, 14, 3, hex("#ffffff"));
      c.rect(cx + cw - 30, cy + ch - 9, 14, 3, hex("#ffffff"));
      c.borderedRoundRect(cx + 36, cy + ch - 9, cw - 72, 6, 2, hex("#242930"), INK, 1);
      c.circle(cx + Math.floor(cw / 2), cy + ch - 6, 2, hex("#d6dde6")); // chrome emblem
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
  ["chair-north@2x.png", generateChair("north")],
  ["chair-south@2x.png", generateChair("south")],
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
