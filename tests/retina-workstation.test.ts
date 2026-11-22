import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

// Test the exact shipped browser adapter independently of the Next.js runtime.
function getAdapter() {
  const native = {
    draws: [] as unknown[][],
    imageSmoothingEnabled: true,
    drawImage(...args: unknown[]) { this.draws.push(args); },
    setTransform() {}, translate() {}, fillRect() {},
  };
  const createCanvas = () => ({ width: 0, height: 0, getContext: () => ({...native,draws:[]} ) });
  const window = { MDOffice: { T:16 } } as any;
  const context = vm.createContext({window, Map, Math, Number, Array, document: {createElement: createCanvas}});
  vm.runInContext(readFileSync(resolve(process.cwd(), 'public/retina-workstation.js'),'utf8'),context);
  return {adapter: window.MDOffice.retinaWorkstation, context: native};
}
function fixture(seat='n' as 'n' | 's', withAgent=true, busy=true) {
  const {adapter}=getAdapter();
  const plan = {desks:[{x:13,y:7,seat},{x:16,y:7,seat:'n'}]};
  const agents = withAgent ? [{id:'one',desk:0,busy,hidden:false,state:'seat',fx:224,fy:116,phase:0,face:seat==='n'?'down':'up',typing:0}]:[];
  const calls: string[]=[];
  const ctx: any={draws: [] as unknown[][], drawImage(...args:unknown[]){this.draws.push(args)}, setTransform(){}, fillRect(){}, imageSmoothingEnabled:true};
  const scene: any={layoutName:'campus',L:plan,W:768,H:448,agents,cv:{width:768,height:448,getContext:()=>ctx},g:ctx,
    drawCampusDesk(){calls.push('legacy desk')},drawCampusChair(){calls.push('legacy chair')},drawAgent(){calls.push('legacy agent')},drawScreen(){calls.push('legacy screen')},
    hit(){return null},draw(){calls.push('legacy draw')},
  };
  const sizes: Record<string,[number,number]>={};
  const keys = adapter.requiredAssetIds as string[];
  for(const id of keys) {
    if(id.startsWith('desk.'))sizes[id]=[36,28];
    else if(id==='chair.north')sizes[id]=[15,13];
    else if(id==='chair.south')sizes[id]=[15,20];
    else if(id==='prop.mug.desk')sizes[id]=[6,6];
    else if(id==='prop.plant.desk')sizes[id]=[8,11];
    else if(id.startsWith('laptop'))sizes[id]=[16,11];
    else sizes[id]=[22,32];
  }
  const assets={manifest:{version:'2.7.0',retina:{minimumAssetScale:2},assets:{},composition:{relativeToDeskLogicalPx:{north:{laptop:[10,-2],mug:[4,5],plant:[26,2]},south:{laptop:[10,0],mug:[4,5],plant:[26,2]}}}},
    images:new Map(keys.map(id=>[id,{image:{id},w:sizes[id][0],h:sizes[id][1]}]))};
  return {adapter,scene,assets,calls,ctx};
}

test('Retina pilot affects only the configured desk and maintains 2x backing pixels',()=>{
 const f=fixture();
 assert.equal(f.adapter.install(f.scene,f.assets,{seatIndex:0}),true);
 assert.deepEqual([f.scene.cv.width,f.scene.cv.height],[1536,896]);
 assert.deepEqual([f.scene.W,f.scene.H],[768,448]);
 f.ctx.draws.length=0;
 f.scene.drawCampusDesk(f.ctx,f.scene.L.desks[0],true);
 assert.deepEqual(f.ctx.draws.map((x:any)=>x[0].id),[
   'desk.body.north','laptop.north.working','prop.mug.desk','prop.plant.desk'
 ]);
 assert.equal(f.scene.retinaPilot.seatIndex,0);
 assert.equal(f.adapter.install(f.scene,f.assets,{seatIndex:0}),false,'do not install twice');
});

test('South seat shows south-facing working laptop and correct tabletop offsets',()=>{
 const f=fixture('s');f.adapter.install(f.scene,f.assets,{seatIndex:0});f.ctx.draws.length=0;
 f.scene.drawCampusDesk(f.ctx,f.scene.L.desks[0],true);
 assert.deepEqual(f.ctx.draws.map((x:any)=>x[0].id),[
 'desk.body.south','laptop.south.working','prop.mug.desk','prop.plant.desk']);
 assert.deepEqual(f.ctx.draws.slice(1).map((x:any)=>x.slice(1,3)),[[218,110],[212,115],[234,112]]);
});

test('Laptop statuses derive from real actor state, not hardcoded open',()=>{
 const f=fixture('s');const a=f.scene.agents[0];
 assert.equal(f.adapter.laptopState(f.scene,0),'working');
 a.busy=false;assert.equal(f.adapter.laptopState(f.scene,0),'idle');
 a.state='walk';assert.equal(f.adapter.laptopState(f.scene,0),'active');
 a.hidden=true;assert.equal(f.adapter.laptopState(f.scene,0),'closed');
});

test('Pilot uses 22x32 click hitbox and rollback restores 768x448 renderer',()=>{
 const f=fixture();f.adapter.install(f.scene,f.assets,{seatIndex:0});
 assert.equal(f.scene.hit(f.scene.agents[0].fx+10,f.scene.agents[0].fy-12),'one');
 f.scene.retinaPilot.rollback();
 assert.deepEqual([f.scene.cv.width,f.scene.cv.height],[768,448]);
 assert.equal(f.scene.retinaPilot,null);
 assert.equal(f.scene.hit(224,104),null);
});

test('Missing or invalid configuration does not install the adapter',()=>{
 const f=fixture();
 assert.equal(f.adapter.install(f.scene,f.assets,{seatIndex:42}),false);
 assert.deepEqual([f.scene.cv.width,f.scene.cv.height],[768,448]);
});
