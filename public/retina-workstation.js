/* Kantor Virtual — Full Retina Workstation Adapter v3.0.
 * All 23 scene desks use the Golden Retina Assets v2.7 art system by default.
 * Retains the vendor engine, logical world coordinates, status mapping, movement,
 * floorplan, desk hotspots and Multica source-of-truth. Reversible per Scene.
 * Optional diagnostic: install(scene, assets, {seatIndex: 2}) replaces one desk.
 * Copyright (c) 2026 — new adapter. Vendor license retained separately.
 */
(function(root) {
  'use strict';
  var O = root.MDOffice;
  if (!O) return;
  var MANIFEST_URL = '/art/retina-v2.7/asset-manifest.json';
  var FACE_IDS = ['raya','niko','sari','bima','lia','danu','mira','ardi','nala','yusuf','tari','reno'];
  var REQUIRED = ['desk.body.north','desk.body.south','chair.north','chair.south','prop.mug.desk','prop.plant.desk'];
  ['north','south'].forEach(function(dir) {
    ['active','working','idle','closed'].forEach(function(status) { REQUIRED.push('laptop.'+dir+'.'+status); });
  });
  ['front','back'].forEach(function(dir) {
    [0,1,2].forEach(function(frame) { REQUIRED.push('character.base.'+dir+'.'+frame); });
  });
  FACE_IDS.forEach(function(face) {
    ['front','back'].forEach(function(dir) {
      [0,1,2].forEach(function(frame) { REQUIRED.push('character.preset.'+face+'.'+dir+'.'+frame); });
    });
  });
  var loading = null;
  function validSize(pair) {
    return Array.isArray(pair) && pair.length===2 && pair.every(function(v) { return Number.isInteger(v) && v>0 && v<=128; });
  }
  function validOffset(pair) {
    return Array.isArray(pair) && pair.length===2 && pair.every(function(v) { return Number.isInteger(v) && v>=-128 && v<=128; });
  }
  function validateManifest(m) {
    if (!m || !m.retina || m.retina.minimumAssetScale !== 2 || !m.assets || !m.composition || !m.composition.relativeToDeskLogicalPx) {
      throw new Error('Unsupported Retina manifest');
    }
    ['north','south'].forEach(function(dir) {
      var offsets=m.composition.relativeToDeskLogicalPx[dir];
      if (!offsets || ['laptop','mug','plant'].some(function(name){return !validOffset(offsets[name]);})) {
        throw new Error('Invalid tabletop offsets for '+dir);
      }
    });
  }
  function load() {
    if (loading) return loading;
    loading = (async function() {
      var res = await fetch(MANIFEST_URL, {cache:'no-cache'});
      if (!res.ok) throw new Error('Retina manifest HTTP '+res.status);
      var manifest = await res.json();
      validateManifest(manifest);
      var entries = await Promise.all(REQUIRED.map(async function(id) {
        var item = manifest.assets[id];
        if (!item || !validSize(item.logicalSizePx) || typeof item.uri!=='string' ||
            !item.uri.startsWith('/art/retina-v2.7/') || !item.uri.endsWith('@2x.png')) {
          throw new Error('Invalid Retina asset: '+id);
        }
        var img=new Image(); img.src=item.uri+'?v=4';
        if (typeof img.decode === 'function') await img.decode();
        else await new Promise(function(resolve,reject){
          img.onload=resolve; img.onerror=function(){reject(new Error('Image load failed: '+id));};
        });
        if (img.naturalWidth!==item.logicalSizePx[0]*2 || img.naturalHeight!==item.logicalSizePx[1]*2) {
          throw new Error('Retina asset dimension mismatch: '+id);
        }
        return [id, {image:img, w:item.logicalSizePx[0],h:item.logicalSizePx[1]}];
      }));
      return {manifest:manifest,images:new Map(entries)};
    })().catch(function(error){loading=null;throw error;});
    return loading;
  }
  function drawAsset(ctx, pack, id, x, y, cropH) {
    var asset=pack.images.get(id);
    if (!asset) throw new Error('Missing preloaded Retina asset '+id);
    x=Math.round(x);y=Math.round(y);
    ctx.imageSmoothingEnabled=false;
    if (cropH!=null) {
      cropH=Math.max(0,Math.min(asset.h,cropH));
      if (!cropH) return;
      ctx.drawImage(asset.image,0,0,asset.w*2,cropH*2,x,y,asset.w,cropH);
    } else ctx.drawImage(asset.image,x,y,asset.w,asset.h);
  }
  function laptopState(scene, index) {
    var actor=scene.agents.find(function(a){return a.desk===index && !a.hidden;});
    if (!actor || actor.state==='gone') return 'closed';
    if (actor.busy) return actor.state==='seat'?'working':'active';
    return actor.state==='seat'?'idle':'active';
  }
  function decorMode(index) {
    // Four balanced variations; all use identical standard tabletop anchors.
    // Fewer repetitive tabletop plants improve visibility on dense 4-person desk islands.
    return ['both','mug','plant','none'][index%4];
  }
  function install(scene, pack, options) {
    options=options || {};
    if (!scene || scene.layoutName!=='campus' || !scene.L || !Array.isArray(scene.L.desks) ||
        !pack || !pack.images || !pack.manifest || scene.retinaWorkstations || scene.retinaPilot) return false;
    try {validateManifest(pack.manifest);}catch(_){return false;}
    var seatIndices;
    if (Number.isInteger(options.seatIndex)) {
      if (options.seatIndex<0 || options.seatIndex>=scene.L.desks.length) return false;
      seatIndices=[options.seatIndex];
    } else {
      seatIndices=scene.L.desks.map(function(_d,i){return i;});
    }
    if (seatIndices.length===0) return false;
    var T=O.T||16;
    var deskIndices=new Map(seatIndices.map(function(i){return [scene.L.desks[i],i];}));
    var original={desk:scene.drawCampusDesk,chair:scene.drawCampusChair,agent:scene.drawAgent,
      screen:scene.drawScreen,hit:scene.hit,draw:scene.draw};
    if (Object.values(original).some(function(fn){return typeof fn!=='function';}))return false;
    var offsets=pack.manifest.composition.relativeToDeskLogicalPx;
    function enabledDesk(d){return deskIndices.has(d);}
    function actorIsRetina(a){return a && seatIndices.includes(a.desk) && !a.hidden;}

    // Isolated pilot mode keeps untouched original furniture rasterized at 1x,
    // avoiding sampling changes from the Retina transform.
    var legacyCache=new Map();
    function legacyAt1x(ctx, type, d, on, front) {
      var key=type+':'+d.seat+':'+!!on+':'+!!front;
      var x=d.x*T+(type==='chair'?9:0), y=d.y*T+(type==='desk'?-2:front?20:-14);
      var w=type==='desk'?32:15, h=type==='desk'?25:front?20:13;
      var c=legacyCache.get(key);
      if (!c) {
        c=document.createElement('canvas');c.width=w;c.height=h;
        var g=c.getContext('2d');g.imageSmoothingEnabled=false;g.translate(-x,-y);
        if(type==='desk') original.desk.call(scene,g,d,on); else original.chair.call(scene,g,d,front);
        legacyCache.set(key,c);
      }
      ctx.imageSmoothingEnabled=false;ctx.drawImage(c,x,y);
    }
    scene.drawCampusDesk=function(ctx,d,on){
      if (!enabledDesk(d))return legacyAt1x(ctx,'desk',d,on,false);
      var dir=d.seat==='n'?'north':'south';
      var x=d.x*T,y=d.y*T-2,off=offsets[dir],seat=deskIndices.get(d);
      drawAsset(ctx,pack,'desk.body.'+dir,x,y);
      drawAsset(ctx,pack,'laptop.'+dir+'.'+laptopState(this,seat),x+off.laptop[0],y+off.laptop[1]);
      var dec=decorMode(seat);
      if(dec==='both'||dec==='mug')drawAsset(ctx,pack,'prop.mug.desk',x+off.mug[0],y+off.mug[1]);
      if(dec==='both'||dec==='plant')drawAsset(ctx,pack,'prop.plant.desk',x+off.plant[0],y+off.plant[1]);
    };
    scene.drawCampusChair=function(ctx,d,front){
      if(!enabledDesk(d))return legacyAt1x(ctx,'chair',d,false,front);
      var dir=front?'south':'north';
      drawAsset(ctx,pack,'chair.'+dir,d.x*T+9,d.y*T+(front?20:-14));
    };
    scene.drawAgent=function(ctx,a,crop){
      if(!actorIsRetina(a))return original.agent.call(this,ctx,a,crop);
      var dir=a.face==='up'?'back':'front';
      var phase=Math.floor(a.phase||0)%4;
      var frame=(a.state==='walk'||a.state==='held')?(phase===1?1:phase===3?2:0):0;
      var preset=FACE_IDS.includes(a.retinaFaceId)?a.retinaFaceId:null;
      var key=preset?'character.preset.'+preset+'.'+dir+'.'+frame:'character.base.'+dir+'.'+frame;
      var y=a.fy-(a.state==='held'?38:31);
      if(a.state==='seat' && a.busy && Math.sin((a.typing||0)*9)>.6)y+=1;
      if(a.state==='held'){
        ctx.fillStyle='rgba(20,20,30,.22)';ctx.fillRect(Math.round(a.fx-6),Math.round(a.fy+2),12,2);
      }
      drawAsset(ctx,pack,key,a.fx-11,y,crop);
    };
    scene.drawScreen=function(ctx,d,palette,on,time){
      if(enabledDesk(d))return; // Retina laptop draws in natural furniture depth ordering.
      return original.screen.call(this,ctx,d,palette,on,time);
    };
    scene.hit=function(x,y){
      // Reverse order matches existing hit priority. World-space hitboxes unchanged in pixel units.
      for(var i=this.agents.length-1;i>=0;i--){
        var a=this.agents[i]; if(!actorIsRetina(a))continue;
        var top=a.fy-(a.state==='held'?38:31);
        if(x>=a.fx-11 && x<=a.fx+11 && y>=top && y<=top+32)return a.id;
      }
      return original.hit.call(this,x,y);
    };
    scene.cv.width=scene.W*2;scene.cv.height=scene.H*2;
    scene.g=scene.cv.getContext('2d');
    scene.draw=function(){
      this.g.setTransform(2,0,0,2,0,0);
      this.g.imageSmoothingEnabled=false;
      original.draw.call(this);
    };
    var state={
      enabled:true,mode:seatIndices.length===scene.L.desks.length?'all':'pilot',
      seatIndices:seatIndices.slice(), seatIndex:seatIndices.length===1?seatIndices[0]:null, seatCount:seatIndices.length,
      logicalSize:[scene.W,scene.H],physicalSize:[scene.cv.width,scene.cv.height],
      version:pack.manifest.version,
      rollback:function(){
        scene.drawCampusDesk=original.desk;
        scene.drawCampusChair=original.chair;
        scene.drawAgent=original.agent;
        scene.drawScreen=original.screen;
        scene.hit=original.hit;
        scene.draw=original.draw;
        scene.cv.width=scene.W;scene.cv.height=scene.H;
        scene.g=scene.cv.getContext('2d');
        scene.retinaWorkstations=null;
        scene.retinaPilot=null;
        scene.draw();
      }
    };
    scene.retinaWorkstations=state;
    if(state.mode==='pilot')scene.retinaPilot=state; // Old pilot debug console compatibility.
    scene.draw();
    return true;
  }
  O.retinaWorkstation={load:load,install:install,laptopState:laptopState,decorMode:decorMode,
    requiredAssetIds:REQUIRED.slice(),faceIds:FACE_IDS.slice()};
})(window);
