// Preview Office files (PowerPoint, Word, Excel) without leaving Virtual Office.
// The files are zip archives of XML; this reads them with Node's own zlib (no extra packages)
// and turns them into simple, static HTML (no scripts) that the app shows in a sandboxed frame.
import "server-only";
import { inflateRawSync } from "node:zlib";

// ---------- zip ----------
export const OFFICE_PREVIEW_LIMITS = {
  maxArchiveBytes: 50 * 1024 * 1024,
  maxEntries: 2000,
  maxEntryBytes: 10 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
} as const;

type Zip = Map<string, () => Buffer>;
function unzip(buf: Buffer): Zip {
  if (buf.length < 22) throw new Error("Not a valid Office file.");
  if (buf.length > OFFICE_PREVIEW_LIMITS.maxArchiveBytes) throw new Error("Office file is too large to preview.");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Not a valid Office file.");
  const count = buf.readUInt16LE(eocd + 10);
  if (count > OFFICE_PREVIEW_LIMITS.maxEntries) throw new Error("Office file has too many entries to preview.");
  let p = buf.readUInt32LE(eocd + 16);
  const out: Zip = new Map();
  let totalInflated = 0;
  for (let n = 0; n < count && p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), uncompressed = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const next = p + 46 + nameLen + extraLen + commentLen;
    if (next > buf.length) throw new Error("Not a valid Office file.");
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    out.set(name, () => {
      if (method !== 0 && method !== 8) throw new Error("Unsupported Office compression format.");
      if (uncompressed > OFFICE_PREVIEW_LIMITS.maxEntryBytes) throw new Error("Office file is too large to preview.");
      if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error("Not a valid Office file.");
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      if (start + size > buf.length) throw new Error("Not a valid Office file.");
      const remaining = OFFICE_PREVIEW_LIMITS.maxTotalBytes - totalInflated;
      const limit = Math.min(OFFICE_PREVIEW_LIMITS.maxEntryBytes, remaining);
      if (limit <= 0) throw new Error("Office file is too large to preview.");
      const data = buf.subarray(start, start + size);
      let entry: Buffer;
      if (method === 8) {
        try { entry = inflateRawSync(data, { maxOutputLength: limit }); }
        catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") throw new Error("Office file is too large to preview.");
          throw new Error("Not a valid Office file.");
        }
      } else {
        if (data.length > limit) throw new Error("Office file is too large to preview.");
        entry = Buffer.from(data);
      }
      totalInflated += entry.length;
      return entry;
    });
    p = next;
  }
  return out;
}
const text = (z: Zip, name: string) => { const f = z.get(name); return f ? f().toString("utf8") : ""; };

// ---------- xml helpers ----------
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, "&");
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const attr = (tag: string, name: string) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? unesc(m[1]) : null; };
/** Top-level <tag>…</tag> blocks (handles nesting of the same tag). */
function blocks(xml: string, tag: string): string[] {
  const out: string[] = []; const open = new RegExp(`<${tag}[\\s>/]`, "g"); const close = `</${tag}>`;
  let m: RegExpExecArray | null;
  while ((m = open.exec(xml))) {
    const start = m.index;
    const selfEnd = xml.indexOf(">", start);
    if (selfEnd < 0) break;
    if (xml[selfEnd - 1] === "/") { out.push(xml.slice(start, selfEnd + 1)); open.lastIndex = selfEnd + 1; continue; }
    let depth = 1, i = selfEnd + 1;
    while (depth > 0) {
      const o = xml.slice(i).search(new RegExp(`<${tag}[\\s>]`)), c = xml.indexOf(close, i);
      if (c < 0) { i = xml.length; break; }
      if (o >= 0 && i + o < c) { depth++; i = i + o + tag.length + 1; } else { depth--; i = c + close.length; }
    }
    out.push(xml.slice(start, i)); open.lastIndex = i;
  }
  return out;
}
const first = (xml: string, tag: string) => blocks(xml, tag)[0] ?? "";
function rels(z: Zip, path: string): Map<string, string> {
  const dir = path.slice(0, path.lastIndexOf("/") + 1), base = path.slice(dir.length);
  const xml = text(z, `${dir}_rels/${base}.rels`);
  const m = new Map<string, string>();
  for (const r of xml.match(/<Relationship\s[^>]*>/g) ?? []) {
    const id = attr(r, "Id"), t = attr(r, "Target"); if (!id || !t) continue;
    m.set(id, attr(r, "TargetMode") === "External" ? t : resolve(dir, t));
  }
  return m;
}
function resolve(dir: string, target: string) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = (dir + target).split("/"); const out: string[] = [];
  for (const p of parts) { if (p === "..") out.pop(); else if (p && p !== ".") out.push(p); }
  return out.join("/");
}
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", bmp: "image/bmp" };
/** Images are embedded in the preview; very large ones are left out to keep it quick. */
function dataUri(z: Zip, path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""; const f = z.get(path);
  if (!f || !MIME[ext]) return null;
  const b = f(); if (b.length > 2_500_000) return null;
  return `data:${MIME[ext]};base64,${b.toString("base64")}`;
}
const color = (xml: string) => { const m = /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(xml); return m ? `#${m[1]}` : null; };

const PAGE = (body: string, css: string) => `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;padding:14px;font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:#eceaf0;color:#222}
${css}</style></head><body>${body}</body></html>`;

// ---------- PowerPoint ----------
type Box = { x: number; y: number; w: number; h: number };
function xfrmOf(sp: string): Box | null {
  const x = first(sp, "a:xfrm"); if (!x) return null;
  const off = /<a:off x="(-?\d+)" y="(-?\d+)"/.exec(x), ext = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(x);
  return off && ext ? { x: +off[1], y: +off[2], w: +ext[1], h: +ext[2] } : null;
}
const phOf = (sp: string) => { const t = /<p:ph[^>]*>/.exec(sp)?.[0]; return t ? { type: attr(t, "type") ?? "body", idx: attr(t, "idx") } : null; };
function findPh(xml: string, ph: { type: string; idx: string | null }): string | null {
  const shapes = blocks(xml, "p:sp");
  const same = (s: string) => { const p = phOf(s); return p && (ph.idx && p.idx === ph.idx || p.type === ph.type || (ph.type === "ctrTitle" && p.type === "title") || (ph.type === "subTitle" && p.type === "body")); };
  return shapes.find(same) ?? null;
}

export function pptxToHtml(buf: Buffer): string {
  const z = unzip(buf);
  const pres = text(z, "ppt/presentation.xml");
  const sz = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(pres);
  const W = sz ? +sz[1] : 12192000, H = sz ? +sz[2] : 6858000;
  const presRels = rels(z, "ppt/presentation.xml");
  const order = (pres.match(/<p:sldId [^>]*>/g) ?? []).map(t => presRels.get(attr(t, "r:id") ?? "")).filter((x): x is string => !!x);
  const slides = order.length ? order : [...z.keys()].filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => +a.match(/\d+/)![0] - +b.match(/\d+/)![0]);
  const pct = (v: number, of: number) => `${(v / of * 100).toFixed(3)}%`;
  const fontCqw = (hundredthsPt: number) => `${(hundredthsPt / 100 / (W / 12700) * 100).toFixed(3)}cqw`;

  const html = slides.map((path, n) => {
    const xml = text(z, path); const r = rels(z, path);
    const layoutPath = [...r.values()].find(v => v.includes("slideLayouts/")) ?? "";
    const layout = layoutPath ? text(z, layoutPath) : "";
    const masterPath = layoutPath ? [...rels(z, layoutPath).values()].find(v => v.includes("slideMasters/")) ?? "" : "";
    const master = masterPath ? text(z, masterPath) : "";
    const bg = color(first(xml, "p:bg")) ?? color(first(layout, "p:bg")) ?? color(first(master, "p:bg")) ?? "#ffffff";
    const bgImg = (() => { const b = first(xml, "p:bg"); const id = /r:embed="([^"]+)"/.exec(b)?.[1]; return id && r.get(id) ? dataUri(z, r.get(id)!) : null; })();
    const parts: string[] = [];
    const tree = first(xml, "p:spTree");
    // Shapes and pictures in drawing order (groups are flattened; their own offset is ignored).
    const items = tree.match(/<p:(sp|pic)[\s>][\s\S]*?<\/p:\1>/g) ?? [];
    for (const it of items) {
      if (it.startsWith("<p:pic")) {
        const box = xfrmOf(it); const id = /r:embed="([^"]+)"/.exec(it)?.[1]; const src = id && r.get(id) ? dataUri(z, r.get(id)!) : null;
        if (box && src) parts.push(`<img src="${src}" style="left:${pct(box.x, W)};top:${pct(box.y, H)};width:${pct(box.w, W)};height:${pct(box.h, H)};object-fit:contain">`);
        continue;
      }
      const ph = phOf(it);
      const inherit = ph ? (findPh(layout, ph) ?? findPh(master, ph)) : null;
      const box = xfrmOf(it) ?? (inherit ? xfrmOf(inherit) : null);
      const body = first(it, "p:txBody");
      const fill = color(first(it, "p:spPr").replace(/<a:ln[\s\S]*?<\/a:ln>/g, ""));
      const isTitle = ph && /title|ctrTitle/i.test(ph.type);
      const defSz = isTitle ? 3600 : ph?.type === "subTitle" ? 2400 : 1800;
      const paras = blocks(body, "a:p").map(p => {
        const runs = (p.match(/<a:(r|fld)>[\s\S]*?<\/a:\1>/g) ?? []).map(run => {
          const rp = /<a:rPr[^>]*\/?>(?:[\s\S]*?<\/a:rPr>)?/.exec(run)?.[0] ?? "";
          const t = unesc((run.match(/<a:t>([\s\S]*?)<\/a:t>/) ?? [])[1] ?? "");
          const s = attr(rp, "sz"); const c = color(rp);
          const style = [s ? `font-size:${fontCqw(+s)}` : "", attr(rp, "b") === "1" ? "font-weight:700" : "", attr(rp, "i") === "1" ? "font-style:italic" : "", c ? `color:${c}` : ""].filter(Boolean).join(";");
          return style ? `<span style="${style}">${esc(t)}</span>` : esc(t);
        }).join("");
        const lvl = +(attr(/<a:pPr[^>]*>/.exec(p)?.[0] ?? "", "lvl") ?? 0);
        const algn = attr(/<a:pPr[^>]*>/.exec(p)?.[0] ?? "", "algn");
        const bullet = !isTitle && ph && ph.type === "body" && runs && !/<a:buNone\/>/.test(p);
        return runs ? `<p style="margin-left:${lvl * 4}%;${algn === "ctr" ? "text-align:center;" : algn === "r" ? "text-align:right;" : ""}">${bullet ? "• " : ""}${runs}</p>` : "";
      }).join("");
      if (!box || (!paras && !fill)) continue;
      const anchor = attr(/<a:bodyPr[^>]*>/.exec(body)?.[0] ?? "", "anchor");
      parts.push(`<div class="t" style="left:${pct(box.x, W)};top:${pct(box.y, H)};width:${pct(box.w, W)};height:${pct(box.h, H)};font-size:${fontCqw(defSz)};${fill ? `background:${fill};` : ""}${isTitle ? "font-weight:700;" : ""}justify-content:${anchor === "ctr" ? "center" : anchor === "b" ? "flex-end" : "flex-start"}">${paras}</div>`);
    }
    return `<section><div class="n">Slide ${n + 1} of ${slides.length}</div><div class="s" style="aspect-ratio:${W}/${H};background:${bg}${bgImg ? ` url(${bgImg}) center/cover` : ""}">${parts.join("")}</div></section>`;
  }).join("");
  return PAGE(html || "<p>No slides found.</p>", `
section{max-width:960px;margin:0 auto 18px}.n{font-size:12px;color:#666;margin:0 0 4px 2px}
.s{position:relative;width:100%;container-type:inline-size;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.25);border-radius:4px}
.s>*{position:absolute}.t{display:flex;flex-direction:column;overflow:hidden;padding:.6cqw .9cqw;line-height:1.2}
.t p{margin:0 0 .25em}`);
}

// ---------- Word ----------
export function docxToHtml(buf: Buffer): string {
  const z = unzip(buf);
  const doc = text(z, "word/document.xml"); const r = rels(z, "word/document.xml");
  const body = first(doc, "w:body");
  const runHtml = (p: string): string => (p.match(/<w:r[\s>][\s\S]*?<\/w:r>|<w:hyperlink[\s\S]*?<\/w:hyperlink>/g) ?? []).map((run): string => {
    if (run.startsWith("<w:hyperlink")) return runHtml(run.replace(/^<w:hyperlink[^>]*>/, ""));
    const rp = first(run, "w:rPr");
    const img = /r:embed="([^"]+)"/.exec(run)?.[1]; const src = img && r.get(img) ? dataUri(z, r.get(img)!) : null;
    if (src) return `<img src="${src}">`;
    let t = (run.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g) ?? []).map(x => x === "<w:tab/>" ? "\t" : x === "<w:br/>" ? "\n" : unesc(x.replace(/<[^>]+>/g, ""))).join("");
    t = esc(t).replace(/\n/g, "<br>");
    if (/<w:b(\s+w:val="(1|true)")?\/>/.test(rp)) t = `<b>${t}</b>`;
    if (/<w:i(\s+w:val="(1|true)")?\/>/.test(rp)) t = `<i>${t}</i>`;
    if (/<w:u\s/.test(rp) && !/w:val="none"/.test(first(rp, "w:u"))) t = `<u>${t}</u>`;
    return t;
  }).join("");
  const para = (p: string) => {
    const style = attr(/<w:pStyle [^>]*>/.exec(p)?.[0] ?? "", "w:val") ?? "";
    const inner = runHtml(p);
    const h = /^(Heading|Kop)(\d)$/i.exec(style)?.[2] ?? (/^Title$/i.test(style) ? "1" : null);
    if (h) return `<h${Math.min(+h + (style.match(/Title/i) ? 0 : 0), 6)}>${inner}</h${h}>`;
    if (/<w:numPr>/.test(p)) { const lvl = +(attr(/<w:ilvl [^>]*>/.exec(p)?.[0] ?? "", "w:val") ?? 0); return `<p class="li" style="margin-left:${1.4 + lvl * 1.4}em">• ${inner}</p>`; }
    return inner ? `<p>${inner}</p>` : "<p>&nbsp;</p>";
  };
  let out = "";
  for (const el of body.match(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[\s>][\s\S]*?<\/w:p>|<w:p\/>/g) ?? []) {
    if (el.startsWith("<w:tbl")) {
      out += "<table>" + blocks(el, "w:tr").map(tr => "<tr>" + blocks(tr, "w:tc").map(tc => `<td>${blocks(tc, "w:p").map(para).join("")}</td>`).join("") + "</tr>").join("") + "</table>";
    } else out += el === "<w:p/>" ? "" : para(el);
  }
  return PAGE(`<article>${out || "<p>This document is empty.</p>"}</article>`, `
article{max-width:800px;margin:0 auto;background:#fff;padding:48px 56px;box-shadow:0 1px 4px rgba(0,0,0,.2);border-radius:4px;font:15px/1.55 Georgia,"Times New Roman",serif}
h1,h2,h3,h4{font-family:-apple-system,"Segoe UI",Arial,sans-serif;line-height:1.25;margin:1.1em 0 .4em}p{margin:0 0 .6em}.li{margin-bottom:.25em}
table{border-collapse:collapse;width:100%;margin:.8em 0}td{border:1px solid #bbb;padding:5px 7px;vertical-align:top}td p{margin:0}img{max-width:100%}`);
}

// ---------- Excel ----------
export function xlsxToHtml(buf: Buffer): string {
  const z = unzip(buf);
  const shared = blocks(text(z, "xl/sharedStrings.xml"), "si").map(si => unesc((si.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) ?? []).map(t => t.replace(/<[^>]+>/g, "")).join("")));
  const wb = text(z, "xl/workbook.xml"); const r = rels(z, "xl/workbook.xml");
  const sheets = (wb.match(/<sheet [^>]*>/g) ?? []).map(t => ({ name: attr(t, "name") ?? "Sheet", path: r.get(attr(t, "r:id") ?? "") ?? "" })).filter(s => s.path);
  const colNum = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const html = sheets.map((s, i) => {
    const rows = blocks(text(z, s.path), "row").slice(0, 300).map(row => {
      const cells: string[] = [];
      for (const c of row.match(/<c [^>]*\/>|<c [^>]*>[\s\S]*?<\/c>/g) ?? []) {
        const tag = /<c [^>]*>/.exec(c)![0]; const t = attr(tag, "t"); const ref = attr(tag, "r") ?? "";
        const v = (c.match(/<v>([\s\S]*?)<\/v>/) ?? [])[1];
        const raw = t === "s" ? shared[+(v ?? -1)] ?? "" : t === "inlineStr" ? unesc((c.match(/<t[^>]*>([\s\S]*?)<\/t>/) ?? [])[1] ?? "") : unesc(v ?? "");
        // Numbers are stored with float noise (4.0999999999); show them the way Excel does.
        const val = !t || t === "n" ? (/^-?\d+\.\d{6,}$/.test(raw) ? String(parseFloat((+raw).toPrecision(12))) : raw) : raw;
        cells[ref ? colNum(ref) : cells.length] = val;
      }
      return cells;
    });
    const width = Math.min(40, Math.max(0, ...rows.map(r => r.length)));
    const body = rows.map(r => "<tr>" + Array.from({ length: width }, (_, j) => `<td>${esc(r[j] ?? "")}</td>`).join("") + "</tr>").join("");
    return `<h3>${esc(s.name)}</h3><div class="w"><table>${body}</table></div>${i < sheets.length - 1 ? "" : ""}`;
  }).join("");
  return PAGE(html || "<p>No sheets found.</p>", `
h3{font-size:14px;margin:14px 0 6px}.w{overflow:auto;background:#fff;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.2)}
table{border-collapse:collapse;font-size:13px}td{border:1px solid #ddd;padding:4px 8px;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis}
tr:first-child td{background:#f3f1f6;font-weight:600}`);
}

export function officeToHtml(name: string, buf: Buffer): string {
  const e = name.toLowerCase().split(".").pop();
  if (e === "pptx") return pptxToHtml(buf);
  if (e === "docx") return docxToHtml(buf);
  if (e === "xlsx") return xlsxToHtml(buf);
  throw new Error("This file type can't be previewed.");
}
