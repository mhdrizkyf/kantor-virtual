import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import vm from "node:vm";
import {
  floorPropLabel,
  parseFloorTheme,
  parseHarvestLighting,
  resolveHarvestPhase,
} from "../lib/harvest-theme";
import { parseCodexAppServerRateLimits, readCodexQuota } from "../lib/codex-quota";

test("all Stardew Valley 2x Retina PNG assets exist with exact expected dimensions", () => {
  const expected: Record<string, [number, number]> = {
    "farmhouse-bg@2x.png": [1536, 896],
    "meadow-tile@2x.png": [192, 192],
    "lane-tile@2x.png": [192, 64],
    "tree-oak@2x.png": [96, 140],
    "tree-pine@2x.png": [96, 136],
    "bush@2x.png": [48, 40],
    "desk-north@2x.png": [72, 56],
    "desk-south@2x.png": [72, 56],
    "desk-ceo@2x.png": [72, 56],
    "chair-north@2x.png": [30, 26],
    "chair-south@2x.png": [30, 40],
    "chair-ceo@2x.png": [30, 26],
    "mug@2x.png": [16, 18],
    "herb@2x.png": [18, 22],
    "chicken-white@2x.png": [64, 32],
    "chicken-brown@2x.png": [64, 32],
    "cat-ginger@2x.png": [96, 32],
    "cat-tuxedo@2x.png": [96, 32],
    "rabbit-white@2x.png": [64, 32],
    "rabbit-cinnamon@2x.png": [64, 32],
  };

  for (const [file, [w, h]] of Object.entries(expected)) {
    const buf = readFileSync(resolve(process.cwd(), "public/art/stardew-v1", file));
    assert.equal(buf.readUInt32BE(16), w, `${file} width`);
    assert.equal(buf.readUInt32BE(20), h, `${file} height`);
  }
});

test("resolveHarvestPhase maps office timezone, open/closed switch, and manual overrides", () => {
  assert.equal(parseFloorTheme(null), "harvest");
  assert.equal(parseFloorTheme("campus"), "campus");
  assert.equal(parseHarvestLighting("sunset"), "sunset");
  assert.equal(parseHarvestLighting("invalid"), "auto");

  // Asia/Jakarta is UTC+7
  assert.equal(resolveHarvestPhase("auto", "Asia/Jakarta", true, new Date("2026-11-24T00:30:00Z")), "morning"); // 07:30
  assert.equal(resolveHarvestPhase("auto", "Asia/Jakarta", true, new Date("2026-11-24T05:00:00Z")), "day"); // 12:00
  assert.equal(resolveHarvestPhase("auto", "Asia/Jakarta", true, new Date("2026-11-24T10:30:00Z")), "sunset"); // 17:30
  assert.equal(resolveHarvestPhase("auto", "Asia/Jakarta", true, new Date("2026-11-24T14:00:00Z")), "night"); // 21:00
  // Closed office shows cozy lantern night in Auto mode
  assert.equal(resolveHarvestPhase("auto", "Asia/Jakarta", false, new Date("2026-11-24T05:00:00Z")), "night");
  // Manual overrides ignore clock & office closed state
  assert.equal(resolveHarvestPhase("sunset", "Asia/Jakarta", false, new Date("2026-11-24T05:00:00Z")), "sunset");
  assert.equal(floorPropLabel("harvest", "board").title, "Help Wanted Board");
  assert.equal(floorPropLabel("campus", "board").title, "Task Board");
});

test("public/office-harvest.js installs cleanly, switches phases live, and uninstalls reversibly", () => {
  const window: Record<string, any> = {
    MDOffice: {
      T: 16,
      retinaWorkstation: {
        laptopState: () => "working",
        decorMode: () => "both",
      },
    },
  };
  vm.runInNewContext(readFileSync(resolve(process.cwd(), "public/office-harvest.js"), "utf8"), {
    window,
    Map,
    Math,
    Date,
    String,
    Number,
    Object,
    Promise,
  });

  const harvest = window.MDOffice.harvest;
  assert.ok(harvest && typeof harvest.install === "function");

  let draws = 0;
  const origWin = () => "campus-win";
  const origDesk = () => "campus-desk";
  const origChair = () => "campus-chair";
  const scene: any = {
    W: 768,
    H: 448,
    t: 1,
    time: 21,
    L: { desks: [{ x: 13, y: 7, seat: "n" }] },
    agents: [],
    drawWindows: origWin,
    drawCampusDesk: origDesk,
    drawCampusChair: origChair,
    onDraw: null,
    draw: () => { draws++; },
  };

  const mockPack = new Map([
    ["bg", { image: {}, w: 768, h: 448 }],
    ["deskNorth", { image: {}, w: 36, h: 28 }],
    ["deskSouth", { image: {}, w: 36, h: 28 }],
    ["chairNorth", { image: {}, w: 15, h: 13 }],
    ["chairSouth", { image: {}, w: 15, h: 20 }],
    ["mug", { image: {}, w: 8, h: 9 }],
    ["herb", { image: {}, w: 9, h: 11 }],
  ]);

  assert.equal(harvest.install(scene, mockPack, null, "sunset"), true);
  assert.equal(scene.time, 12);
  assert.equal(scene.harvestTheme.getPhase(), "sunset");
  assert.notEqual(scene.drawWindows, origWin);
  assert.notEqual(scene.drawCampusDesk, origDesk);

  // Interactive workspace critters (chickens, cats, rabbits) are registered and can be petted!
  const critters = scene.harvestTheme.getCritters();
  assert.ok(Array.isArray(critters) && critters.length >= 6);
  const kinds = new Set(critters.map((c: any) => c.kind));
  assert.deepEqual([...kinds].sort(), ["cat", "chicken", "rabbit"]);
  scene.harvestTheme.petCritter(critters[0]);
  assert.ok(critters[0].emoteT > 0 && critters[0].jumpT > 0);

  scene.harvestTheme.setPhase("night");
  assert.equal(scene.harvestTheme.getPhase(), "night");
  assert.ok(draws >= 2);

  scene.harvestTheme.uninstall();
  assert.equal(scene.harvestTheme, null);
  assert.equal(scene.time, 21);
  assert.equal(scene.drawWindows, origWin);
  assert.equal(scene.drawCampusDesk, origDesk);
  assert.equal(scene.drawCampusChair, origChair);
});

test("readCodexQuota syncs real remaining 5h & weekly percentages and resets expired windows", () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-quota-test-"));
  try {
    const sessDir = join(dir, "sessions", "2026", "11", "24");
    mkdirSync(sessDir, { recursive: true });
    const nowSec = Math.floor(Date.parse("2026-11-24T10:00:00Z") / 1000);
    writeFileSync(
      join(sessDir, "rollout-2026-11-24T10-00-00.jsonl"),
      JSON.stringify({
        payload: {
          rate_limits: {
            limit_id: "codex",
            plan_type: "plus",
            primary: { used_percent: 28, window_minutes: 300, resets_at: nowSec + 7200 },
            secondary: { used_percent: 42, window_minutes: 10080, resets_at: nowSec + 86400 },
            credits: { has_credits: false, unlimited: false, balance: "0" },
          },
        },
      }) + "\n"
    );

    const active = readCodexQuota({
      runtimes: [{ provider: "codex", online: true, quotaOut: false, quotaReset: null }],
      timeZone: "Asia/Jakarta",
      codexHome: dir,
      now: new Date(nowSec * 1000),
    });
    assert.equal(active.source, "codex-session");
    assert.equal(active.remaining5h, 72);
    assert.equal(active.remainingWeekly, 58);
    assert.equal(active.planType, "plus");
    assert.ok(active.reset5hAt);

    // Once primary 5h reset timestamp passes, remaining5h resets cleanly to 100%
    const afterReset = readCodexQuota({
      runtimes: [{ provider: "codex", online: true, quotaOut: false, quotaReset: null }],
      timeZone: "Asia/Jakarta",
      codexHome: dir,
      now: new Date((nowSec + 8000) * 1000),
    });
    assert.equal(afterReset.remaining5h, 100);
    assert.equal(afterReset.remainingWeekly, 58);

    // Live Multica quota-out error always clamps remaining5h to 0%
    const capped = readCodexQuota({
      runtimes: [{ provider: "codex", online: true, quotaOut: true, quotaReset: "21:30" }],
      timeZone: "Asia/Jakarta",
      codexHome: dir,
      now: new Date(nowSec * 1000),
    });
    assert.equal(capped.source, "multica-quota");
    assert.equal(capped.remaining5h, 0);
    assert.equal(capped.reset5hAt, "21:30");

    // Live codex app-server RPC response parses real 5h & weekly remaining percentages accurately
    const live = parseCodexAppServerRateLimits(
      {
        ordinaryUsageAllowed: true,
        rateLimits: {
          limitId: "codex",
          planType: "plus",
          primary: { usedPercent: 2, windowDurationMins: 300, resetsAt: nowSec + 18000 },
          secondary: { usedPercent: 71, windowDurationMins: 10080, resetsAt: nowSec + 345600 },
          credits: { hasCredits: false, unlimited: false, balance: "0" },
        },
      },
      {
        runtimes: [{ provider: "codex", online: true, quotaOut: true, quotaReset: null }],
        timeZone: "Asia/Jakarta",
        now: new Date(nowSec * 1000),
      }
    );
    assert.ok(live);
    assert.equal(live.source, "codex-live");
    assert.equal(live.remaining5h, 98);
    assert.equal(live.remainingWeekly, 29);
    assert.equal(live.planType, "plus");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
