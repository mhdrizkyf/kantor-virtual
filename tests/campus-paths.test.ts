import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { OFFICE_PLAN } from '../lib/floor-seats';

test('campus seats and gathering areas are reachable without crossing furniture or walls', () => {
  const context=vm.createContext({window:{MDAv:{}},Map,Math,Int16Array,Uint8Array});
  for(const file of ['../public/vendor/munder/office.js','../public/office-campus.js']) vm.runInContext(readFileSync(new URL(file,import.meta.url),'utf8'),context);
  const engine=(context.window as any).MDOffice;
  const scene=Object.create(engine.Scene.prototype);
  scene.layoutName='campus';scene.L=OFFICE_PLAN;scene.walk=scene.buildWalk();
  const seats=OFFICE_PLAN.desks.map(d=>[d.x,d.y+(d.seat==='n'?-1:1)]);
  const goals=[...seats,...OFFICE_PLAN.errands.map(d=>[d.x,d.y]),[OFFICE_PLAN.lunch.x,OFFICE_PLAN.lunch.y]];
  for(const [x,y] of goals){
    assert.equal(scene.walk[y][x],1,`Destination ${x},${y} is blocked`);
    const path=scene.path(seats[8][0],seats[8][1],x,y);
    assert.ok(path,`Owner cannot reach ${x},${y}`);
    for(const [px,py] of path)assert.equal(scene.walk[py][px],1,`Path crosses obstacle at ${px},${py}`);
  }
});
