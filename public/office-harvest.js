/* Kantor Virtual — Stardew Valley 2x Retina Farmhouse Theme Adapter v2.0.
 * Transforms the 48x28 campus floor into a cozy Stardew Valley / Pelican Town
 * farmhouse studio built from real open-source 32x32 hand-pixeled LPC tilesets,
 * with drifting spring blossom petals, fluttering butterflies, crackling kitchen
 * woodstove & lounge brick hearth embers, rising steam, glowing fireflies, and
 * dynamic Dawn/Midday/Sunset/Night Pelican Town lighting.
 * Preserves 100% of Multica state, pathfinding, hitboxes, laptops, and 12 characters.
 */
(function (root) {
  'use strict';
  var O = root.MDOffice;
  if (!O) return;

  var ASSET_BASE = '/art/stardew-v1/';
  var ASSET_VER = '?v=7';
  var ASSETS = {
    bg: { uri: ASSET_BASE + 'farmhouse-bg@2x.png', w: 768, h: 448 },
    meadow: { uri: ASSET_BASE + 'meadow-tile@2x.png', w: 96, h: 96 },
    lane: { uri: ASSET_BASE + 'lane-tile@2x.png', w: 96, h: 32 },
    treeOak: { uri: ASSET_BASE + 'tree-oak@2x.png', w: 48, h: 70 },
    treePine: { uri: ASSET_BASE + 'tree-pine@2x.png', w: 48, h: 68 },
    bush: { uri: ASSET_BASE + 'bush@2x.png', w: 24, h: 20 },
    deskNorth: { uri: ASSET_BASE + 'desk-north@2x.png', w: 36, h: 28 },
    deskSouth: { uri: ASSET_BASE + 'desk-south@2x.png', w: 36, h: 28 },
    chairNorth: { uri: ASSET_BASE + 'chair-north@2x.png', w: 15, h: 13 },
    chairSouth: { uri: ASSET_BASE + 'chair-south@2x.png', w: 15, h: 20 },
    mug: { uri: ASSET_BASE + 'mug@2x.png', w: 8, h: 9 },
    herb: { uri: ASSET_BASE + 'herb@2x.png', w: 9, h: 11 },
    chickenWhite: { uri: ASSET_BASE + 'chicken-white@2x.png', w: 32, h: 16 },
    chickenBrown: { uri: ASSET_BASE + 'chicken-brown@2x.png', w: 32, h: 16 },
    catGinger: { uri: ASSET_BASE + 'cat-ginger@2x.png', w: 48, h: 16 },
    catTuxedo: { uri: ASSET_BASE + 'cat-tuxedo@2x.png', w: 48, h: 16 },
    rabbitWhite: { uri: ASSET_BASE + 'rabbit-white@2x.png', w: 32, h: 16 },
    rabbitCinnamon: { uri: ASSET_BASE + 'rabbit-cinnamon@2x.png', w: 32, h: 16 },
  };

  var loading = null;
  function load() {
    if (loading) return loading;
    loading = (async function () {
      var entries = await Promise.all(
        Object.keys(ASSETS).map(async function (key) {
          var spec = ASSETS[key];
          var img = new Image();
          img.src = spec.uri + ASSET_VER;
          if (typeof img.decode === 'function') await img.decode();
          else {
            await new Promise(function (resolve, reject) {
              img.onload = resolve;
              img.onerror = function () { reject(new Error('Harvest asset load failed: ' + key)); };
            });
          }
          return [key, { image: img, w: spec.w, h: spec.h }];
        })
      );
      return new Map(entries);
    })().catch(function (err) {
      loading = null;
      throw err;
    });
    return loading;
  }

  function drawImg(g, pack, key, x, y, w, h) {
    var item = pack.get(key);
    if (!item) return;
    g.imageSmoothingEnabled = false;
    g.drawImage(item.image, Math.round(x), Math.round(y), w != null ? w : item.w, h != null ? h : item.h);
  }

  function phaseWashColor(phase) {
    if (phase === 'morning') return 'rgba(255, 206, 172, 0.13)';
    if (phase === 'sunset') return 'rgba(232, 126, 48, 0.24)';
    if (phase === 'night') return 'rgba(18, 24, 58, 0.44)';
    return null;
  }

  function paintSurroundings(cv, width, height, stageWidth, stageHeight, pack, phase) {
    if (!cv || !pack) return;
    var T = O.T || 16;
    cv.width = Math.max(1, Math.round(width));
    cv.height = Math.max(1, Math.round(height));
    var g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    var scale = stageWidth / (48 * T);
    var left = (width - stageWidth) / 2;
    var top = (height - stageHeight) / 2;

    var meadow = pack.get('meadow');
    var lane = pack.get('lane');
    var treeOak = pack.get('treeOak');
    var treePine = pack.get('treePine');
    var bush = pack.get('bush');

    // Fill with exact uniform Stardew meadow base RGB (#509a3b) so fractional DPI scaling never creates 1px tile seams!
    g.fillStyle = '#509a3b';
    g.fillRect(0, 0, cv.width, cv.height);

    g.save();
    g.translate(left, top);
    g.scale(scale, scale);

    var minX = Math.floor(-left / scale / 96) * 96 - 96;
    var maxX = Math.ceil((width - left) / scale / 96) * 96 + 96;
    var minY = Math.floor(-top / scale / 96) * 96 - 96;
    var maxY = Math.ceil((height - top) / scale / 96) * 96 + 96;

    if (meadow) {
      for (var y = minY; y < maxY; y += 96) {
        for (var x = minX; x < maxX; x += 96) {
          g.drawImage(meadow.image, x, y, 96.5, 96.5);
        }
      }
    }

    var roadY = 26 * T;
    if (lane) {
      // Draw the pebbled grass-to-dirt top border ONCE along roadY (exact 96px alignment with farmhouse-bg!)
      for (var rx = minX; rx < maxX; rx += 96) {
        g.drawImage(lane.image, rx, roadY, 96.5, 32.5);
      }
      // Below roadY + 32, tile ONLY the solid dirt lower half (sy=32, sh=32) so the grass border NEVER repeats!
      for (var ry = roadY + 32; ry < maxY; ry += 16) {
        for (var rx2 = minX; rx2 < maxX; rx2 += 96) {
          g.drawImage(lane.image, 0, 32, 192, 32, rx2, ry, 96.5, 16.5);
        }
      }
    }

    // Scatter lush, 100% UNCLIPPED Pelican Town Oak & Pine forest + berry bushes in the outer meadow margins!
    // Every prop sits safely outside the [0..768, 0..448] stage rect so ZERO trees are ever cut in half at the stage edge!
    var stageW = 48 * T;
    var props = [];
    // Left forest grove (x < -48 ensures right canopy edge never crosses x = 0!)
    var leftCols = [-76, -138, -206, -278];
    var yRows = [-24, 52, 134, 218, 302];
    for (var li = 0; li < leftCols.length; li++) {
      for (var yi = 0; yi < yRows.length; yi++) {
        var lx = leftCols[li] + ((yi * 17 + li * 11) % 21) - 10;
        var ly = yRows[yi] + ((li * 29 + yi * 13) % 25) - 12;
        if (lx + 48 < minX || lx > -48) continue;
        if (ly + 70 > roadY - 8) continue;
        var seedL = (li * 7 + yi * 5) % 5;
        if (seedL === 0 || seedL === 3) props.push({ y: ly + 70, kind: 'oak', x: lx, py: ly });
        else if (seedL === 1 || seedL === 4) props.push({ y: ly + 68, kind: 'pine', x: lx, py: ly });
        else props.push({ y: ly + 50, kind: 'bush', x: lx + 12, py: ly + 30 });
      }
    }
    // Right forest grove (x >= stageW + 6 ensures left canopy edge never crosses x = 768!)
    var rightCols = [stageW + 14, stageW + 76, stageW + 144, stageW + 216];
    for (var ri = 0; ri < rightCols.length; ri++) {
      for (var ryi = 0; ryi < yRows.length; ryi++) {
        var rxp = rightCols[ri] + ((ryi * 19 + ri * 13) % 21) - 8;
        var ryp = yRows[ryi] + ((ri * 23 + ryi * 17) % 25) - 12;
        if (rxp > maxX || rxp < stageW + 4) continue;
        if (ryp + 70 > roadY - 8) continue;
        var seedR = (ri * 5 + ryi * 3 + 1) % 5;
        if (seedR === 0 || seedR === 2) props.push({ y: ryp + 70, kind: 'pine', x: rxp, py: ryp });
        else if (seedR === 1 || seedR === 4) props.push({ y: ryp + 68, kind: 'oak', x: rxp, py: ryp });
        else props.push({ y: ryp + 50, kind: 'bush', x: rxp + 10, py: ryp + 30 });
      }
    }
    // North forest canopy strip above the farmhouse when tall viewports show extra top meadow (y + 70 <= -4)
    if (minY < -74) {
      for (var nx = -20; nx < stageW - 20; nx += 78) {
        var ny = -78 - ((Math.abs(nx) * 7) % 18);
        props.push({ y: ny + 70, kind: ((nx / 78) | 0) % 2 === 0 ? 'oak' : 'pine', x: nx, py: ny });
      }
    }
    // Y-sort forest props for crisp top-down overlap depth
    props.sort(function (a, b) { return a.y - b.y; });
    for (var pi = 0; pi < props.length; pi++) {
      var pr = props[pi];
      var asset = pr.kind === 'oak' ? treeOak : pr.kind === 'pine' ? treePine : bush;
      if (asset) g.drawImage(asset.image, Math.round(pr.x), Math.round(pr.py), asset.w, asset.h);
    }

    g.restore();

    var wash = phaseWashColor(phase);
    if (wash) {
      g.fillStyle = wash;
      g.fillRect(0, 0, cv.width, cv.height);
    }
  }

  var FIREFLIES = [
    { x: 56, y: 18, sx: 14, sy: 5, f: 0.7, p: 0.2 },
    { x: 185, y: 16, sx: 18, sy: 6, f: 0.55, p: 1.4 },
    { x: 340, y: 15, sx: 22, sy: 5, f: 0.65, p: 2.8 },
    { x: 525, y: 18, sx: 16, sy: 5, f: 0.8, p: 4.1 },
    { x: 645, y: 17, sx: 20, sy: 6, f: 0.6, p: 5.0 },
    { x: 90, y: 412, sx: 18, sy: 5, f: 0.72, p: 0.9 },
    { x: 265, y: 414, sx: 16, sy: 6, f: 0.58, p: 2.1 },
    { x: 465, y: 410, sx: 24, sy: 5, f: 0.77, p: 3.5 },
    { x: 612, y: 416, sx: 15, sy: 5, f: 0.62, p: 4.8 },
  ];

  var BUTTERFLIES = [
    { x: 112, y: 16, sx: 26, sy: 7, f: 0.9, p: 0.4, col: '#fff5b8' },
    { x: 430, y: 18, sx: 30, sy: 6, f: 0.75, p: 2.3, col: '#ffd2df' },
    { x: 205, y: 412, sx: 28, sy: 7, f: 0.85, p: 4.0, col: '#d8f1ff' },
    { x: 560, y: 410, sx: 24, sy: 6, f: 0.95, p: 1.2, col: '#fff5b8' },
  ];

  // Signature Stardew Valley Spring cherry-blossom petals drifting gently in the breeze!
  var PETALS = [
    { x0: 40, y0: 8, vx: 11, vy: 5.5, p: 0.1, col: '#ffc9da' },
    { x0: 190, y0: 14, vx: 9, vy: 4.8, p: 1.3, col: '#ffe1eb' },
    { x0: 360, y0: 6, vx: 12, vy: 5.2, p: 2.6, col: '#ffb8ce' },
    { x0: 540, y0: 12, vx: 10, vy: 5.0, p: 3.9, col: '#ffe1eb' },
    { x0: 680, y0: 18, vx: 9.5, vy: 4.6, p: 5.1, col: '#ffc9da' },
    { x0: 120, y0: 398, vx: 11.5, vy: 4.5, p: 0.8, col: '#ffe1eb' },
    { x0: 470, y0: 402, vx: 10, vy: 4.9, p: 3.1, col: '#ffb8ce' },
  ];

  function drawWarmGlow(g, cx, cy, r, rgbaCenter) {
    var rg = g.createRadialGradient(cx, cy, 1, cx, cy, r);
    rg.addColorStop(0, rgbaCenter);
    rg.addColorStop(1, 'rgba(255, 196, 102, 0)');
    g.fillStyle = rg;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  function drawHarvestClock(g, T, phase) {
    var now = new Date();
    var label = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    var digits = [
      '111101101101111', '010110010010111', '111001111100111', '111001111001111',
      '101101111001001', '111100111001111', '111100111101111', '111001001001001',
      '111101111101111', '111101111001111',
    ];
    var x = 29 * T + 5;
    var y = 2 * T + 3;
    g.fillStyle = '#2c1d18';
    g.fillRect(x, y, 27, 11);
    g.fillStyle = '#8b512c';
    g.fillRect(x + 1, y + 1, 25, 9);
    g.fillStyle = phase === 'night' ? '#241c17' : '#33261f';
    g.fillRect(x + 2, y + 2, 23, 7);
    g.fillStyle = '#fbd578';
    for (var i = 0; i < label.length; i++) {
      var glyph = label[i] === ':' ? '000010000010000' : digits[Number(label[i])];
      for (var n = 0; n < 15; n++) {
        if (glyph[n] === '1') g.fillRect(x + 4 + i * 4 + (n % 3), y + 3 + Math.floor(n / 3), 1, 1);
      }
    }
  }

  function install(scene, pack, retinaPack, initialPhase) {
    if (!scene || !pack || scene.harvestTheme) return false;
    var T = O.T || 16;
    var phase = initialPhase || 'day';
    var prevTime = scene.time;
    // Neutralize generic flat night overlay in office.js so Harvest Moon draws its own rich lighting.
    scene.time = 12;

    var orig = {
      drawWindows: scene.drawWindows,
      drawCampusDesk: scene.drawCampusDesk,
      drawCampusChair: scene.drawCampusChair,
      onDraw: scene.onDraw,
    };

    var offsets = retinaPack && retinaPack.manifest && retinaPack.manifest.composition
      ? retinaPack.manifest.composition.relativeToDeskLogicalPx
      : { north: { laptop: [10, -2], mug: [4, 5], plant: [26, 2] }, south: { laptop: [10, 0], mug: [4, 5], plant: [26, 2] } };

    var deskIndexMap = new Map(scene.L.desks.map(function (d, i) { return [d, i]; }));

    scene.drawWindows = function (g) {
      var t = this.t || 0;
      // Full crisp 2x Retina Harvest Moon Farmhouse background!
      drawImg(g, pack, 'bg', 0, 0, this.W, this.H);

      // 1. Shimmering garden duck pond ripples (north-east meadow)
      var pShift = Math.sin(t * 2.1) * 2;
      g.fillStyle = 'rgba(232, 250, 255, 0.72)';
      g.fillRect(Math.round(38.1 * T + pShift), 15, 7, 1);
      g.fillRect(Math.round(38.6 * T - pShift), 19, 5, 1);

      // 2. Cozy crackling embers in the Lounge brick hearth (x=11.7*T, y=20.7*T) & modern espresso warm light
      var flicker = 0.75 + 0.25 * Math.sin(t * 11) * Math.cos(t * 7);
      var fx = 11 * T + 10;
      var fy = 20 * T + 14;
      g.fillStyle = 'rgba(255, 118, 42, ' + (0.78 * flicker).toFixed(2) + ')';
      g.fillRect(fx, fy + 2, 7, 9);
      g.fillStyle = 'rgba(255, 224, 108, ' + (0.92 * flicker).toFixed(2) + ')';
      g.fillRect(fx + 1, fy + 4 + Math.round(Math.sin(t * 9)), 5, 5);
      // Warm orange firelight cast onto Persian rug
      drawWarmGlow(g, fx + 10, fy + 6, 28, 'rgba(255, 162, 68, ' + (0.24 * flicker).toFixed(2) + ')');

      // 3. Softly rising steam wisps (Modern Kitchen induction kettle, Espresso Machine, Studio Coffee Bar)
      var steamSpots = [
        [4 * T + 6, 4 * T + 14],
        [7 * T + 8, 4 * T + 10],
        [34 * T + 11, 3 * T + 1],
      ];
      for (var s = 0; s < steamSpots.length; s++) {
        var sp = steamSpots[s];
        for (var w = 0; w < 2; w++) {
          var prog = (t * 0.55 + s * 0.37 + w * 0.5) % 1;
          var sx = sp[0] + Math.sin(prog * 6.28 + s) * 2;
          var sy = sp[1] - prog * 10;
          var sa = Math.sin(prog * 3.14) * 0.45;
          g.fillStyle = 'rgba(255, 250, 240, ' + sa.toFixed(2) + ')';
          g.fillRect(Math.round(sx), Math.round(sy), 2, 2);
        }
      }

      // 4. Warm wooden farmhouse wall clock
      drawHarvestClock(g, T, phase);
    };

    scene.drawCampusDesk = function (g, d, on) {
      var dir = d.seat === 'n' ? 'north' : 'south';
      var x = d.x * T;
      var y = d.y * T - 2;
      var off = offsets[dir];
      var seat = deskIndexMap.get(d) || 0;
      drawImg(g, pack, dir === 'north' ? 'deskNorth' : 'deskSouth', x, y);
      // Keep the crisp Retina 2x laptop status indicator (working / active / idle / closed)
      if (retinaPack && retinaPack.images && O.retinaWorkstation) {
        var lState = O.retinaWorkstation.laptopState(this, seat);
        var lap = retinaPack.images.get('laptop.' + dir + '.' + lState);
        if (lap) {
          g.imageSmoothingEnabled = false;
          g.drawImage(lap.image, Math.round(x + off.laptop[0]), Math.round(y + off.laptop[1]), lap.w, lap.h);
        }
      } else if (!on) {
        g.fillStyle = '#303545';
        g.fillRect(x + 11, d.seat === 'n' ? y + 4 : y + 8, 10, 6);
      }
      // Rustic ceramic farmhouse mug & potted sprout herb
      var dec = O.retinaWorkstation ? O.retinaWorkstation.decorMode(seat) : 'both';
      if (dec === 'both' || dec === 'mug') drawImg(g, pack, 'mug', x + off.mug[0], y + off.mug[1]);
      if (dec === 'both' || dec === 'plant') drawImg(g, pack, 'herb', x + off.plant[0], y + off.plant[1]);
    };

    scene.drawCampusChair = function (g, d, front) {
      var key = front ? 'chairSouth' : 'chairNorth';
      var occupied = this.agents && this.agents.some(function (a) {
        return !a.hidden && a.state === 'seat' && scene.L.desks[a.desk] === d;
      });
      // Realistic human seating: chair pulls snugly under/behind seated characters (zero awkward gap!),
      // and rests slightly pushed back when unoccupied.
      if (front) {
        drawImg(g, pack, key, d.x * T + 9, d.y * T + (occupied ? 11 : 15));
      } else {
        drawImg(g, pack, key, d.x * T + 9, d.y * T + (occupied ? -10 : -12));
      }
    };

    // Interactive Workspace Critters (Chickens, Cats & Rabbits!) — autonomous roaming + click-to-pet!
    var critters = [
      { id: 'hen-north', kind: 'chicken', asset: 'chickenWhite', x: 13 * T, y: 0.9 * T, minX: 9.2 * T, maxX: 19.5 * T, minY: 0.45 * T, maxY: 1.25 * T, dir: 1, speed: 12, mode: 'walk', timer: 2.2, emote: '', emoteT: 0, jumpT: 0, seed: 1.1 },
      { id: 'hen-south', kind: 'chicken', asset: 'chickenBrown', x: 32 * T, y: 25.15 * T, minX: 27 * T, maxX: 35.4 * T, minY: 24.9 * T, maxY: 25.45 * T, dir: -1, speed: 11, mode: 'peck', timer: 1.8, emote: '', emoteT: 0, jumpT: 0, seed: 2.7 },
      { id: 'cat-indoor', kind: 'cat', asset: 'catGinger', x: 21.5 * T, y: 22.4 * T, minX: 18.2 * T, maxX: 26.2 * T, minY: 20.6 * T, maxY: 23.1 * T, dir: 1, speed: 14, mode: 'nap', timer: 5.5, emote: '', emoteT: 0, jumpT: 0, seed: 3.4 },
      { id: 'cat-porch', kind: 'cat', asset: 'catTuxedo', x: 15.2 * T, y: 25.1 * T, minX: 9.5 * T, maxX: 19.2 * T, minY: 24.85 * T, maxY: 25.4 * T, dir: 1, speed: 13, mode: 'walk', timer: 3.2, emote: '', emoteT: 0, jumpT: 0, seed: 4.8 },
      { id: 'rabbit-ne', kind: 'rabbit', asset: 'rabbitWhite', x: 31 * T, y: 0.95 * T, minX: 27 * T, maxX: 35.8 * T, minY: 0.45 * T, maxY: 1.25 * T, dir: -1, speed: 18, mode: 'walk', timer: 1.9, emote: '', emoteT: 0, jumpT: 0, seed: 5.3 },
      { id: 'rabbit-sw', kind: 'rabbit', asset: 'rabbitCinnamon', x: 6.2 * T, y: 25.1 * T, minX: 1.8 * T, maxX: 9.0 * T, minY: 24.85 * T, maxY: 25.45 * T, dir: 1, speed: 17, mode: 'idle', timer: 1.6, emote: '', emoteT: 0, jumpT: 0, seed: 6.2 },
      { id: 'rabbit-nw', kind: 'rabbit', asset: 'rabbitWhite', x: 3.2 * T, y: 0.9 * T, minX: 1.2 * T, maxX: 6.5 * T, minY: 0.45 * T, maxY: 1.25 * T, dir: 1, speed: 16, mode: 'walk', timer: 2.4, emote: '', emoteT: 0, jumpT: 0, seed: 7.5 },
    ];
    var lastCritterT = scene.t || 0;
    var petCount = 0;

    function petCritter(cr) {
      petCount++;
      cr.jumpT = 0.65;
      cr.emoteT = 2.3;
      if (cr.kind === 'chicken') {
        cr.emote = petCount % 2 === 0 ? 'Cluck! ♥' : 'Bawk! ♥';
        cr.mode = 'walk';
        cr.timer = 2.5;
      } else if (cr.kind === 'cat') {
        cr.emote = petCount % 2 === 0 ? 'Purr~ ♥' : 'Meow! ♥';
        if (cr.mode === 'nap') { cr.mode = 'walk'; cr.timer = 4.0; }
      } else {
        cr.emote = petCount % 2 === 0 ? '*hop!* ♥' : '*sniff* ♥';
        cr.mode = 'walk';
        cr.timer = 2.4;
      }
      if (typeof scene.draw === 'function') scene.draw();
    }

    function critterAtLogical(lx, ly) {
      var best = null;
      var bestD = 15;
      for (var i = 0; i < critters.length; i++) {
        var cr = critters[i];
        var d = Math.hypot(lx - cr.x, ly - (cr.y - 3));
        if (d < bestD) { bestD = d; best = cr; }
      }
      return best;
    }

    var cvEl = scene.cv || scene.canvas;

    function pointerToLogical(ev) {
      if (!cvEl || typeof cvEl.getBoundingClientRect !== 'function') return null;
      var r = cvEl.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return {
        x: ((ev.clientX - r.left) / r.width) * scene.W,
        y: ((ev.clientY - r.top) / r.height) * scene.H,
      };
    }

    function onCanvasClick(ev) {
      var pt = pointerToLogical(ev);
      if (!pt) return;
      var cr = critterAtLogical(pt.x, pt.y);
      if (cr) petCritter(cr);
    }

    function onCanvasMove(ev) {
      var pt = pointerToLogical(ev);
      if (!pt || !cvEl) return;
      var cr = critterAtLogical(pt.x, pt.y);
      cvEl.style.cursor = cr ? 'pointer' : '';
    }

    if (cvEl && typeof cvEl.addEventListener === 'function') {
      cvEl.addEventListener('click', onCanvasClick);
      cvEl.addEventListener('mousemove', onCanvasMove);
    }

    function drawPixelHeart(g, cx, cy, col) {
      var x = Math.round(cx), y = Math.round(cy);
      g.fillStyle = '#301d18';
      g.fillRect(x - 3, y - 2, 7, 4);
      g.fillRect(x - 2, y + 2, 5, 1);
      g.fillRect(x - 1, y + 3, 3, 1);
      g.fillStyle = col || '#ff5e7e';
      g.fillRect(x - 2, y - 1, 2, 2);
      g.fillRect(x + 1, y - 1, 2, 2);
      g.fillRect(x - 1, y, 3, 2);
      g.fillRect(x, y + 2, 1, 1);
    }

    function updateAndDrawCritters(g, t) {
      var dt = Math.max(0, Math.min(0.12, t - lastCritterT));
      lastCritterT = t;
      for (var i = 0; i < critters.length; i++) {
        var cr = critters[i];
        if (cr.jumpT > 0) cr.jumpT = Math.max(0, cr.jumpT - dt);
        if (cr.emoteT > 0) cr.emoteT = Math.max(0, cr.emoteT - dt);
        cr.timer -= dt;

        // Friendly indoor cat reacts with a little heart when an agent strolls nearby!
        if (cr.kind === 'cat' && cr.id === 'cat-indoor' && cr.emoteT <= 0 && scene.agents) {
          for (var ai = 0; ai < scene.agents.length; ai++) {
            var ag = scene.agents[ai];
            if (ag.hidden || ag.state === 'seat') continue;
            if (Math.hypot((ag.x || 0) - cr.x, (ag.y || 0) - cr.y) < 22) {
              cr.emote = 'Purr~ ♥';
              cr.emoteT = 1.9;
              if (cr.mode === 'nap') { cr.mode = 'idle'; cr.timer = 2.0; }
              break;
            }
          }
        }

        if (cr.timer <= 0) {
          var h = Math.abs(Math.sin((t + 1.3) * 12.9898 + cr.seed * 78.233));
          if (cr.kind === 'cat') {
            cr.mode = h < 0.38 ? 'nap' : h < 0.62 ? 'idle' : 'walk';
            cr.timer = cr.mode === 'nap' ? 4.8 + h * 4 : 2.0 + h * 2.5;
          } else if (cr.kind === 'chicken') {
            cr.mode = h < 0.42 ? 'peck' : 'walk';
            cr.timer = cr.mode === 'peck' ? 1.4 + h * 1.5 : 2.2 + h * 2.6;
          } else {
            cr.mode = h < 0.36 ? 'idle' : 'walk';
            cr.timer = cr.mode === 'idle' ? 1.2 + h * 1.4 : 1.8 + h * 2.2;
          }
          if (cr.mode === 'walk') cr.dir = h > 0.5 ? 1 : -1;
        }

        if (cr.mode === 'walk') {
          var moveSpeed = cr.speed * (cr.kind === 'rabbit' ? (0.55 + 0.9 * Math.abs(Math.sin(t * 7 + cr.seed))) : 1);
          cr.x += cr.dir * moveSpeed * dt;
          cr.y += Math.sin(t * 1.1 + cr.seed * 3) * 2.2 * dt;
          if (cr.x <= cr.minX) { cr.x = cr.minX; cr.dir = 1; }
          if (cr.x >= cr.maxX) { cr.x = cr.maxX; cr.dir = -1; }
          if (cr.y < cr.minY) cr.y = cr.minY;
          if (cr.y > cr.maxY) cr.y = cr.maxY;
        }

        var item = pack.get(cr.asset);
        if (!item) continue;
        // Pick animation frame index (each frame is 32x32 physical -> 16x16 logical)
        var frame = 0;
        var hopLift = 0;
        if (cr.kind === 'chicken') {
          frame = cr.mode === 'peck' ? (Math.sin(t * 9 + cr.seed) > 0 ? 1 : 0) : (Math.floor(t * 4 + cr.seed) % 2);
        } else if (cr.kind === 'cat') {
          frame = cr.mode === 'nap' ? 2 : cr.mode === 'walk' ? (Math.floor(t * 5 + cr.seed) % 2) : 0;
        } else {
          var hopping = cr.mode === 'walk' && Math.sin(t * 7 + cr.seed) > 0;
          frame = hopping ? 1 : 0;
          hopLift = hopping ? Math.sin(t * 7 + cr.seed) * 2.5 : 0;
        }
        if (cr.jumpT > 0) {
          hopLift += Math.sin((cr.jumpT / 0.65) * Math.PI) * 6;
          if (cr.kind !== 'cat') frame = 1;
        }

        var dx = Math.round(cr.x - 8);
        var dy = Math.round(cr.y - 12 - hopLift);
        g.save();
        g.imageSmoothingEnabled = false;
        if (cr.dir < 0 && cr.mode !== 'nap') {
          g.translate(dx + 16, dy);
          g.scale(-1, 1);
          g.drawImage(item.image, frame * 32, 0, 32, 32, 0, 0, 16, 16);
        } else {
          g.drawImage(item.image, frame * 32, 0, 32, 32, dx, dy, 16, 16);
        }
        g.restore();

        // Sleepy tiny pixel "z" floating above napping cats
        if (cr.kind === 'cat' && cr.mode === 'nap' && cr.emoteT <= 0) {
          var zp = (t * 0.7 + cr.seed) % 1;
          g.fillStyle = 'rgba(255, 250, 232, ' + (Math.sin(zp * Math.PI) * 0.85).toFixed(2) + ')';
          g.font = 'bold 6px monospace';
          g.fillText('z', Math.round(cr.x + 5 + Math.sin(zp * 4) * 2), Math.round(cr.y - 10 - zp * 7));
        }

        // Joyful floating heart & mini Stardew emote pill when petted!
        if (cr.emoteT > 0) {
          var ep = 1 - cr.emoteT / 2.3;
          var rise = ep * 9;
          drawPixelHeart(g, cr.x, cr.y - 17 - rise, '#ff5e7e');
          if (cr.emote) {
            var tw = cr.emote.length * 4 + 8;
            var bx = Math.round(cr.x - tw / 2);
            var by = Math.round(cr.y - 31 - rise);
            g.fillStyle = 'rgba(46, 30, 21, 0.88)';
            g.fillRect(bx - 1, by - 1, tw + 2, 11);
            g.fillStyle = '#fff9ec';
            g.fillRect(bx, by, tw, 9);
            g.fillStyle = '#3b2419';
            g.font = 'bold 6px ui-sans-serif, system-ui, sans-serif';
            g.fillText(cr.emote, bx + 4, by + 6.5);
          }
        }
      }
    }

    scene.onDraw = function (g) {
      if (typeof orig.onDraw === 'function') orig.onDraw.call(this, g);
      var t = this.t || 0;

      // Render lively interactive Chickens, Cats & Rabbits around the workspace & gardens!
      updateAndDrawCritters(g, t);

      // Time-of-day atmospheric lighting glaze
      var wash = phaseWashColor(phase);
      if (wash) {
        g.fillStyle = wash;
        g.fillRect(0, 0, this.W, this.H);
      }

      if (phase === 'day' || phase === 'morning') {
        // Gentle fluttering pastel butterflies over the outdoor gardens!
        for (var b = 0; b < BUTTERFLIES.length; b++) {
          var bf = BUTTERFLIES[b];
          var bx = bf.x + Math.sin(t * bf.f + bf.p) * bf.sx;
          var by = bf.y + Math.cos(t * bf.f * 1.6 + bf.p) * bf.sy;
          var wing = Math.sin(t * 16 + b * 2) > 0 ? 1 : 0;
          g.fillStyle = bf.col;
          g.fillRect(Math.round(bx - 1 - wing), Math.round(by), 1 + wing, 2);
          g.fillRect(Math.round(bx + 1), Math.round(by), 1 + wing, 2);
          g.fillStyle = '#3a2920';
          g.fillRect(Math.round(bx), Math.round(by), 1, 2);
        }
        // Signature Stardew Valley Spring blossom petals drifting across the Pelican Town breeze!
        for (var p = 0; p < PETALS.length; p++) {
          var pt = PETALS[p];
          var px = (pt.x0 + t * pt.vx + Math.sin(t * 1.8 + pt.p) * 8) % this.W;
          var py = (pt.y0 + t * pt.vy) % this.H;
          if (py > 38 && py < 392) continue; // Keep petals gracefully framed in the exterior garden strips
          g.fillStyle = pt.col;
          g.fillRect(Math.round(px), Math.round(py), 2, 1);
          g.fillRect(Math.round(px + 1), Math.round(py + 1), 1, 1);
        }
      }

      if (phase === 'sunset' || phase === 'night') {
        var glowStrength = phase === 'night' ? 1.0 : 0.48;
        g.save();
        g.globalCompositeOperation = 'lighter';

        // Warm hearth firelight & cozy north-side lounge TV glow spilling south across the coffee table
        drawWarmGlow(g, 12.2 * T, 21 * T, 56, 'rgba(255, 160, 66, ' + (0.42 * glowStrength).toFixed(2) + ')');
        drawWarmGlow(g, 15.8 * T, 19.3 * T, 34, 'rgba(120, 200, 255, ' + (0.28 * glowStrength).toFixed(2) + ')');

        // Porch entrance lanterns flanking the farmhouse front door
        drawWarmGlow(g, 21.7 * T, 24.8 * T, 26, 'rgba(255, 206, 108, ' + (0.58 * glowStrength).toFixed(2) + ')');
        drawWarmGlow(g, 24.3 * T, 24.8 * T, 26, 'rgba(255, 206, 108, ' + (0.58 * glowStrength).toFixed(2) + ')');

        // Warm golden cottage windows glowing softly into the garden
        var winN = [3, 12, 19, 31, 40, 44];
        for (var wn = 0; wn < winN.length; wn++) {
          drawWarmGlow(g, (winN[wn] + 1) * T, 2.5 * T, 22, 'rgba(255, 214, 126, ' + (0.34 * glowStrength).toFixed(2) + ')');
        }
        var winS = [4, 12, 17, 28, 34];
        for (var ws = 0; ws < winS.length; ws++) {
          drawWarmGlow(g, (winS[ws] + 1) * T, 24.5 * T, 22, 'rgba(255, 214, 126, ' + (0.34 * glowStrength).toFixed(2) + ')');
        }

        // Cozy golden desk lamp halos for seated/working agents
        for (var i = 0; i < this.agents.length; i++) {
          var a = this.agents[i];
          if (a.hidden || a.state !== 'seat') continue;
          var d = this.L.desks[a.desk];
          if (!d) continue;
          var alphaDesk = a.busy ? 0.52 * glowStrength : 0.24 * glowStrength;
          drawWarmGlow(g, d.x * T + 16, d.y * T + 4, a.busy ? 32 : 22, 'rgba(255, 212, 120, ' + alphaDesk.toFixed(2) + ')');
        }

        // Softly pulsing Harvest Moon fireflies drifting across the meadows!
        for (var f = 0; f < FIREFLIES.length; f++) {
          var ff = FIREFLIES[f];
          var fx2 = ff.x + Math.sin(t * ff.f + ff.p) * ff.sx;
          var fy2 = ff.y + Math.cos(t * ff.f * 1.4 + ff.p) * ff.sy;
          var pulse = (0.35 + 0.65 * Math.abs(Math.sin(t * 2.4 + ff.p))) * glowStrength;
          drawWarmGlow(g, fx2, fy2, 7, 'rgba(255, 232, 122, ' + (0.65 * pulse).toFixed(2) + ')');
          g.fillStyle = 'rgba(255, 250, 200, ' + pulse.toFixed(2) + ')';
          g.fillRect(Math.round(fx2), Math.round(fy2), 2, 2);
        }

        g.restore();
      }
    };

    scene.harvestTheme = {
      enabled: true,
      getPhase: function () { return phase; },
      setPhase: function (next) {
        phase = next || 'day';
        scene.draw();
      },
      getCritters: function () { return critters; },
      petCritter: petCritter,
      uninstall: function () {
        if (cvEl && typeof cvEl.removeEventListener === 'function') {
          cvEl.removeEventListener('click', onCanvasClick);
          cvEl.removeEventListener('mousemove', onCanvasMove);
          cvEl.style.cursor = '';
        }
        scene.drawWindows = orig.drawWindows;
        scene.drawCampusDesk = orig.drawCampusDesk;
        scene.drawCampusChair = orig.drawCampusChair;
        scene.onDraw = orig.onDraw;
        scene.time = prevTime;
        scene.harvestTheme = null;
        scene.draw();
      },
    };

    scene.draw();
    return true;
  }

  O.harvest = {
    load: load,
    install: install,
    paintSurroundings: paintSurroundings,
  };
})(window);
