import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { checkApiRequest } from "../lib/request-guard";
import { OFFICE_PREVIEW_LIMITS, officeToHtml } from "../lib/office-preview";
import { readJsonFile, updateJsonLocked, writeJsonAtomic } from "../lib/json-store";
import { ProcessBusyError } from "../lib/process-lock";
import { updateBook, readBook } from "../lib/contacts";

/** Build a minimal uncompressed or deflated ZIP archive buffer for OOXML parser tests. */
function makeZip(entries: { name: string; data: Buffer; compress?: boolean; fakeUncompressedSize?: number }[], fakeCount?: number): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const method = e.compress ? 8 : 0;
    const payload = e.compress ? deflateRawSync(e.data) : e.data;
    const uncomp = e.fakeUncompressedSize ?? e.data.length;

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(uncomp, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    locals.push(local, payload);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(uncomp, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);

    offset += local.length + payload.length;
  }
  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(fakeCount ?? entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

function mkReq(method: string, url: string, headers: Record<string, string> = {}) {
  return { method, url, headers: new Headers(headers) };
}

test("request guard allows same-origin loopback requests and local non-browser calls", () => {
  assert.deepEqual(checkApiRequest(mkReq("GET", "http://127.0.0.1:3456/api/office", { host: "127.0.0.1:3456" }), {}), { ok: true });
  assert.deepEqual(checkApiRequest(mkReq("POST", "http://127.0.0.1:3456/api/task", {
    host: "127.0.0.1:3456", origin: "http://127.0.0.1:3456", "sec-fetch-site": "same-origin",
  }), {}), { ok: true });
  assert.deepEqual(checkApiRequest(mkReq("PATCH", "http://localhost:3456/api/crew", {
    host: "localhost:3456", origin: "http://localhost:3456", "sec-fetch-site": "same-origin",
  }), {}), { ok: true });
  assert.deepEqual(checkApiRequest(mkReq("DELETE", "http://[::1]:3456/api/contacts", {
    host: "[::1]:3456", origin: "http://[::1]:3456",
  }), {}), { ok: true });
  // Direct curl / local script without browser origin headers.
  assert.deepEqual(checkApiRequest(mkReq("POST", "http://127.0.0.1:3456/api/task", { host: "127.0.0.1:3456" }), {}), { ok: true });
});

test("request guard blocks cross-origin CSRF, cross-port mutations, null origin, and DNS rebinding", () => {
  const crossOrigin = checkApiRequest(mkReq("POST", "http://127.0.0.1:3456/api/files", {
    host: "127.0.0.1:3456", origin: "https://evil.example", "sec-fetch-site": "cross-site",
  }), {});
  assert.equal(crossOrigin.ok, false);

  const crossPort = checkApiRequest(mkReq("POST", "http://localhost:3456/api/wa", {
    host: "localhost:3456", origin: "http://localhost:8080", "sec-fetch-site": "same-site",
  }), {});
  assert.equal(crossPort.ok, false);

  const nullOrigin = checkApiRequest(mkReq("POST", "http://127.0.0.1:3456/api/taiga", {
    host: "127.0.0.1:3456", origin: "null",
  }), {});
  assert.equal(nullOrigin.ok, false);

  const badReferer = checkApiRequest(mkReq("POST", "http://127.0.0.1:3456/api/task", {
    host: "127.0.0.1:3456", referer: "https://evil.example/page",
  }), {});
  assert.equal(badReferer.ok, false);

  // DNS rebinding: malicious Host header blocked on GET and POST alike.
  const rebindGet = checkApiRequest(mkReq("GET", "http://evil.example:3456/api/contacts", { host: "evil.example:3456" }), {});
  assert.equal(rebindGet.ok, false);
  const rebindPost = checkApiRequest(mkReq("POST", "http://evil.example:3456/api/files", {
    host: "evil.example:3456", origin: "http://evil.example:3456",
  }), {});
  assert.equal(rebindPost.ok, false);

  // Explicit allowlist and hosted deployments still work.
  assert.deepEqual(checkApiRequest(mkReq("GET", "http://office.lan:3456/api/office", { host: "office.lan:3456" }), {
    KANTOR_ALLOWED_HOSTS: "office.lan",
  }), { ok: true });
  assert.deepEqual(checkApiRequest(mkReq("GET", "https://app.vercel.app/api/office", { host: "app.vercel.app" }), {
    VERCEL: "1",
  }), { ok: true });
});

test("office-preview renders valid docx and safely rejects corrupt archives and zip bombs", () => {
  const validDocx = makeZip([{
    name: "word/document.xml",
    data: Buffer.from('<w:document><w:body><w:p><w:r><w:t>Hello &lt;safe&gt;</w:t></w:r></w:p></w:body></w:document>'),
    compress: true,
  }]);
  const html = officeToHtml("report.docx", validDocx);
  assert.match(html, /Hello &lt;safe&gt;/);

  // Truncated / non-zip inputs throw a clean error instead of RangeError.
  assert.throws(() => officeToHtml("bad.docx", Buffer.from("not a zip")), /Not a valid Office file/);
  assert.throws(() => officeToHtml("bad.docx", validDocx.subarray(0, 24)), /Not a valid Office file/);

  // Excessive entry count is rejected before iterating.
  const tooMany = makeZip([{ name: "word/document.xml", data: Buffer.from("<w:body/>") }], OFFICE_PREVIEW_LIMITS.maxEntries + 1);
  assert.throws(() => officeToHtml("many.docx", tooMany), /too many entries/i);

  // ZIP bomb: small deflated stream expanding past maxEntryBytes (even with spoofed header size).
  const hugeZeros = Buffer.alloc(OFFICE_PREVIEW_LIMITS.maxEntryBytes + 64 * 1024, 0x41);
  const bomb = makeZip([{ name: "word/document.xml", data: hugeZeros, compress: true, fakeUncompressedSize: 100 }]);
  assert.throws(() => officeToHtml("bomb.docx", bomb), /too large to preview/i);

  // Malformed unclosed XML tag terminates cleanly instead of hanging.
  const unclosedXml = makeZip([{ name: "word/document.xml", data: Buffer.from("<w:body><w:p unclosed") }]);
  assert.match(officeToHtml("odd.docx", unclosedXml), /<!doctype html>/i);
});

test("Taiga requires explicit env configuration and saves credentials atomically with 0600 permissions", async () => {
  const beforeCwd = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "kantor-taiga-test-"));
  const savedEnv = { TAIGA_URL: process.env.TAIGA_URL, TAIGA_PROJECT: process.env.TAIGA_PROJECT, TAIGA_STORY: process.env.TAIGA_STORY };
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  try {
    process.chdir(dir);
    delete process.env.TAIGA_URL;
    delete process.env.TAIGA_PROJECT;
    delete process.env.TAIGA_STORY;
    globalThis.fetch = (async () => { fetchCalls++; throw new Error("unexpected network call"); }) as typeof fetch;

    const taiga = await import("../lib/taiga");
    assert.equal(taiga.status().configured, false);
    assert.equal(taiga.status().connected, false);
    await assert.rejects(() => taiga.saveKeys("plain-token"), /not configured/i);
    await assert.rejects(() => taiga.logActivities([{ title: "Work", date: "2026-11-23", start: "09:00", minutes: 30, training: false }]), /not configured/i);
    assert.equal(fetchCalls, 0);

    // Once configured, saveKeys stores credentials atomically with owner-only permissions.
    process.env.TAIGA_URL = "https://taiga.test";
    process.env.TAIGA_PROJECT = "demo";
    process.env.TAIGA_STORY = "42";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });
      if (path === "/api/v1/users/me") return json({ id: 7, full_name_display: "Alex", username: "alex" });
      if (path === "/api/v1/projects/by_slug") return json({ id: 10, slug: "demo", name: "Demo" });
      if (path === "/api/v1/userstories/by_ref") return json({ id: 99, ref: 42, subject: "Daily Log" });
      if (path === "/api/v1/task-statuses") return json([{ id: 3, name: "Done", is_closed: true }]);
      if (path === "/api/v1/task-custom-attributes") return json([]);
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const st = await taiga.saveKeys("my-secret-token");
    assert.equal(st.configured, true);
    assert.equal(st.connected, true);
    assert.equal(st.user, "Alex");
    assert.equal(st.storyUrl, "https://taiga.test/project/demo/us/42");

    const filePath = join(dir, "data", "taiga.json");
    if (process.platform !== "win32") {
      assert.equal(statSync(filePath).mode & 0o777, 0o600);
    }
    assert.equal(readdirSync(join(dir, "data")).some(f => f.endsWith(".tmp")), false);

    const afterForget = await taiga.forget();
    assert.equal(afterForget.connected, false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    process.chdir(beforeCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("json-store atomic writes and locked contact updates prevent temp leaks and concurrent clobbers", async () => {
  const beforeCwd = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "kantor-store-test-"));
  try {
    process.chdir(dir);
    const target = join(dir, "data", "sample.json");
    writeJsonAtomic(target, { ok: true }, { mode: 0o600 });
    assert.deepEqual(readJsonFile(target, () => ({ ok: false })), { ok: true });
    if (process.platform !== "win32") assert.equal(statSync(target).mode & 0o777, 0o600);
    assert.equal(readdirSync(join(dir, "data")).some(f => f.endsWith(".tmp")), false);

    let release!: () => void;
    const held = updateJsonLocked<{ n: number }>("sample-lock", target, () => ({ n: 0 }), async cur => {
      await new Promise<void>(r => { release = r; });
      return { next: { n: cur.n + 1 }, result: { n: cur.n + 1 } };
    });
    await assert.rejects(
      () => updateJsonLocked<{ n: number }>("sample-lock", target, () => ({ n: 0 }), cur => ({ next: { n: cur.n + 1 }, result: { n: cur.n + 1 } })),
      ProcessBusyError,
    );
    release();
    await held;

    await updateBook(book => { book.contacts.push({ name: "Budi", phone: "628123456789" }, { name: "Ani", phone: "628111111111" }); });
    assert.deepEqual(readBook().contacts.map(c => c.name), ["Ani", "Budi"]);
  } finally {
    process.chdir(beforeCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});
