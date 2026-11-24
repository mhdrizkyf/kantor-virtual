import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { resolve } from 'node:path';
import {readFileSync} from 'node:fs';
import plan from '../lib/office-floor-plan.json';

function setup() {
  const calls: string[]=[];
  const draw: unknown[][]=[];
  const ctx: any={imageSmoothingEnabled:true,drawImage(...a:unknown[]){draw.push(a);},
    setTransform(..._a:unknown[]){},translate(..._a:unknown[]){},fillRect(..._a:unknown[]) {}};
  const scene: any={layoutName:'campus',L:plan,W:768,H:448,agents:[],
    cv:{width:768,height:448,getContext:()=>ctx},g:ctx,
    drawCampusDesk(){calls.push('old-desk');},drawCampusChair(){calls.push('old-chair');},
    drawAgent(){calls.push('old-agent');},drawScreen(){calls.push('old-screen');},
    hit(){return null;},draw(){calls.push('old-draw');}};
  const window: any={MDOffice:{T:16}};
  const document={createElement:()=>({width:0,height:0,getContext:()=>ctx})};
  vm.runInNewContext(readFileSync(resolve(process.cwd(), 'public/retina-workstation.js'),'utf8'),{window,document,Map,Math,Number,Array});
  const adapter=window.MDOffice.retinaWorkstation;
  const manifest=JSON.parse(readFileSync(resolve(process.cwd(), 'public/art/retina-v2.7/asset-manifest.json'),'utf8'));
  const images=new Map(adapter.requiredAssetIds.map((id:string)=>[id,{image:{id},w:manifest.assets[id].logicalSizePx[0],h:manifest.assets[id].logicalSizePx[1]}]));
  const pack={manifest,images};
  return {adapter,scene,ctx,draw,calls,pack};
}

function agentAt(i:number, faceId='raya',busy=true) {
  const d=plan.desks[i];
  return {id:'actor:'+i,desk:i,hidden:false,state:'seat',busy,retinaFaceId:faceId,phase:0,face:d.seat==='n'?'down':'up',typing:0,
    fx:d.x*16+16,fy:d.y*16+(d.seat==='n'?4:30),x:d.x,y:d.y};
}

test('All 23 workstations receive the same Retina rendering contract',()=>{
  const {adapter,scene,pack,draw,calls,ctx}=setup();
  scene.agents=plan.desks.map((_d,i)=>agentAt(i));
  assert.equal(adapter.install(scene,pack),true);
  assert.equal(scene.retinaWorkstations.mode,'all');
  assert.equal(scene.retinaWorkstations.seatCount,plan.desks.length);
  assert.deepEqual([scene.cv.width,scene.cv.height],[1536,896]);
  assert.deepEqual([scene.W,scene.H],[768,448]);
  for(let i=0;i<plan.desks.length;i++) {
    draw.length=0;
    scene.drawCampusDesk(ctx,plan.desks[i],true);
    assert.ok(draw.length>=2,`desk ${i} drew desk and laptop`);
    const ids=draw.map((a:any)=>a[0].id);
    const orientation=plan.desks[i].seat==='n'?'north':'south';
    assert.equal(ids[0],'desk.body.'+orientation);
    assert.equal(ids[1],'laptop.'+orientation+'.working');
    assert.ok(ids.every((id:string)=>!id.includes('legacy')));
  }
  assert.equal(calls.includes('old-desk'),false);
  assert.equal(adapter.install(scene,pack),false,'idempotent');
});

test('North and south desks use the correct laptop orientation for all states',()=>{
  const {adapter,scene,pack,ctx,draw}=setup();
  const north=0,south=2;
  scene.agents=[agentAt(north),agentAt(south)];
  adapter.install(scene,pack);
  for(const i of [north,south]) {
    const a=scene.agents.find((x:any)=>x.desk===i)!;
    const orientation=plan.desks[i].seat==='n'?'north':'south';
    for(const state of ['working','idle','active','closed']) {
      a.hidden=state==='closed';a.busy=state==='working'||state==='active';a.state=state==='active'?'walk':'seat';
      draw.length=0;scene.drawCampusDesk(ctx,plan.desks[i],true);
      assert.equal((draw[1][0] as any).id,'laptop.'+orientation+'.'+state);
    }
  }
});

test('All 12 preset identities keep distinct Retina walk animation assets',()=>{
  const {adapter,scene,pack,ctx,draw}=setup();
  scene.agents=adapter.faceIds.map((face:string,i:number)=>agentAt(i,face));
  adapter.install(scene,pack);
  for(const actor of scene.agents) {
    for(const direction of ['front','back']) for(const frame of [0,1,2]) {
      actor.face=direction==='front'?'down':'up';actor.state='walk';actor.phase=frame===1?1:frame===2?3:0;
      draw.length=0;scene.drawAgent(ctx,actor);
      assert.equal((draw[0][0] as any).id,`character.preset.${actor.retinaFaceId}.${direction}.${frame}`);
    }
  }
  assert.equal(adapter.faceIds.length,12);
});

test('Desk accessory variants are balanced, deterministic, and only use prescribed anchors',()=>{
  const {adapter,scene,pack,ctx,draw}=setup();
  adapter.install(scene,pack);
  const counts={both:0,mug:0,plant:0,none:0};
  for(let i=0;i<23;i++) {
    const mode=adapter.decorMode(i) as keyof typeof counts;counts[mode]++;
    draw.length=0;scene.drawCampusDesk(ctx,plan.desks[i],false);
    const ids=draw.map((a:any)=>a[0].id);
    assert.equal(ids.includes('prop.mug.desk'),mode==='both'||mode==='mug');
    assert.equal(ids.includes('prop.plant.desk'),mode==='both'||mode==='plant');
  }
  assert.deepEqual(counts,{both:6,mug:6,plant:6,none:5});
});

test('Character hitboxes apply to every upgraded seat while retaining original world coords',()=>{
  const {adapter,scene,pack}=setup();scene.agents=plan.desks.map((_d,i)=>agentAt(i));adapter.install(scene,pack);
  for(const actor of scene.agents){
    assert.equal(scene.hit(actor.fx,actor.fy-28),actor.id,`Hitbox for ${actor.id}`);
  }
});

test('Rollback restores old renderer and default backing size for the complete scene',()=>{
  const {adapter,scene,pack,calls}=setup();adapter.install(scene,pack);
  scene.retinaWorkstations.rollback();
  assert.equal(scene.retinaWorkstations,null);
  assert.equal(scene.retinaPilot,null);
  assert.deepEqual([scene.cv.width,scene.cv.height],[768,448]);
  scene.drawCampusDesk(scene.g,plan.desks[0],true);
  assert.ok(calls.includes('old-desk'));
});

test('Optional single seat mode remains available for diagnosis',()=>{
  const {adapter,scene,pack,ctx,calls}=setup();
  assert.equal(adapter.install(scene,pack,{seatIndex:2}),true);
  assert.equal(scene.retinaWorkstations.mode,'pilot');
  assert.equal(scene.retinaWorkstations.seatCount,1);
  scene.drawCampusDesk(ctx,plan.desks[0],false);
  // Raster cache routes original desk draw to the original engine once.
  assert.ok(calls.includes('old-desk'));
});

test('Invalid seat or missing required manifest entry fails closed',()=>{
  const {adapter,scene,pack}=setup();
  assert.equal(adapter.install(scene,pack,{seatIndex:plan.desks.length}),false);
  assert.equal(scene.cv.width,768);
  const bad=structuredClone(pack.manifest);delete bad.composition.relativeToDeskLogicalPx.north;
  assert.equal(adapter.install(scene,{...pack,manifest:bad}),false);
  assert.equal(scene.retinaWorkstations,undefined);
});
