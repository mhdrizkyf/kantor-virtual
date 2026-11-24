import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import {
  floorPropLabel,
  parseFloorTheme,
  parseHarvestLighting,
  resolveHarvestPhase,
} from "../lib/harvest-theme";

test("all Harvest Moon 2x Retina PNG assets exist with exact expected dimensions", () => {
  const expected: Record<string, [number, number]> = {
    "farmhouse-bg@2x.png": [1536, 896],
    "meadow-tile@2x.png": [192, 192],
    "lane-tile@2x.png": [192, 64],
    "desk-north@2x.png": [72, 56],
    "desk-south@2x.png": [72, 56],
    "chair-north@2x.png": [30, 26],
    "chair-south@2x.png": [30, 40],
    "mug@2x.png": [16, 18],
    "herb@2x.png": [18, 22],
  };

  for (const [file, [w, h]] of Object.entries(expected)) {
    const buf = readFileSync(resolve(process.cwd(), "public/art/harvest-v1", file));
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
  assert.equal(floorPropLabel("harvest", "board").title, "Town Notice Board");
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
