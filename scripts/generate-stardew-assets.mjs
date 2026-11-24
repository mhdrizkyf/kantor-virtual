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

function paintStardewGrassArea(c, tx0, ty0, tw, th, seed = 101) {
  const r = rng(seed);
  // Tile real Sharm LPC 32x32 hand-pixeled grass tiles with natural texture variety
  for (let ty = ty0; ty < ty0 + th; ty++) {
    for (let tx = tx0; tx < tx0 + tw; tx++) {
      const n = r();
      if (n < 0.56) {
        c.blit(SHEETS.grass, 32, 96, 32, 32, tx * S, ty * S, { grade: GRADE.stardewGrass });
      } else if (n < 0.72) {
        c.blit(SHEETS.grass, 0, 160, 32, 32, tx * S, ty * S, { grade: GRADE.stardewGrass });
      } else if (n < 0.88) {
        c.blit(SHEETS.grass, 32, 160, 32, 32, tx * S, ty * S, { grade: GRADE.stardewGrass });
      } else {
        c.blit(SHEETS.grass, 64, 160, 32, 32, tx * S, ty * S, { grade: GRADE.stardewGrass });
      }
      // Subtle Stardew wildflowers (tulips, dandelions, blue jazz, daisies)
      const f = r();
      if (f < 0.24) {
        const fx = tx * S + 6 + Math.floor(r() * 18);
        const fy = ty * S + 8 + Math.floor(r() * 16);
        const palette = [hex("#fff4b2"), hex("#ff9ab2"), hex("#9ad8ff"), hex("#fffaf0"), hex("#ffd24d")];
        const col = palette[Math.floor(r() * palette.length)];
        c.rect(fx + 2, fy + 4, 2, 4, hex("#3c742e"));
        c.rect(fx, fy + 2, 6, 2, col);
        c.rect(fx + 2, fy, 2, 6, col);
        c.rect(fx + 2, fy + 2, 2, 2, hex("#e89a25"));
      }
    }
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

/** Paint a Stardew Valley cozy green cottage sofa facing South, North, or West. */
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
  } else {
    // Cozy side armchair
    c.box(x, y, w, h, fabric, INK, 2);
    c.box(x + w - 12, y, 12, h, trim, INK, 2);
    c.box(x, y, w - 8, 10, fabricSh, INK, 2);
    c.box(x, y + h - 10, w - 8, 10, fabricSh, INK, 2);
    c.rect(x + 4, y + 13, w - 18, h - 26, fabricHi);
  }
}

/* ---------- 1. Compose Main Stardew Valley Farmhouse Floor (1536x896) ---------- */
function generateFarmhouseBackground() {
  const c = new Canvas(W, H);

  // STEP A: Lush Stardew Spring meadow across the entire 48x28 canvas exterior
  paintStardewGrassArea(c, 0, 0, PLAN.cols, PLAN.rows, 404);

  // STEP B: Pelican Town dirt village road along bottom (y=26..27) + front stone path (x=21..24, y=24..26)
  paintStardewDirtRoad(c, 0, 26, PLAN.cols, 2, 505);
  paintStardewDirtRoad(c, 21, 24, 4, 2, 509);
  // Stepping stones leading up to front porch from dirt2.png
  c.blit(SHEETS.dirt2, 0, 0, 32, 64, 22 * S, 25 * S, { grade: GRADE.stardewDirt });

  // STEP C: Iconic Stardew Duck Pond in North-East meadow (x=37..39, y=0..1) from real watergrass.png!
  c.blit(SHEETS.watergrass, 0, 64, 96, 96, 37 * S, -16, { dw: 96, dh: 76, grade: GRADE.stardewWater });

  // STEP D: Stardew Valley Tilled Crop Plots & Wooden Farm Fences in North & South gardens!
  paintStardewCropPlot(c, 4 * S, 6, 5, 2, ["parsnip", "cauliflower", "strawberry", "parsnip", "sunflower"]);
  paintStardewCropPlot(c, 21 * S, 6, 5, 2, ["strawberry", "parsnip", "sunflower", "cauliflower", "strawberry"]);
  paintStardewCropPlot(c, 3 * S, 25 * S + 2, 4, 1, ["parsnip", "strawberry", "cauliflower", "sunflower"]);
  paintStardewCropPlot(c, 28 * S, 25 * S + 2, 5, 1, ["sunflower", "parsnip", "strawberry", "cauliflower", "parsnip"]);

  // Real LPC wooden fences from bridges.png along garden borders
  for (const fx of [11, 12, 13, 14, 15, 29, 30, 31, 32, 33]) {
    c.blit(SHEETS.bridges, 96, 96, 32, 32, fx * S, 18, { grade: GRADE.stardewWood });
  }
  for (const fx of [10, 11, 12, 13, 14, 15, 16, 17, 36, 37, 38, 39, 40]) {
    c.blit(SHEETS.bridges, 96, 96, 32, 32, fx * S, 25 * S - 6, { grade: GRADE.stardewWood });
  }
  // Decorative farm rocks from rock.png
  c.blit(SHEETS.rock, 0, 0, SHEETS.rock.w, SHEETS.rock.h, 16 * S + 8, 22, { dw: 42, dh: 22 });
  c.blit(SHEETS.rock, 0, 0, SHEETS.rock.w, SHEETS.rock.h, 42 * S, 25 * S + 4, { dw: 36, dh: 18 });

  // STEP E: Farmhouse Interior Floors (100% aligned to OFFICE_PLAN walls!)
  // 1) Main Studio Floor (x=11..37, y=3..23) — Iconic Stardew Valley Honey-Oak Planks!
  paintHoneyOakFloor(c, 11, 3, 27, 21, "honey");
  // 2) Owner's Study & Bedroom (x=2..9, y=17..23) — Warm Cedar Planks!
  paintHoneyOakFloor(c, 2, 17, 8, 7, "cedar");
  // 3) Kitchen & Dining (x=2..9, y=3..10) — Warm Checkered Terracotta & Butter-Cream Cottage Tiles!
  paintKitchenFloor(c, 2, 3, 8, 8);
  // 4) Bathhouse / Spa (x=2..9, y=12..15) — Soft Stardew Spa Stone Tiles from castlefloors.png!
  for (let ty = 12; ty <= 15; ty++) {
    for (let tx = 2; tx <= 9; tx++) {
      c.blit(SHEETS.castlefloors, 192, 64, 32, 32, tx * S, ty * S, { grade: GRADE.stardewSpaTile });
    }
  }
  // 5) East Wing Farm Shed / Barn (x=39..45, y=3..23) — Warm Weathered Barn Cobblestones from castlefloors.png!
  for (let ty = 3; ty <= 23; ty++) {
    for (let tx = 39; tx <= 45; tx++) {
      const sx = 160 + ((tx + ty) % 3) * 32;
      c.blit(SHEETS.castlefloors, sx, 160, 32, 32, tx * S, ty * S, { grade: GRADE.stardewBarnStone });
    }
  }
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

  // Front Farmhouse Entrance Doorway (x=22..23, y=24) — warm welcome mat + porch lanterns + wooden steps!
  c.blit(SHEETS.bridges, 0, 96, 64, 32, 22 * S, 24 * S + 10, { grade: GRADE.stardewWood });
  // Woven welcome mat inside doorway
  c.box(22 * S + 8, 23 * S + 10, 48, 20, hex("#c89352"), hex("#6b401e"), 2);
  c.rect(22 * S + 12, 23 * S + 14, 40, 12, hex("#d9a96a"));
  // Flanking brass porch torches/lanterns from lights.png
  c.blit(SHEETS.lights, 0, 0, 32, 32, 21 * S + 8, 24 * S - 6);
  c.blit(SHEETS.lights, 0, 0, 32, 32, 24 * S - 8, 24 * S - 6);

  // Iconic Stardew Valley Shipping Bin (real chests.png!) + Farmhouse Mailbox right beside front porch!
  c.blit(SHEETS.chests, 0, 0, 32, 32, 20 * S - 6, 25 * S - 6, { dw: 36, dh: 34, grade: GRADE.stardewWood });
  // Little Stardew wooden mailbox at x=25, y=25
  c.box(25 * S + 8, 25 * S + 10, 6, 18, hex("#7d4824"), INK, 1);
  c.box(25 * S + 3, 25 * S + 2, 16, 12, hex("#c8a878"), INK, 2);
  c.rect(25 * S + 15, 25 * S + 4, 3, 6, hex("#d9443e")); // red mail flag!

  // STEP G: Paint EVERY Interior Prop in OFFICE_PLAN using Real Open-Source LPC Sprites!
  // 1) Owner's Study Rug (under bed/study zone)
  paintStardewCarpet(c, 4 * S + 4, 18 * S + 12, 5 * S - 8, 3 * S);
  // Owner's study bookshelf along north wall of study (x=6..7, y=17)
  c.blit(SHEETS.cabinets, 32, 0, 32, 64, 6 * S, 16 * S + 22, { grade: GRADE.stardewWood });
  c.blit(SHEETS.cabinets, 64, 0, 32, 64, 7 * S, 16 * S + 22, { grade: GRADE.stardewWood });

  for (const p of PLAN.props) {
    const px = p.x * S, py = p.y * S, pw = p.w * S, ph = p.h * S;

    if (p.k === "kitchen") {
      // Authentic Stardew Farmhouse Kitchen (x=2..8, y=4..6)!
      // Clean cropped wood counters (cabinets.png y=266..304, skipping row 7 glass-cabinet edge!)
      for (let i = 0; i < 4; i++) {
        c.blit(SHEETS.cabinets, 96, 266, 64, 38, px + 64 + i * 38, py + 28, { dw: 40, dh: 38, grade: GRADE.stardewWood });
      }
      // Real LPC hanging skillets, pots & ladle rack + ceramic dishes cabinet on north wall!
      c.blit(SHEETS.kitchen, 32, 64, 32, 32, px + 34, py - 18);
      c.blit(SHEETS.cabinets, 96, 0, 32, 64, px + 148, py - 24, { grade: GRADE.stardewWood });
      c.blit(SHEETS.cabinets, 32, 0, 32, 64, px + 180, py - 24, { grade: GRADE.stardewWood });
      // Real LPC Cast-Iron Woodstove WITH GLOWING FIRE + neat interior stovepipe!
      c.blit(SHEETS.kitchen, 0, 16, 32, 112, px + 4, py - 20);
      c.blit(SHEETS.kitchen, 32, 96, 32, 32, px + 36, py + 30);
      // Real LPC Ceramic Farmhouse Sink & Faucet
      c.blit(SHEETS.kitchen, 32, 0, 32, 32, px + 96, py + 24);
      // Ceramic tea set on kitchen counter
      c.blit(SHEETS.cabinets, 128, 64, 32, 32, px + 150, py + 24);
      // Wooden bucket beside stove
      c.blit(SHEETS.buckets, 0, 32, 32, 32, px + 4, py + 62);
    } else if (p.k === "dining") {
      // Cozy Farmhouse Dining Table (real cabinets.png clean table + country.png chairs + lace doily + tea set!)
      c.rect(px + 6, py + 14, pw - 12, ph - 10, SHADOW);
      // Chairs behind table
      c.blit(SHEETS.country, 64, 0, 32, 32, px + 16, py - 12, { grade: GRADE.stardewWood });
      c.blit(SHEETS.country, 64, 0, 32, 32, px + pw - 48, py - 12, { grade: GRADE.stardewWood });
      // Hand-pixeled wood plank dining table (clean y=266..304 crop!)
      c.blit(SHEETS.cabinets, 96, 266, 64, 38, px + 4, py + 6, { dw: pw - 8, dh: ph - 14, grade: GRADE.stardewWood });
      // Lace doily + ceramic tea service in center!
      c.blit(SHEETS.cabinets, 128, 32, 32, 32, px + Math.floor(pw / 2) - 16, py + 6);
      c.blit(SHEETS.cabinets, 128, 64, 32, 32, px + Math.floor(pw / 2) - 14, py + 8);
      // Front chairs
      c.blit(SHEETS.country, 64, 32, 32, 32, px + 16, py + ph - 16, { grade: GRADE.stardewWood });
      c.blit(SHEETS.country, 64, 32, 32, 32, px + pw - 48, py + ph - 16, { grade: GRADE.stardewWood });
    } else if (p.k === "bath") {
      // Steaming Stardew Mountain Bathhouse / Hinoki Spa Tub (x=2..5, y=13..14)!
      c.rect(px + 4, py + 6, pw - 8, ph - 4, SHADOW);
      // Cedar & stone tub rim
      c.box(px + 4, py + 4, pw - 8, ph - 8, hex("#9c6236"), INK, 2);
      c.box(px + 10, py + 10, pw - 20, ph - 20, hex("#59b5c4"), hex("#5e361c"), 2);
      // Shimmering water texture from real watergrass.png row 5!
      c.blit(SHEETS.watergrass, 0, 160, 96, 32, px + 12, py + 12, { dw: pw - 24, dh: ph - 24, grade: GRADE.stardewWater });
      // Wooden spa water buckets & basin from buckets.png + kitchen.png!
      c.blit(SHEETS.buckets, 64, 32, 32, 32, px + pw + 6, py + 16);
      c.blit(SHEETS.kitchen, 32, 32, 32, 32, px + pw + 44, py - 10);
    } else if (p.k === "bed") {
      // Authentic Hand-Pixeled Stardew Farmhouse Bed from country.png (re-graded crimson quilt)!
      c.rect(px + 4, py + 12, pw - 4, ph - 14, SHADOW);
      c.blit(SHEETS.country, 0, 0, 64, 96, px, py + 12, { dw: pw, dh: 102, grade: GRADE.stardewBed });
      // Small crimson bedside rug from cabinets.png
      c.blit(SHEETS.cabinets, 128, 0, 32, 32, px + pw + 2, py + 48);
    } else if (p.k === "lounge") {
      // Cozy Stardew Farmhouse Hearth Lounge (x=11..20, y=18..23)!
      // 1) Large ornate crimson & gold woven Stardew rug!
      paintStardewCarpet(c, px + 40, py + 24, pw - 68, ph - 44);
      // 2) Brick Hearth Fireplace along left wall (x=11..12, y=19..22 — aligned with live firelight!)
      paintStardewHearth(c, px + 4, py + 34, 48, 86);
      // 3) Cozy green Stardew Cottage Sofa facing the hearth & coffee table!
      paintStardewSofa(c, px + 94, py + 18, 124, 38, "south");
      paintStardewSofa(c, px + pw - 52, py + 64, 40, 66, "west");
      // 4) Hand-pixeled wood coffee table + tea service in center of rug (clean crop y=266..304!)
      c.rect(px + 104, py + 78, 98, 38, SHADOW);
      c.blit(SHEETS.cabinets, 96, 266, 64, 38, px + 102, py + 72, { dw: 98, dh: 40, grade: GRADE.stardewWood });
      c.blit(SHEETS.cabinets, 128, 32, 32, 32, px + 134, py + 70);
      c.blit(SHEETS.cabinets, 128, 64, 32, 32, px + 136, py + 72);
      // Cozy woven cushions/footstools from country.png wooden chairs facing up
      c.blit(SHEETS.country, 64, 32, 32, 32, px + 114, py + 122, { grade: GRADE.stardewWood });
      c.blit(SHEETS.country, 64, 32, 32, 32, px + 162, py + 122, { grade: GRADE.stardewWood });
    } else if (p.k === "meeting") {
      // Community Standup Harvest Table (x=23..26, y=21..22)
      c.rect(px + 4, py + 12, pw - 8, ph - 10, SHADOW);
      // Chairs tucked north & south
      for (const ox of [14, 50, 86]) {
        c.blit(SHEETS.country, 64, 0, 32, 32, px + ox, py - 12, { grade: GRADE.stardewWood });
        c.blit(SHEETS.country, 64, 32, 32, 32, px + ox, py + ph - 16, { grade: GRADE.stardewWood });
      }
      // Rich long wooden standup table from cabinets.png (clean y=266..304 crop!)
      c.blit(SHEETS.cabinets, 96, 266, 64, 38, px + 2, py + 6, { dw: pw - 4, dh: ph - 14, grade: GRADE.stardewWood });
      // Lace runner + ceramic tea cups + notepad
      c.blit(SHEETS.cabinets, 128, 32, 32, 32, px + Math.floor(pw / 2) - 16, py + 6);
      c.blit(SHEETS.cabinets, 160, 64, 32, 32, px + 18, py + 10);
      c.box(px + Math.floor(pw / 2) - 10, py + 14, 20, 14, hex("#fbf0d4"), hex("#6b4a2e"), 1);
    } else if (p.k === "board") {
      // Iconic Stardew Valley Pelican Town "Help Wanted" Bulletin Board!
      paintHelpWantedBoard(c, px, py, pw, ph);
    } else if (p.k === "server") {
      // Rustic Stardew Valley Junimo / Clockwork Farm Control Cabinet (x=27..28, y=3..6)!
      c.rect(px + 4, py + 12, pw - 4, ph - 10, SHADOW);
      // Tall mahogany cabinet base from real cabinets.png
      c.blit(SHEETS.cabinets, 128, 96, 32, 64, px, py + 4, { dw: 32, dh: 62, grade: GRADE.stardewWalnut });
      c.blit(SHEETS.cabinets, 96, 96, 32, 64, px + 32, py + 4, { dw: 32, dh: 62, grade: GRADE.stardewWalnut });
      c.blit(SHEETS.cabinets, 32, 96, 32, 64, px, py + 62, { dw: 32, dh: 58, grade: GRADE.stardewWalnut });
      c.blit(SHEETS.cabinets, 64, 96, 32, 64, px + 32, py + 62, { dw: 32, dh: 58, grade: GRADE.stardewWalnut });
      // Brass gauge dials & emerald Junimo crystal status indicators!
      for (const gy of [20, 44, 78, 98]) {
        c.box(px + 8, py + gy, 16, 12, hex("#2b2622"), hex("#c99442"), 1);
        c.rect(px + 10, py + gy + 3, 4, 4, hex("#69e378"));
        c.rect(px + 17, py + gy + 3, 4, 4, gy % 4 === 0 ? hex("#fbd35c") : hex("#69e378"));
        c.box(px + 40, py + gy, 16, 12, hex("#2b2622"), hex("#c99442"), 1);
        c.rect(px + 42, py + gy + 3, 4, 4, hex("#6ad6f2"));
        c.rect(px + 49, py + gy + 3, 4, 4, hex("#69e378"));
      }
    } else if (p.k === "coffee") {
      // Cozy Stardew Coffee & Tea Sideboard (x=34..36, y=3..4)!
      c.rect(px + 4, py + 14, pw - 8, ph - 10, SHADOW);
      c.blit(SHEETS.cabinets, 96, 266, 64, 38, px + 2, py + 10, { dw: pw - 4, dh: ph - 14, grade: GRADE.stardewWood });
      // Copper kettle + ceramic tea set from cabinets.png!
      c.box(px + 14, py + 4, 18, 16, hex("#c86e3c"), INK, 2);
      c.rect(px + 18, py + 7, 6, 4, hex("#f0a672"));
      c.blit(SHEETS.cabinets, 128, 64, 32, 32, px + 44, py + 4);
      c.blit(SHEETS.cabinets, 160, 64, 32, 32, px + 68, py + 8);
    } else if (p.k === "shelf") {
      // East Wing Library / Farm Tool Bookshelves (x=40..44, y=4..6) from real cabinets.png!
      c.rect(px + 4, py + 24, pw - 8, ph - 20, SHADOW);
      for (let i = 0; i < 5; i++) {
        const sx = i % 3 === 0 ? 32 : i % 3 === 1 ? 64 : 96;
        c.blit(SHEETS.cabinets, sx, 0, 32, 64, px + i * 32, py + 10, { dw: 32, dh: 76, grade: GRADE.stardewWood });
      }
    } else if (p.k === "storage") {
      // Real LPC Oak Barrels & Stardew Wooden Shipping Chests (x=44..45, y=8..16)!
      c.blit(SHEETS.barrel, 0, 0, 64, 64, px, py + 6, { grade: GRADE.stardewWood });
      c.blit(SHEETS.barrel, 64, 0, 64, 64, px, py + 68, { grade: GRADE.stardewWood });
      c.blit(SHEETS.chests, 0, 0, 32, 32, px + 14, py + 142, { dw: 36, dh: 34, grade: GRADE.stardewWood });
      c.blit(SHEETS.chests, 32, 0, 32, 32, px + 14, py + 184, { dw: 36, dh: 34, grade: GRADE.stardewWood });
      c.blit(SHEETS.barrel, 0, 0, 64, 64, px, py + 224, { grade: GRADE.stardewWood });
    } else if (p.k === "bike") {
      // Rustic Stardew Vintage Delivery Bicycle parked in East Barn (x=40..42, y=8..9)
      c.rect(px + 12, py + 40, pw - 24, 10, SHADOW);
      // Wheels
      c.box(px + 14, py + 22, 22, 22, hex("#3a2a22"), INK, 2);
      c.box(px + 18, py + 26, 14, 14, hex("#cbb696"), hex("#785e46"), 2);
      c.box(px + pw - 36, py + 22, 22, 22, hex("#3a2a22"), INK, 2);
      c.box(px + pw - 32, py + 26, 14, 14, hex("#cbb696"), hex("#785e46"), 2);
      // Crimson frame + wicker basket
      c.rect(px + 24, py + 28, pw - 48, 5, hex("#c8433b"));
      c.rect(px + 34, py + 16, 4, 16, hex("#c8433b"));
      c.rect(px + pw - 34, py + 12, 4, 20, hex("#c8433b"));
      c.box(px + 28, py + 12, 16, 6, hex("#6b3c1e"), INK, 1); // leather seat
      c.box(px + pw - 28, py + 10, 18, 12, hex("#d6a360"), INK, 2); // wicker basket!
    } else if (p.k === "car") {
      // Cozy Stardew Wooden Harvest Farm Wagon filled with golden hay & pumpkins (x=40..43, y=15..21)!
      c.rect(px + 12, py + 18, pw - 20, ph - 20, SHADOW);
      // Wooden wagon wheels (4 corners)
      for (const [wx, wy] of [[px + 6, py + 38], [px + pw - 16, py + 38], [px + 6, py + ph - 58], [px + pw - 16, py + ph - 58]]) {
        c.box(wx, wy, 10, 32, hex("#6e3d1e"), INK, 2);
        c.rect(wx + 3, wy + 4, 4, 24, hex("#9c5d32"));
      }
      // Solid cedar wagon bed tiled with real inside.png wood planks (zero transparent gaps!)
      c.box(px + 14, py + 18, pw - 28, ph - 36, hex("#8f5228"), INK, 2);
      for (let wy = py + 24; wy < py + ph - 24; wy += 32) {
        const bh = Math.min(32, py + ph - 24 - wy);
        for (let wx = px + 20; wx < px + pw - 20; wx += 32) {
          const bw = Math.min(32, px + pw - 20 - wx);
          c.blit(SHEETS.inside, 0, 128, bw, bh, wx, wy, { grade: GRADE.stardewCedarFloor });
        }
      }
      // Wagon wooden side rails
      c.rect(px + 18, py + 22, pw - 36, 4, hex("#ba7742"));
      c.rect(px + 18, py + ph - 26, pw - 36, 4, hex("#6b3b1c"));
      // Golden hay bales & Stardew Pumpkins loaded inside the wagon!
      c.box(px + 26, py + 32, pw - 52, 40, hex("#e3b94b"), hex("#8c621c"), 2);
      c.rect(px + 30, py + 38, pw - 60, 4, hex("#f7d979"));
      c.rect(px + 30, py + 58, pw - 60, 4, hex("#d4a438"));
      c.rect(px + 26, py + 50, pw - 52, 3, hex("#965622")); // twine
      // Plump Stardew Pumpkins with ribs & green stems!
      for (const [ox, oy] of [[28, 86], [62, 92], [44, 118], [70, 128], [28, 142], [54, 152]]) {
        c.box(px + ox, py + oy, 22, 18, hex("#e37627"), INK, 2);
        c.rect(px + ox + 4, py + oy + 3, 5, 11, hex("#f79c42"));
        c.rect(px + ox + 12, py + oy + 3, 4, 11, hex("#c95d18"));
        c.rect(px + ox + 9, py + oy - 4, 4, 6, hex("#478c32"));
      }
      // Wagon wooden shafts extending south
      c.box(px + 32, py + ph - 20, 8, 22, hex("#7d4824"), INK, 2);
      c.box(px + pw - 40, py + ph - 20, 8, 22, hex("#7d4824"), INK, 2);
    } else if (p.k === "plant") {
      paintStardewPlant(c, px, py, p.x + p.y);
    }
  }

  // STEP H: Lush Real LPC Oak & Pine Trees framing the exterior corners & garden edges (drawn last so canopies overlap gracefully!)
  paintStardewTree(c, 48, 62, "pineA");
  paintStardewTree(c, 18 * S + 12, 56, "oakA");
  paintStardewTree(c, 35 * S + 16, 56, "oakB");
  paintStardewTree(c, 45 * S + 24, 60, "pineB");
  // Side perimeter trees framing the left & right meadow margins
  paintStardewTree(c, 8, 12 * S, "oakA");
  paintStardewTree(c, 8, 22 * S, "pineA");
  paintStardewTree(c, 47 * S + 24, 11 * S, "oakB");
  paintStardewTree(c, 47 * S + 24, 21 * S, "pineB");

  return c;
}

/* ---------- 2. Seamless Pelican Town Meadow Tile (192x192) ---------- */
function generateMeadowTile() {
  const c = new Canvas(192, 192);
  paintStardewGrassArea(c, 0, 0, 6, 6, 808);
  // Subtle clover & pebble accents
  c.blit(SHEETS.rock, 32, 0, 32, 32, 128, 112, { dw: 24, dh: 24, alpha: 0.85 });
  return c;
}

/* ---------- 3. Seamless Pelican Town Dirt Village Lane Tile (192x64) ---------- */
function generateLaneTile() {
  const c = new Canvas(192, 64);
  paintStardewDirtRoad(c, 0, 0, 6, 2, 909);
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
  // Exact 30x40 — cropped directly from country.png wooden chair facing north (64, 32, 32, 32)!
  const c = new Canvas(30, 40);
  c.rect(4, 33, 22, 5, SHADOW_SOFT);
  c.blit(SHEETS.country, 64, 32, 32, 32, -1, 4, { dw: 32, dh: 34, grade: GRADE.stardewWood });
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

/* ---------- Write All 2x Retina Stardew Valley PNGs ---------- */
const outputs = [
  ["farmhouse-bg@2x.png", generateFarmhouseBackground()],
  ["meadow-tile@2x.png", generateMeadowTile()],
  ["lane-tile@2x.png", generateLaneTile()],
  ["desk-north@2x.png", generateDesk("north")],
  ["desk-south@2x.png", generateDesk("south")],
  ["chair-north@2x.png", generateChair("north")],
  ["chair-south@2x.png", generateChair("south")],
  ["mug@2x.png", generateMug()],
  ["herb@2x.png", generateHerb()],
];

for (const [name, canvas] of outputs) {
  const png = encodePng(canvas.w, canvas.h, canvas.buf);
  const outPath = path.join(OUT_DIR, name);
  fs.writeFileSync(outPath, png);
  console.log(`Generated ${path.relative(ROOT, outPath)} (${canvas.w}x${canvas.h}, ${(png.length / 1024).toFixed(1)} KB)`);
}
