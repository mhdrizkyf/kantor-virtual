/* Kantor Virtual — Harvest Moon 2x Retina Farmhouse Theme Adapter v1.0.
 * Transforms the 48x28 campus floor into a cozy Harvest Moon / Mineral Town
 * timber farmhouse studio with live hearth embers, rising steam, fluttering
 * butterflies, drifting fireflies, and dynamic Morning/Day/Sunset/Night lighting.
 * Preserves 100% of Multica state, pathfinding, hitboxes, laptops, and 12 characters.
 */
(function (root) {
  'use strict';
  var O = root.MDOffice;
  if (!O) return;

  var ASSET_BASE = '/art/harvest-v1/';
  var ASSET_VER = '?v=1';
  var ASSETS = {
    bg: { uri: ASSET_BASE + 'farmhouse-bg@2x.png', w: 768, h: 448 },
    meadow: { uri: ASSET_BASE + 'meadow-tile@2x.png', w: 96, h: 96 },
    lane: { uri: ASSET_BASE + 'lane-tile@2x.png', w: 96, h: 32 },
    deskNorth: { uri: ASSET_BASE + 'desk-north@2x.png', w: 36, h: 28 },
    deskSouth: { uri: ASSET_BASE + 'desk-south@2x.png', w: 36, h: 28 },
    chairNorth: { uri: ASSET_BASE + 'chair-north@2x.png', w: 15, h: 13 },
    chairSouth: { uri: ASSET_BASE + 'chair-south@2x.png', w: 15, h: 20 },
    mug: { uri: ASSET_BASE + 'mug@2x.png', w: 8, h: 9 },
    herb: { uri: ASSET_BASE + 'herb@2x.png', w: 9, h: 11 },
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
          g.drawImage(meadow.image, x, y, 96, 96);
        }
      }
    }

    var roadY = 26 * T;
    if (lane) {
      for (var ry = roadY; ry < maxY; ry += 32) {
        for (var rx = minX; rx < maxX; rx += 96) {
          g.drawImage(lane.image, rx, ry, 96, 32);
        }
      }
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
    var x = 29 * T;
    var y = 3 * T + 2;
    g.fillStyle = '#2c1d18';
    g.fillRect(x, y, 27, 12);
    g.fillStyle = '#8b512c';
    g.fillRect(x + 1, y + 1, 25, 10);
    g.fillStyle = phase === 'night' ? '#2c221c' : '#3a2c24';
    g.fillRect(x + 2, y + 2, 23, 8);
    g.fillStyle = '#fbd578';
    for (var i = 0; i < label.length; i++) {
      var glyph = label[i] === ':' ? '000010000010000' : digits[Number(label[i])];
      for (var n = 0; n < 15; n++) {
        if (glyph[n] === '1') g.fillRect(x + 4 + i * 4 + (n % 3), y + 3.5 + Math.floor(n / 3), 1, 1);
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

      // 2. Cozy crackling hearth embers in the Lounge fireplace (x=11.5*T, y=20.4*T)
      var flicker = 0.75 + 0.25 * Math.sin(t * 11) * Math.cos(t * 7);
      var fx = 11 * T + 6;
      var fy = 20 * T + 4;
      g.fillStyle = 'rgba(255, 118, 42, ' + (0.75 * flicker).toFixed(2) + ')';
      g.fillRect(fx, fy + 2, 5, 16);
      g.fillStyle = 'rgba(255, 224, 108, ' + (0.9 * flicker).toFixed(2) + ')';
      g.fillRect(fx + 1, fy + 5 + Math.round(Math.sin(t * 9)), 3, 9);
      // Warm orange firelight cast onto braided rug
      drawWarmGlow(g, fx + 12, fy + 10, 26, 'rgba(255, 162, 68, ' + (0.22 * flicker).toFixed(2) + ')');

      // 3. Softly rising steam wisps (Kitchen pot, Hot-Spring Hinoki Tub, Tea Counter)
      var steamSpots = [
        [2 * T + 15, 4 * T + 2],
        [3 * T + 12, 13 * T + 10],
        [4 * T + 6, 13 * T + 14],
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
      drawImg(g, pack, key, d.x * T + 9, d.y * T + (front ? 20 : -14));
    };

    scene.onDraw = function (g) {
      if (typeof orig.onDraw === 'function') orig.onDraw.call(this, g);
      var t = this.t || 0;

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
      }

      if (phase === 'sunset' || phase === 'night') {
        var glowStrength = phase === 'night' ? 1.0 : 0.48;
        g.save();
        g.globalCompositeOperation = 'lighter';

        // Warm hearth firelight spilling across the lounge
        drawWarmGlow(g, 12.2 * T, 21 * T, 56, 'rgba(255, 160, 66, ' + (0.42 * glowStrength).toFixed(2) + ')');

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
      uninstall: function () {
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
