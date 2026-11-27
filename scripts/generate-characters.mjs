#!/usr/bin/env node
/**
 * Painterly Cozy-Chibi Retina 2x (44x64) Character Sprite & Portrait Generator.
 * Matches the Golden Retina v2.7 workstation art style: organic chibi proportions,
 * directional warm shading, expressive glossy eyes, sculpted hair volume, tailored
 * office outfits, and soft warm-espresso outlines.
 *
 * Single source of truth: lib/character-recipes.json
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.cwd();
const OUT_BASE = path.join(ROOT, "public/art/retina-v2.7/characters/presets");
const CAST = JSON.parse(fs.readFileSync(path.join(ROOT, "lib/character-recipes.json"), "utf8"));

/* ---------- Minimal Zero-Dependency RGBA PNG Encoder ---------- */
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

/* ---------- Color & Painterly Shading Helpers ---------- */
function hex(h) {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16), 255];
}
const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
function mix(a, b, t) {
  return [
    clamp(a[0] * (1 - t) + b[0] * t),
    clamp(a[1] * (1 - t) + b[1] * t),
    clamp(a[2] * (1 - t) + b[2] * t),
    255,
  ];
}
function alpha(c, a) {
  return [c[0], c[1], c[2], clamp(a)];
}

/** Rich warm-shifted 5-stop ramp matching Golden Retina v2.7 palette lighting. */
function ramp(hexColor, isSkin = false) {
  const base = hex(hexColor);
  const warmLight = [255, 248, 232, 255];
  const warmDeep = isSkin ? [146, 72, 48, 255] : [42, 24, 34, 255];
  return {
    spec: mix(base, warmLight, isSkin ? 0.36 : 0.42),
    hi: mix(base, warmLight, isSkin ? 0.16 : 0.2),
    base,
    sh: mix(base, warmDeep, isSkin ? 0.24 : 0.28),
    deep: mix(base, warmDeep, isSkin ? 0.46 : 0.54),
  };
}

const INK = [32, 22, 30, 255];
const INK_SOFT = [54, 36, 46, 175];

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
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
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
  /** Painterly 3D-shaded ellipse with warm top-left studio lighting and soft rim depth. */
  shadedEllipse(cx, cy, rx, ry, r, opts = {}) {
    const lx = opts.lx ?? -0.36;
    const ly = opts.ly ?? -0.46;
    const flatTop = opts.flatTop ?? false;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        const d2 = nx * nx + ny * ny;
        if (d2 > 1.0) continue;
        if (flatTop && y < cy - ry * 0.72) continue;
        const nz = Math.sqrt(Math.max(0, 1 - d2));
        const dot = nx * lx + ny * ly + nz * 0.78;
        let col = r.base;
        if (dot > 0.91 && ny < 0.15) col = r.spec;
        else if (dot > 0.74) col = r.hi;
        else if (dot < 0.34 || ny > 0.68) col = r.deep;
        else if (dot < 0.54 || ny > 0.44 || nx > 0.56) col = r.sh;
        this.set(x, y, col);
      }
    }
  }
  /** Painterly rounded-rectangle with directional lighting & ambient occlusion edges. */
  shadedRoundRect(x0, y0, w, h, rad, r) {
    const x1 = x0 + w - 1;
    const y1 = y0 + h - 1;
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
        let cx = Math.max(x0 + rad, Math.min(x1 - rad, x));
        let cy = Math.max(y0 + rad, Math.min(y1 - rad, y));
        const dist = Math.hypot(x - cx, y - cy);
        if (dist > rad + 0.25) continue;
        const u = (x - x0) / Math.max(1, w - 1);
        const v = (y - y0) / Math.max(1, h - 1);
        const shadeVal = (1 - u) * 0.35 + (1 - v) * 0.55;
        let col = r.base;
        if (v < 0.18 && u > 0.12 && u < 0.8) col = r.hi;
        else if (v > 0.84 || u > 0.86) col = r.deep;
        else if (shadeVal < 0.42 || u > 0.72 || v > 0.68) col = r.sh;
        else if (shadeVal > 0.68) col = r.hi;
        this.set(x, y, col);
      }
    }
  }
  /** Thickened cozy dark-espresso silhouette outline with warm anti-aliased inner corner softening. */
  outline(color = INK) {
    const solid = [];
    const soft = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.getA(x, y) > 0) continue;
        const n4 =
          (this.getA(x - 1, y) > 160 ? 1 : 0) +
          (this.getA(x + 1, y) > 160 ? 1 : 0) +
          (this.getA(x, y - 1) > 160 ? 1 : 0) +
          (this.getA(x, y + 1) > 160 ? 1 : 0);
        if (n4 > 0) {
          solid.push([x, y]);
        } else {
          const nDiag =
            (this.getA(x - 1, y - 1) > 180 ? 1 : 0) +
            (this.getA(x + 1, y - 1) > 180 ? 1 : 0) +
            (this.getA(x - 1, y + 1) > 180 ? 1 : 0) +
            (this.getA(x + 1, y + 1) > 180 ? 1 : 0);
          if (nDiag >= 2) soft.push([x, y]);
        }
      }
    }
    for (const [x, y] of soft) this.set(x, y, INK_SOFT);
    for (const [x, y] of solid) this.set(x, y, color);
  }
}

/* ---------- Painterly Chibi Body, Head, Hair & Outfit Drawing ---------- */

function drawLegsAndShoes(c, ch, frame, bob) {
  const pants = ramp(ch.pants);
  const shoes = ramp(ch.shoes);
  const lLift = frame === 1 ? -2 : 0;
  const rLift = frame === 2 ? -2 : 0;

  // Ground contact shadow (subtle)
  c.ellipse(21.5, 61.5, 9.5, 1.5, [30, 22, 28, 45]);

  // Cozy tapered trousers
  c.shadedRoundRect(14, 48 + bob, 16, 4, 1.5, pants);
  // Left leg
  c.shadedRoundRect(14, 49 + bob, 7, 9 + lLift, 2, pants);
  // Right leg
  c.shadedRoundRect(23, 49 + bob, 7, 9 + rLift, 2, pants);
  // Inner leg gap seam
  c.rect(21, 51 + bob, 2, 7, INK_SOFT);

  // Rounded cozy shoes / sneakers
  const drawShoe = (sx, sy) => {
    c.shadedEllipse(sx + 3.2, sy + 1.8, 3.8, 2.5, shoes);
    c.rect(sx + 1, sy + 3, 6, 1, shoes.deep);
    c.rect(sx + 1, sy, 3, 1, shoes.spec);
  };
  drawShoe(13.5, 56.5 + lLift + bob);
  drawShoe(23.2, 56.5 + rLift + bob);
}

function drawTorso(c, ch, back, frame, bob) {
  const s1 = ramp(ch.shirt);
  const s2 = ramp(ch.shirt2);
  const sk = ramp(ch.skin, true);
  const lArmY = frame === 2 ? -1 : frame === 1 ? 1 : 0;
  const rArmY = frame === 1 ? -1 : frame === 2 ? 1 : 0;

  // Softly angled cozy sleeves (curving gently outward like Retina v2.7 role sprites)
  const sleeveColor = ch.outfit === "vest" ? s2 : s1;
  // Left sleeve & hand
  c.shadedRoundRect(9.5, 36.5 + bob + lArmY, 5.5, 9, 2.4, sleeveColor);
  c.shadedEllipse(11.6, 46.2 + bob + lArmY, 2.7, 2.6, sk);
  // Right sleeve & hand
  c.shadedRoundRect(29, 36.5 + bob + rArmY, 5.5, 9, 2.4, sleeveColor);
  c.shadedEllipse(32.4, 46.2 + bob + rArmY, 2.7, 2.6, sk);

  // Tapered cozy torso
  c.shadedRoundRect(13.5, 34 + bob, 17, 15, 3.6, s1);

  // Soft sleeve seams
  c.rect(14, 39 + bob, 1, 8, alpha(s1.deep, 170));
  c.rect(29, 39 + bob, 1, 8, alpha(s1.deep, 190));

  // Warm neck with subtle chin cast shadow
  c.shadedRoundRect(19, 31 + bob, 6, 4.5, 1.5, sk);
  c.rect(19, 31 + bob, 6, 2, sk.sh);

  if (back) {
    if (ch.outfit === "hoodie") {
      // Draped cozy hood resting across upper back
      c.shadedEllipse(21.5, 36.5 + bob, 7.2, 3.2, s1);
      c.rect(16, 38 + bob, 11, 1, s1.deep);
    } else if (ch.outfit === "striped") {
      for (let sy = 38; sy <= 46; sy += 4) c.rect(14, sy + bob, 16, 2, s2.base);
    } else if (ch.outfit === "blazer" || ch.outfit === "jacket") {
      c.rect(21, 36 + bob, 2, 12, alpha(s1.deep, 145));
      c.rect(14, 47 + bob, 16, 1, s1.deep);
    }
    if (ch.scarf) {
      const sc = ramp(ch.scarf);
      c.shadedRoundRect(15.5, 32.5 + bob, 13, 4.5, 2, sc);
      c.rect(17, 36 + bob, 10, 1, sc.deep);
    }
    return;
  }

  // Front tailored outfit details
  switch (ch.outfit) {
    case "collar":
      c.shadedRoundRect(17, 34 + bob, 10, 3, 1.2, s2);
      c.rect(20, 35 + bob, 4, 3, s2.sh);
      c.rect(21, 39 + bob, 2, 2, s2.spec);
      c.rect(21, 43 + bob, 2, 2, s2.base);
      break;
    case "tie":
      c.rect(17, 34 + bob, 10, 3, s1.spec);
      c.rect(20, 35 + bob, 4, 2, s2.hi);
      c.rect(21, 37 + bob, 2, 10, s2.base);
      c.rect(21, 46 + bob, 2, 2, s2.deep);
      break;
    case "cardigan":
      c.shadedRoundRect(18.5, 34.5 + bob, 7, 14, 1, s2);
      c.rect(17.5, 35 + bob, 1, 13, s1.deep);
      c.rect(25.5, 35 + bob, 1, 13, s1.deep);
      // Subtle studio lanyard
      c.rect(19, 35 + bob, 1, 5, hex("#3c5f9e"));
      c.rect(24, 35 + bob, 1, 5, hex("#3c5f9e"));
      c.rect(20, 39 + bob, 4, 4, hex("#f7f4ec"));
      c.rect(21, 40 + bob, 2, 2, hex("#6a8fd6"));
      break;
    case "crew":
      c.shadedRoundRect(17.5, 34 + bob, 9, 2.5, 1, s2);
      c.rect(17, 36 + bob, 10, 1, s1.sh);
      break;
    case "turtleneck":
      c.shadedRoundRect(17.5, 32.5 + bob, 9, 4.5, 1.8, s1);
      c.rect(18, 36 + bob, 8, 1, s1.deep);
      // Cozy ribbed texture
      c.rect(20, 33 + bob, 1, 3, s1.hi);
      c.rect(23, 33 + bob, 1, 3, s1.hi);
      break;
    case "hoodie":
      c.shadedRoundRect(16.5, 34 + bob, 11, 3, 1.5, s1);
      c.rect(19, 36 + bob, 1, 6, s2.spec);
      c.rect(24, 36 + bob, 1, 6, s2.spec);
      c.shadedRoundRect(16.5, 43 + bob, 11, 4.5, 1.8, s1);
      c.rect(17, 43 + bob, 10, 1, s1.deep);
      break;
    case "blazer":
    case "jacket":
      c.shadedRoundRect(18.5, 34.5 + bob, 7, 14, 1, s2);
      // Crisp lapels
      c.rect(17, 35 + bob, 2, 5, s1.hi);
      c.rect(25, 35 + bob, 2, 5, s1.hi);
      c.rect(18, 40 + bob, 1, 8, s1.deep);
      c.rect(25, 40 + bob, 1, 8, s1.deep);
      // Subtle studio badge
      c.rect(20, 35 + bob, 1, 4, hex("#3c5f9e"));
      c.rect(23, 35 + bob, 1, 4, hex("#3c5f9e"));
      c.rect(20, 39 + bob, 4, 3, hex("#faf7f0"));
      break;
    case "striped":
      for (let sy = 38; sy <= 46; sy += 4) c.rect(14, sy + bob, 16, 2, s2.base);
      c.rect(18, 34 + bob, 8, 2, s2.hi);
      break;
    case "vest":
      c.shadedRoundRect(18.5, 34.5 + bob, 7, 4.5, 1.2, s2);
      c.rect(20, 38 + bob, 4, 2, s2.sh);
      c.rect(17.5, 35 + bob, 1, 4, s1.deep);
      c.rect(25.5, 35 + bob, 1, 4, s1.deep);
      c.rect(14, 47 + bob, 16, 2, s1.deep);
      break;
  }

  // Cozy wrapped knit scarf (Sena, Zaki)
  if (ch.scarf && !back) {
    const sc = ramp(ch.scarf);
    c.shadedRoundRect(15, 32.5 + bob, 14, 5, 2.2, sc);
    c.rect(16, 36.5 + bob, 12, 1, sc.deep);
    c.shadedRoundRect(22.5, 36 + bob, 4.5, 8.5, 1.5, sc);
    c.rect(23, 43 + bob, 3.5, 1, sc.hi);
  }

  // Headphones resting around neck (Bima, Zaki)
  if (ch.headphones && !back) {
    const hp = ramp(ch.headphones);
    c.shadedRoundRect(15.5, 34 + bob, 3.5, 5.5, 1.5, hp);
    c.shadedRoundRect(25, 34 + bob, 3.5, 5.5, 1.5, hp);
    c.rect(19, 37.5 + bob, 6, 2, hp.sh);
  }
}

function drawHairBackLayer(c, ch, back, bob) {
  const hr = ramp(ch.hair);
  if (ch.hairStyle === "longwavy") {
    c.shadedEllipse(21.5, 22 + bob, 14, 13.5, hr);
    c.shadedRoundRect(8.5, 20 + bob, 27, 20, 6, hr);
    c.shadedEllipse(11.5, 37 + bob, 4.5, 4.5, hr);
    c.shadedEllipse(31.5, 37 + bob, 4.5, 4.5, hr);
    c.shadedEllipse(21.5, 39 + bob, 7, 3.5, hr);
  } else if (ch.hairStyle === "bob") {
    c.shadedEllipse(21.5, 21 + bob, 14, 12.8, hr);
    c.shadedEllipse(11.5, 29.5 + bob, 4.8, 4.2, hr);
    c.shadedEllipse(31.5, 29.5 + bob, 4.8, 4.2, hr);
    c.rect(11, 29 + bob, 22, 4, hr.sh);
  } else if (ch.hairStyle === "curlyband") {
    c.shadedEllipse(21.5, 21 + bob, 14.5, 13, hr);
    for (const [bx, by] of [[9, 23], [34, 23], [9.5, 29], [33.5, 29], [12.5, 33], [30.5, 33]]) {
      c.shadedEllipse(bx, by + bob, 3.6, 3.4, hr);
    }
  } else if (ch.hairStyle === "afro") {
    c.shadedEllipse(21.5, 16.5 + bob, 15.2, 12.6, hr);
    for (const [bx, by] of [[9.5, 12.5], [15, 7], [21.5, 6], [28, 7], [33.5, 12.5], [8.5, 19.5], [34.5, 19.5]]) {
      c.shadedEllipse(bx, by + bob, 4.6, 4.2, hr);
    }
  } else if (ch.hairStyle === "twinpuffs") {
    c.shadedEllipse(9.2, 10.8 + bob, 5.8, 5.5, hr);
    c.shadedEllipse(33.8, 10.8 + bob, 5.8, 5.5, hr);
  } else if (ch.hairStyle === "highbun") {
    c.shadedEllipse(21.5, 6.8 + bob, 6.2, 5.0, hr);
    c.shadedRoundRect(16.5, 9.5 + bob, 10, 2.5, 1, ramp(ch.shirt));
  } else if (ch.hairStyle === "ponytail") {
    // High swept ponytail cascading over right shoulder
    c.shadedEllipse(33.5, 16 + bob, 5.2, 5.6, hr);
    c.shadedEllipse(35.2, 24.5 + bob, 4.6, 6.8, hr);
    c.shadedEllipse(33.8, 33 + bob, 3.8, 4.8, hr);
    c.shadedRoundRect(29.5, 12.5 + bob, 4.5, 3, 1.2, ramp(ch.shirt));
  } else if (ch.hairStyle === "braids") {
    // Twin woven braids resting cleanly behind ears/shoulders
    c.shadedEllipse(21.5, 18.5 + bob, 12.8, 10.5, hr);
    const tie = ramp(ch.shirt);
    for (const bx of [10.5, 32.5]) {
      for (const by of [28.5, 32.5, 36.5]) {
        c.shadedEllipse(bx, by + bob, 2.9, 2.6, hr);
        c.rect(bx - 1.5, by + 1 + bob, 3, 1, hr.deep);
      }
      c.shadedRoundRect(bx - 2, 38.5 + bob, 4, 2, 0.8, tie);
      c.shadedEllipse(bx, 41.2 + bob, 2.0, 2.2, hr);
    }
  } else if (ch.hairStyle === "beanie") {
    const cap = ramp(ch.capColor || ch.shirt);
    c.shadedEllipse(21.5, 5.2 + bob, 3.4, 3.0, cap);
    c.shadedEllipse(21.5, 12.5 + bob, 12.8, 7.6, cap);
  } else if (ch.hairStyle === "pompadour") {
    c.shadedEllipse(21.5, 9.5 + bob, 12.2, 6.8, hr);
  } else if (ch.hairStyle === "hijab") {
    c.shadedEllipse(21.5, 20.5 + bob, 14.2, 14, hr);
    c.shadedRoundRect(9.5, 23 + bob, 25, 15, 5, hr);
    if (!back) {
      c.shadedEllipse(21.5, 35.5 + bob, 10.5, 4.2, hr);
    }
  }
}

function drawHead(c, ch, back, bob) {
  const sk = ramp(ch.skin, true);

  // Cute rounded chibi ears (hidden by full hair/hijab styles)
  if (!["hijab", "longwavy", "bob", "curlyband"].includes(ch.hairStyle)) {
    c.shadedEllipse(10.2, 23 + bob, 2.6, 3.1, sk);
    c.rect(10, 22 + bob, 1, 2, sk.sh);
    c.shadedEllipse(32.8, 23 + bob, 2.6, 3.1, sk);
    c.rect(32, 22 + bob, 1, 2, sk.sh);
  }

  // Soft organic chibi head oval with warm cheek lighting & gentle chin shadow
  c.shadedEllipse(21.5, 21.5 + bob, 11.2, 10.8, sk, { lx: -0.3, ly: -0.4 });
  // Slight cute lower cheek fullness
  c.shadedEllipse(21.5, 24.5 + bob, 10.6, 7.6, sk, { lx: -0.25, ly: -0.35 });
  // Subtle forehead shadow cast by hair bangs (except bald)
  if (!back && ch.hairStyle !== "bald") {
    c.rect(13, 15 + bob, 18, 2, alpha(sk.sh, 130));
  }

  if (back) return;

  // Gold or silver earrings
  if (ch.earrings === "gold" || ch.earrings === "silver") {
    const g = ramp(ch.earrings === "silver" ? "#dce3ee" : "#f6c74e");
    c.shadedEllipse(10.5, 26.8 + bob, 1.5, 1.8, g);
    c.shadedEllipse(32.5, 26.8 + bob, 1.5, 1.8, g);
  }

  // Soft rosy cheek blush
  if (ch.blush) {
    const bl = [235, 122, 116, 118];
    c.ellipse(14.2, 25.6 + bob, 2.2, 1.3, bl);
    c.ellipse(28.8, 25.6 + bob, 2.2, 1.3, bl);
  }

  // Warm freckles
  if (ch.freckles) {
    const fr = [132, 76, 48, 175];
    for (const [fx, fy] of [[13, 25], [15, 26], [14, 27], [29, 25], [27, 26], [28, 27]]) {
      c.set(fx, fy + bob, fr);
    }
  }

  // Lush expressive chibi eyes (matching Golden Retina v2.7 warmth & clarity)
  const iris = ramp(ch.eyeColor);
  const white = [253, 251, 246, 255];
  const lash = [30, 20, 28, 255];

  const drawGlossyEye = (ex, ey, h, archedLash = false, pupilW = 3) => {
    c.rect(ex, ey, 4, h, white);
    const px = ex < 21 ? ex + (4 - pupilW) : ex;
    c.rect(px, ey, pupilW, h, iris.deep);
    c.rect(px, ey + h - 2, pupilW, 2, iris.hi);
    // Crisp specular catchlight
    c.set(px, ey + 1, white);
    // Upper dark lash line
    c.rect(ex, ey - 1, 4, 1, lash);
    if (archedLash) {
      c.set(ex < 21 ? ex - 1 : ex + 4, ey, lash);
    }
  };

  if (ch.eyes === "happy") {
    // Joyful curved smiling eyes ^ ^
    c.rect(14, 22 + bob, 4, 1, lash);
    c.rect(15, 21 + bob, 2, 1, lash);
    c.set(13, 23 + bob, lash);
    c.set(18, 23 + bob, lash);
    c.rect(25, 22 + bob, 4, 1, lash);
    c.rect(26, 21 + bob, 2, 1, lash);
    c.set(24, 23 + bob, lash);
    c.set(29, 23 + bob, lash);
  } else if (ch.eyes === "sparkle") {
    drawGlossyEye(14, 20 + bob, 5, true, 3);
    drawGlossyEye(25, 20 + bob, 5, true, 3);
    c.set(16, 23 + bob, [255, 245, 220, 200]);
    c.set(27, 23 + bob, [255, 245, 220, 200]);
  } else if (ch.eyes === "lashed") {
    drawGlossyEye(14, 21 + bob, 4, true, 3);
    drawGlossyEye(25, 21 + bob, 4, true, 3);
  } else if (ch.eyes === "calm") {
    drawGlossyEye(14, 22 + bob, 3, false, 3);
    drawGlossyEye(25, 22 + bob, 3, false, 3);
    c.rect(14, 20 + bob, 4, 1, sk.sh);
    c.rect(25, 20 + bob, 4, 1, sk.sh);
  } else if (ch.eyes === "focused") {
    drawGlossyEye(14, 21 + bob, 4, false, 2);
    drawGlossyEye(25, 21 + bob, 4, false, 2);
  } else if (ch.eyes === "wide") {
    drawGlossyEye(14, 20 + bob, 5, false, 3);
    drawGlossyEye(25, 20 + bob, 5, false, 3);
  } else {
    drawGlossyEye(14, 21 + bob, 4, false, 3);
    drawGlossyEye(25, 21 + bob, 4, false, 3);
  }

  // Expressive eyebrows
  const br = ramp(ch.hair).deep;
  if (ch.brow === "thick") {
    c.rect(13, 18 + bob, 5, 2, br);
    c.rect(25, 18 + bob, 5, 2, br);
  } else if (ch.brow === "arched") {
    c.rect(14, 18 + bob, 4, 1, br);
    c.set(15, 17 + bob, br);
    c.rect(25, 18 + bob, 4, 1, br);
    c.set(27, 17 + bob, br);
  } else if (ch.brow === "confident") {
    c.rect(14, 18 + bob, 4, 1, br);
    c.set(18, 19 + bob, br);
    c.rect(25, 18 + bob, 4, 1, br);
    c.set(24, 19 + bob, br);
  } else {
    c.rect(14, 18 + bob, 4, 1, br);
    c.rect(25, 18 + bob, 4, 1, br);
  }

  // Soft chibi nose dot
  c.rect(21, 24 + bob, 2, 1, sk.sh);

  // Facial hair
  const fh = ramp(ch.hair);
  if (ch.facial === "fullbeard") {
    c.shadedEllipse(21.5, 29.8 + bob, 9.2, 4.6, fh);
    c.rect(18.5, 27.5 + bob, 6, 2, [249, 245, 238, 255]);
  } else if (ch.facial === "mustache") {
    c.shadedRoundRect(17, 26 + bob, 9, 2.2, 1, fh);
    for (let sx = 17; sx <= 26; sx += 2) c.set(sx, 30.5 + bob, alpha(fh.sh, 125));
  } else if (ch.facial === "goatee") {
    c.shadedEllipse(21.5, 30.6 + bob, 3.2, 1.8, fh);
  }

  // Warm chibi smile / expression
  if (ch.facial !== "fullbeard") {
    const lip = [166, 78, 72, 255];
    const tooth = [253, 250, 244, 255];
    if (ch.mouth === "grin") {
      c.rect(18, 27 + bob, 7, 2, tooth);
      c.rect(18, 27 + bob, 7, 1, lip);
      c.rect(19, 29 + bob, 5, 1, lip);
    } else if (ch.mouth === "smile") {
      c.rect(19, 28 + bob, 5, 1, lip);
      c.set(18, 27 + bob, lip);
      c.set(24, 27 + bob, lip);
    } else if (ch.mouth === "smirk") {
      c.rect(19, 28 + bob, 5, 1, lip);
      c.set(24, 27 + bob, lip);
      c.set(25, 26 + bob, lip);
    } else {
      c.rect(19, 28 + bob, 5, 1, lip);
    }
  }

  // Distinct eyewear with subtle glass tint & sheen
  if (ch.glasses) {
    const frame = ch.glasses === "round" ? [102, 92, 86, 255] : [38, 30, 42, 255];
    const lens = [232, 244, 255, 58];
    const drawLens = (x, y, w, h, thickTop = false, wing = 0) => {
      c.rect(x + 1, y + 1, w - 2, h - 2, lens);
      c.set(x + 1, y + 1, [255, 255, 255, 145]);
      c.rect(x + 1, y, w - 2, thickTop ? 2 : 1, frame);
      c.rect(x + 1, y + h - 1, w - 2, 1, frame);
      c.rect(x, y + 1, 1, h - 2, frame);
      c.rect(x + w - 1, y + 1, 1, h - 2, frame);
      if (wing < 0) c.set(x - 1, y, frame);
      if (wing > 0) c.set(x + w, y, frame);
    };
    if (ch.glasses === "round") {
      drawLens(12, 19 + bob, 7, 7);
      drawLens(24, 19 + bob, 7, 7);
      c.rect(19, 22 + bob, 5, 1, frame);
    } else if (ch.glasses === "cateye") {
      drawLens(12, 19 + bob, 7, 7, false, -1);
      drawLens(24, 19 + bob, 7, 7, false, 1);
      c.rect(19, 21 + bob, 5, 1, frame);
    } else if (ch.glasses === "rect") {
      drawLens(12, 19 + bob, 7, 7, true);
      drawLens(24, 19 + bob, 7, 7, true);
      c.rect(19, 21 + bob, 5, 1, frame);
    } else if (ch.glasses === "halfrim") {
      c.rect(13, 20 + bob, 6, 4, lens);
      c.rect(24, 20 + bob, 6, 4, lens);
      c.rect(12, 19 + bob, 7, 1, frame);
      c.rect(24, 19 + bob, 7, 1, frame);
      c.rect(19, 20 + bob, 5, 1, frame);
      c.rect(12, 20 + bob, 1, 3, frame);
      c.rect(30, 20 + bob, 1, 3, frame);
    }
  }
}

function drawHairFrontLayer(c, ch, back, bob) {
  const hr = ramp(ch.hair);
  const sk = ramp(ch.skin, true);

  if (back) {
    if (ch.hairStyle === "bald") {
      c.shadedEllipse(21.5, 20.5 + bob, 11.2, 10.8, sk);
      c.shadedEllipse(21.5, 25.5 + bob, 10.6, 3.6, hr);
      c.rect(12, 25 + bob, 19, 2, hr.base);
      return;
    }
    if (ch.hairStyle === "hijab") {
      c.shadedEllipse(21.5, 20 + bob, 14, 13.8, hr);
      c.shadedRoundRect(9.5, 21 + bob, 25, 17, 5, hr);
      return;
    }
    c.shadedEllipse(21.5, 19 + bob, 12.6, 12, hr);
    if (ch.hairStyle === "longwavy") {
      c.shadedRoundRect(9, 20 + bob, 26, 19, 6, hr);
      c.ellipse(14, 38 + bob, 4.5, 3.2, hr.base);
      c.ellipse(21.5, 39.2 + bob, 5.5, 3.2, hr.base);
      c.ellipse(29, 38 + bob, 4.5, 3.2, hr.sh);
      c.rect(11, 39 + bob, 21, 2, hr.sh);
    } else if (ch.hairStyle === "bob") {
      c.shadedRoundRect(9, 20 + bob, 26, 13, 5, hr);
    } else if (ch.hairStyle === "spiky") {
      for (const [sx, sy] of [[12, 8], [17, 5.5], [23, 5.5], [29, 7.5], [32, 11]]) {
        c.shadedEllipse(sx, sy + bob, 3.4, 3.6, hr);
      }
    } else if (ch.hairStyle === "curlyband") {
      c.shadedRoundRect(9.5, 13.5 + bob, 24, 3, 1.2, ramp(ch.headband));
    } else if (ch.hairStyle === "ponytail") {
      c.shadedRoundRect(18, 16 + bob, 7, 3, 1.2, ramp(ch.shirt));
      c.shadedEllipse(21.5, 24 + bob, 5.2, 6.2, hr);
      c.shadedEllipse(21.5, 32 + bob, 4.4, 5.8, hr);
      c.shadedEllipse(21.5, 37.5 + bob, 3.2, 3.2, hr);
    } else if (ch.hairStyle === "braids") {
      const tie = ramp(ch.shirt);
      for (const bx of [13.5, 29.5]) {
        for (const by of [28, 32.5, 36.5]) {
          c.shadedEllipse(bx, by + bob, 3.0, 2.7, hr);
          c.rect(bx - 1.5, by + 1 + bob, 3, 1, hr.deep);
        }
        c.shadedRoundRect(bx - 2, 38.5 + bob, 4, 2, 0.8, tie);
        c.shadedEllipse(bx, 41.2 + bob, 2.1, 2.1, hr);
      }
    } else if (ch.hairStyle === "beanie") {
      const cap = ramp(ch.capColor || ch.shirt);
      c.shadedEllipse(21.5, 5.2 + bob, 3.5, 3.1, cap);
      c.shadedEllipse(21.5, 14.2 + bob, 13.0, 8.6, cap);
      c.shadedRoundRect(9, 16.5 + bob, 25, 5, 2.2, cap);
      for (let rx = 12; rx <= 31; rx += 3) c.rect(rx, 17.2 + bob, 1, 3.5, cap.sh);
    } else if (ch.hairStyle === "pompadour") {
      c.shadedEllipse(21.5, 10 + bob, 12.2, 6.8, hr);
      c.rect(16, 6.5 + bob, 10, 2, hr.spec);
    }
    return;
  }

  // Sculpted organic front bangs & crown locks per character
  switch (ch.hairStyle) {
    case "bob":
      c.shadedEllipse(21.5, 12.5 + bob, 13.2, 6.8, hr);
      c.shadedEllipse(10.5, 21 + bob, 3.2, 9.5, hr);
      c.shadedEllipse(32.5, 21 + bob, 3.2, 9.5, hr);
      c.shadedEllipse(16.5, 14 + bob, 6.5, 3.5, hr);
      c.shadedEllipse(26, 13.5 + bob, 5.5, 2.8, hr);
      c.rect(15, 9 + bob, 9, 2, hr.spec);
      break;

    case "sidepart":
      c.shadedEllipse(21.5, 11.8 + bob, 12.2, 6.2, hr);
      c.shadedEllipse(11, 16 + bob, 2.4, 4.5, hr);
      c.shadedEllipse(32, 16 + bob, 2.4, 4.5, hr);
      c.shadedEllipse(24, 12.8 + bob, 7.5, 3.2, hr);
      c.rect(15, 10 + bob, 2, 5, hr.deep);
      c.rect(18, 8.5 + bob, 9, 2, hr.spec);
      break;

    case "longwavy":
      c.shadedEllipse(21.5, 12.5 + bob, 13.2, 6.8, hr);
      c.shadedEllipse(10.2, 24 + bob, 3.2, 12.5, hr);
      c.shadedEllipse(32.8, 24 + bob, 3.2, 12.5, hr);
      c.shadedEllipse(15.5, 14.2 + bob, 5.2, 3, hr);
      c.shadedEllipse(27.5, 14.2 + bob, 5.2, 3, hr);
      c.rect(15, 8.5 + bob, 11, 2, hr.spec);
      if (ch.hairpin) {
        c.shadedRoundRect(11.5, 14.5 + bob, 4.5, 2, 0.8, ramp(ch.hairpin));
      }
      break;

    case "afro":
      c.shadedEllipse(21.5, 11 + bob, 13.6, 5.6, hr);
      c.shadedEllipse(10.8, 16 + bob, 2.6, 4.2, hr);
      c.shadedEllipse(32.2, 16 + bob, 2.6, 4.2, hr);
      c.ellipse(16, 8.5 + bob, 4.2, 2.2, hr.hi);
      break;

    case "highbun":
      c.shadedEllipse(21.5, 12.2 + bob, 12.4, 6.2, hr);
      c.shadedEllipse(11, 17 + bob, 2.2, 4.5, hr);
      c.shadedEllipse(32, 17 + bob, 2.2, 4.5, hr);
      // Soft sweeping curved fringe
      c.rect(12, 13 + bob, 19, 3, hr.base);
      c.rect(13, 15 + bob, 6, 2, hr.base);
      c.rect(24, 15 + bob, 6, 2, hr.sh);
      c.rect(19, 14 + bob, 5, 2, hr.hi);
      c.rect(15, 9 + bob, 11, 2, hr.spec);
      break;

    case "messy":
      c.shadedEllipse(21.5, 11.6 + bob, 12.8, 6.2, hr);
      c.shadedEllipse(10.8, 16.5 + bob, 2.3, 4.6, hr);
      c.shadedEllipse(32.2, 16.5 + bob, 2.3, 4.6, hr);
      // Layered tousled fringe locks (tapered downward instead of round puffs)
      c.rect(12, 12 + bob, 20, 4, hr.base);
      c.rect(13, 15 + bob, 4, 2, hr.base);
      c.rect(19, 15 + bob, 5, 3, hr.base);
      c.rect(20, 15 + bob, 2, 2, hr.hi);
      c.rect(26, 15 + bob, 4, 2, hr.sh);
      c.rect(15, 8.5 + bob, 10, 2, hr.spec);
      break;

    case "hijab":
      c.shadedEllipse(21.5, 11.8 + bob, 13.4, 6.4, hr);
      c.shadedEllipse(10.2, 22 + bob, 3.0, 10.5, hr);
      c.shadedEllipse(32.8, 22 + bob, 3.0, 10.5, hr);
      c.rect(13, 14.5 + bob, 17, 1.5, hr.deep);
      c.shadedEllipse(21.5, 33.2 + bob, 10.8, 3.6, hr);
      c.rect(30.5, 27 + bob, 2, 2, [254, 250, 242, 255]);
      break;

    case "spiky":
      // Crisp sculpted anime-style upward hair spikes (like official engineer sprite!)
      c.shadedEllipse(21.5, 11.8 + bob, 12.2, 5.6, hr);
      for (const [sx, sy, sw, sh] of [
        [12, 7, 4, 5], [16, 4, 5, 7], [21, 3, 5, 8], [26, 5, 5, 6], [30, 8, 4, 5],
      ]) {
        for (let r = 0; r < sh; r++) {
          const w = Math.max(1, Math.round(sw * ((r + 1) / sh)));
          const xStart = sx + Math.floor((sw - w) / 2);
          const col = r < 2 ? hr.hi : r < sh - 2 ? hr.base : hr.sh;
          c.rect(xStart, sy + r + bob, w, 1, col);
        }
      }
      c.rect(12, 12 + bob, 20, 3, hr.base);
      c.rect(15, 14 + bob, 4, 2, hr.base);
      c.rect(23, 14 + bob, 5, 2, hr.sh);
      c.rect(17, 8 + bob, 8, 2, hr.spec);
      c.shadedEllipse(10.8, 16 + bob, 2.0, 4.2, hr);
      c.shadedEllipse(32.2, 16 + bob, 2.0, 4.2, hr);
      break;

    case "twinpuffs":
      c.shadedEllipse(21.5, 12.2 + bob, 12.2, 5.8, hr);
      c.shadedEllipse(11, 16.5 + bob, 2.2, 4.2, hr);
      c.shadedEllipse(32, 16.5 + bob, 2.2, 4.2, hr);
      c.rect(21, 9 + bob, 1, 5, hr.deep);
      c.rect(14, 9 + bob, 5, 1.5, hr.spec);
      c.rect(24, 9 + bob, 5, 1.5, hr.spec);
      break;

    case "bald":
      c.ellipse(17, 12.5 + bob, 3.6, 2.0, sk.spec);
      c.shadedEllipse(10.8, 20.5 + bob, 1.8, 3.5, hr);
      c.shadedEllipse(32.2, 20.5 + bob, 1.8, 3.5, hr);
      break;

    case "curlyband":
      c.shadedEllipse(21.5, 12.5 + bob, 13.2, 6.6, hr);
      c.shadedEllipse(10.2, 22 + bob, 3.0, 9, hr);
      c.shadedEllipse(32.8, 22 + bob, 3.0, 9, hr);
      c.shadedEllipse(15.5, 14.5 + bob, 4.8, 2.6, hr);
      c.shadedEllipse(27.5, 14.5 + bob, 4.8, 2.6, hr);
      c.shadedRoundRect(9.5, 10.5 + bob, 24, 3.2, 1.4, ramp(ch.headband));
      break;

    case "curtain":
      c.shadedEllipse(21.5, 11.6 + bob, 13, 6.2, hr);
      c.shadedEllipse(11, 17.5 + bob, 2.5, 4.8, hr);
      c.shadedEllipse(32, 17.5 + bob, 2.5, 4.8, hr);
      // Soft diagonal blonde center-parted curtain sweep
      c.rect(11, 12 + bob, 9, 4, hr.base);
      c.rect(12, 16 + bob, 5, 2, hr.sh);
      c.rect(24, 12 + bob, 9, 4, hr.base);
      c.rect(27, 16 + bob, 5, 2, hr.sh);
      c.rect(15, 8.5 + bob, 11, 2, hr.spec);
      break;

    case "ponytail":
      c.shadedEllipse(21.5, 12.2 + bob, 12.6, 6.2, hr);
      c.shadedEllipse(10.8, 17.5 + bob, 2.4, 5.2, hr);
      c.shadedEllipse(32.2, 17.5 + bob, 2.4, 5.2, hr);
      // Sleek side-parted front framing bangs
      c.shadedEllipse(16.2, 14 + bob, 6.0, 3.2, hr);
      c.shadedEllipse(27.5, 13.6 + bob, 5.2, 2.8, hr);
      c.rect(16, 8.8 + bob, 10, 2, hr.spec);
      if (ch.hairpin) {
        c.shadedRoundRect(11.8, 14.6 + bob, 4.5, 2, 0.8, ramp(ch.hairpin));
      }
      break;

    case "beanie": {
      const cap = ramp(ch.capColor || ch.shirt);
      // Hair fringe peeking softly below the knit beanie cuff
      c.shadedEllipse(11.2, 17.5 + bob, 2.4, 4.0, hr);
      c.shadedEllipse(31.8, 17.5 + bob, 2.4, 4.0, hr);
      c.rect(13, 14.5 + bob, 17, 2.5, hr.base);
      c.rect(15, 16.5 + bob, 5, 1.5, hr.sh);
      c.rect(24, 16.5 + bob, 4, 1.5, hr.sh);
      // Cozy knit beanie dome, pom-pom & folded ribbed cuff
      c.shadedEllipse(21.5, 5.0 + bob, 3.5, 3.0, cap);
      c.shadedEllipse(21.5, 11.4 + bob, 12.8, 6.8, cap);
      c.shadedRoundRect(9.2, 11.8 + bob, 24.6, 4.5, 2.0, cap);
      for (let rx = 12; rx <= 31; rx += 3) {
        c.rect(rx, 12.4 + bob, 1, 3.2, cap.sh);
      }
      c.rect(14, 7.5 + bob, 8, 1.5, cap.spec);
      break;
    }

    case "pompadour":
      // Sculpted high executive quiff / pompadour crest
      c.shadedEllipse(22.5, 9.5 + bob, 11.8, 6.6, hr);
      c.shadedEllipse(19.5, 7.2 + bob, 8.8, 4.4, hr);
      c.shadedEllipse(10.8, 16 + bob, 2.2, 4.2, hr);
      c.shadedEllipse(32.2, 16 + bob, 2.2, 4.2, hr);
      c.rect(13, 12.2 + bob, 18, 2.5, hr.base);
      c.rect(14, 6.2 + bob, 10, 2, hr.spec);
      c.rect(13, 10.5 + bob, 12, 1.2, hr.hi);
      break;

    case "braids":
      c.shadedEllipse(21.5, 12.4 + bob, 12.8, 6.4, hr);
      c.shadedEllipse(10.6, 19.5 + bob, 2.6, 6.8, hr);
      c.shadedEllipse(32.4, 19.5 + bob, 2.6, 6.8, hr);
      c.shadedEllipse(16, 14.2 + bob, 5.4, 3.0, hr);
      c.shadedEllipse(27, 14.2 + bob, 5.4, 3.0, hr);
      c.rect(21, 9 + bob, 1, 5.5, hr.deep);
      c.rect(15, 8.8 + bob, 11, 2, hr.spec);
      break;
  }
}

function renderSprite(ch, back, frame) {
  const c = new Canvas(44, 64);
  const bob = frame === 0 ? 0 : 1;

  drawHairBackLayer(c, ch, back, bob);
  drawLegsAndShoes(c, ch, frame, bob);
  drawTorso(c, ch, back, frame, bob);
  drawHead(c, ch, back, bob);
  drawHairFrontLayer(c, ch, back, bob);
  c.outline(INK);
  return c;
}

function renderPortrait(ch) {
  const sprite = renderSprite(ch, false, 0);
  const out = new Canvas(44, 44);
  const c1 = hex(ch.bg1 || "#f3eee3");
  const c2 = hex(ch.bg2 || "#e7dfd0");
  for (let y = 0; y < 44; y++) {
    const t = y / 43;
    const row = mix(c1, c2, t);
    for (let x = 0; x < 44; x++) out.set(x, y, row);
  }
  for (let y = 0; y < 44; y++) {
    const sy = y + 2;
    if (sy >= sprite.h) continue;
    for (let x = 0; x < 44; x++) {
      const si = (sy * sprite.w + x) * 4;
      const a = sprite.buf[si + 3];
      if (a > 0) out.set(x, y, [sprite.buf[si], sprite.buf[si + 1], sprite.buf[si + 2], a]);
    }
  }
  return out;
}

/* ---------- Generate All Presets + Contact Sheet + Sync Asset Manifest ---------- */
const COLS = 6;
const ROWS = Math.ceil(CAST.length / COLS);
const sheet = new Canvas(44 * COLS + 14 * (COLS + 1), 64 * ROWS + 14 * (ROWS + 1));
sheet.rect(0, 0, sheet.w, sheet.h, hex("#f5f1e7"));

CAST.forEach((ch, idx) => {
  const dir = path.join(OUT_BASE, ch.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const back of [false, true]) {
    const side = back ? "back" : "front";
    for (const frame of [0, 1, 2]) {
      const sprite = renderSprite(ch, back, frame);
      const outPath = path.join(dir, `${side}-${frame}@2x.png`);
      fs.writeFileSync(outPath, encodePng(sprite.w, sprite.h, sprite.buf));
      if (!back && frame === 0) {
        const col = idx % COLS;
        const row = Math.floor(idx / COLS);
        const ox = 14 + col * (44 + 14);
        const oy = 14 + row * (64 + 14);
        for (let y = 0; y < sprite.h; y++) {
          for (let x = 0; x < sprite.w; x++) {
            const si = (y * sprite.w + x) * 4;
            if (sprite.buf[si + 3] > 0) {
              sheet.set(ox + x, oy + y, [sprite.buf[si], sprite.buf[si + 1], sprite.buf[si + 2], sprite.buf[si + 3]]);
            }
          }
        }
      }
    }
  }
  const portrait = renderPortrait(ch);
  fs.writeFileSync(path.join(dir, "portrait@2x.png"), encodePng(portrait.w, portrait.h, portrait.buf));
});

// Keep asset-manifest.json synchronized with CAST presets
const manifestPath = path.join(ROOT, "public/art/retina-v2.7/asset-manifest.json");
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const ch of CAST) {
    for (const side of ["front", "back"]) {
      for (const frame of [0, 1, 2]) {
        const key = `character.preset.${ch.id}.${side}.${frame}`;
        manifest.assets[key] = {
          uri: `/art/retina-v2.7/characters/presets/${ch.id}/${side}-${frame}@2x.png`,
          logicalSizePx: [22, 32],
          physicalSizePx: [44, 64],
          scale: 2,
          presetId: ch.id,
          source: "painterly cozy-chibi Retina preset generator",
        };
      }
    }
  }
  if (manifest.characterVariants) {
    manifest.characterVariants.presets = CAST.map(ch => ({
      id: ch.id,
      label: ch.label,
      skin: ch.skin,
      hair: ch.hair,
      shirt: ch.shirt,
    }));
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

const previewOut = process.argv[2];
if (previewOut) {
  fs.mkdirSync(path.dirname(previewOut), { recursive: true });
  fs.writeFileSync(previewOut, encodePng(sheet.w, sheet.h, sheet.buf));
}
console.log(`Generated ${CAST.length} painterly cozy-chibi Retina presets (${CAST.length * 6} sprites + ${CAST.length} portraits).`);
