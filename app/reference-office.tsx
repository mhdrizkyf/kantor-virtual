"use client";
import { useEffect, useRef, useState } from 'react';
import type { Desk } from '@/lib/office';
import { castFor } from '@/lib/munder-cast';
import { floorSeats, OFFICE_PLAN, OWNER_SEAT, seatBounds } from '@/lib/floor-seats';
import type { Handover } from './handover';
// The campus extends the MIT procedural engine with a shared floor plan and custom artwork.
// Its isolated JS API is deliberately kept at this boundary.
type Vendor = any;
let loading: Promise<void> | undefined;
function load() {
  return loading ??= (async () => {
    for (const name of ['/vendor/munder/avatars.js', '/vendor/munder/office.js', '/office-campus.js']) await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script'); s.src = name; s.onload = () => resolve(); s.onerror = () => reject(new Error('Could not load office artwork')); document.head.appendChild(s);
    });
    const art = new Image(); art.src = '/art/office-reference.png'; await art.decode();
    (window as unknown as {MDOffice:Vendor}).MDOffice.campusArt = art;
    // Optional Phase 03 scene adapter. Failure to load must not disable the legacy office.
    await new Promise<void>(resolve => {
      const script = document.createElement('script');
      script.src = '/retina-workstation.js';
      script.onload = () => resolve();
      script.onerror = () => resolve();
      document.head.appendChild(script);
    });
  })().catch(e => { loading = undefined; throw e; });
}
const seatPoint = (n: number) => OFFICE_PLAN.desks[n];
export default function ReferenceOffice({ desks, humans, ownerId, lunch, previewWorking, onDesk, onHuman, onMeeting, walks, onDelivered, onDone }: {
  desks: Desk[]; humans: {id:string;name:string}[]; ownerId: string | null; lunch: boolean; previewWorking: boolean; onDesk: (d: Desk) => void; onHuman: (name:string) => void; onMeeting: () => void;
  walks: (Handover & {key:string})[]; onDelivered: (h:Handover) => void; onDone: (key:string) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const surroundings = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{width:number;height:number;frameWidth:number;frameHeight:number} | null>(null);
  useEffect(()=>{
    if(!frame.current)return;
    const observer=new ResizeObserver(([entry])=>{const {width,height}=entry.contentRect;const w=Math.min(width,height*OFFICE_PLAN.cols/OFFICE_PLAN.rows);setSize({width:w,height:w*OFFICE_PLAN.rows/OFFICE_PLAN.cols,frameWidth:width+16,frameHeight:height+16});});
    observer.observe(frame.current);return ()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    let active=true;
    if(size) void load().then(()=>{if(active && surroundings.current)(window as unknown as {MDOffice:Vendor}).MDOffice.paintCampusSurroundings(surroundings.current,size.frameWidth,size.frameHeight,size.width,size.height);}).catch(()=>{});
    return ()=>{active=false;};
  },[size]);
  const canvas = useRef<HTMLCanvasElement>(null), scene = useRef<Vendor>(null);
  const latest = useRef({desks,lunch,previewWorking,walks,onDelivered,onDone}); latest.current = {desks,lunch,previewWorking,walks,onDelivered,onDone};
  const orderedHumans = ownerId ? [...humans.filter(h=>h.id===ownerId),...humans.filter(h=>h.id!==ownerId)] : humans;
  const visibleHumans = orderedHumans.slice(0,6);
  const owner = visibleHumans[0];
  const coworkers = visibleHumans.slice(1);
  const {coworkerSeats,agentSeats} = floorSeats(visibleHumans.length);
  const [letter,setLetter] = useState<string | null>(null);
  const [ack,setAck] = useState('');
  const [error,setError] = useState(''); const [page,setPage] = useState(0);
  const pages = Math.max(1,Math.ceil(desks.length/agentSeats.length)); const currentPage = Math.min(page,pages-1);
  const shown = desks.slice(currentPage*agentSeats.length,currentPage*agentSeats.length+agentSeats.length);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const receive = (event: Event) => { const id = (event as CustomEvent<{agentId:string}>).detail.agentId; const index=latest.current.desks.findIndex(d=>d.agentId===id);if(index<0)return;setPage(Math.floor(index/agentSeats.length));setLetter(id); clearTimeout(timer); timer=setTimeout(()=>setLetter(null),3000); const a=scene.current?.get(id); if(a) {a.hidden=false; scene.current.bubble(id,'check',3);} };
    window.addEventListener('kantor:letter',receive);
    return ()=>{clearTimeout(timer);window.removeEventListener('kantor:letter',receive);};
  },[agentSeats.length]);
  useEffect(()=>{if(!ack)return;const timer=setTimeout(()=>setAck(''),4000);return()=>clearTimeout(timer);},[ack]);
  const letterPoint=seatPoint(agentSeats[Math.max(0,shown.findIndex(d=>d.agentId===letter))]);
  const letterX=letterPoint.x;
  const letterY=letterPoint.y;
  const identity = shown.map(d=>d.agentId+':'+d.face).join('|');
  const humanIdentity = visibleHumans.map(h=>h.id+':'+h.name).join('|');
  useEffect(() => {
    let alive=true; let cleanup=()=>{};
    load().then(()=> {
      if (!alive || !canvas.current) return;
      const O = (window as unknown as {MDOffice:Vendor}).MDOffice;
      const humanActors = visibleHumans.map((h,i)=>({id:`person:${h.id}`,name:h.name,desk:i===0?OWNER_SEAT:coworkerSeats[i-1],recipe:O.recipeOf(['michael','jim','pam','dwight','angela','oscar'][i]),busy:false,human:true}));
      const s = new O.Scene(canvas.current,{layout:'campus',floorPlan:OFFICE_PLAN,theme:'campus',fps:24,agents:[...shown.map((d,i)=>({id:d.agentId,name:d.name,desk:agentSeats[i],recipe:O.recipeOf(castFor(d.face)),busy:d.state==='working'})),...humanActors]});
      scene.current=s;
      // Full Retina rollout: all 23 workstations share one asset library.
      // Keep the selected character preset for every agent; preserve the owner/human variety.
      shown.forEach(d => {const actor=s.get(d.agentId); if(actor) actor.retinaFaceId=d.face;});
      const humanFaceIds=['raya','niko','sari','bima','lia','danu'];
      visibleHumans.forEach((h,i)=>{const actor=s.get(`person:${h.id}`);if(actor) actor.retinaFaceId=humanFaceIds[i%humanFaceIds.length];});
      // ?retina=0 immediately restores the complete legacy renderer. A seat param is debug-only.
      const params = new URLSearchParams(window.location.search);
      const retinaEnabled = params.get('retina') !== '0';
      const debugSeat = params.get('retinaSeat');
      const parsedSeat = debugSeat === null ? Number.NaN : Number(debugSeat);
      const singleSeat = debugSeat !== null && Number.isInteger(parsedSeat) && parsedSeat >= 0 && parsedSeat < OFFICE_PLAN.desks.length;
      if (retinaEnabled && O.retinaWorkstation) {
        void O.retinaWorkstation.load().then((assets: unknown) => {
          if (alive && scene.current === s) {
            const options = singleSeat ? {seatIndex:parsedSeat} : {};
            O.retinaWorkstation.install(s, assets, options);
          }
        }).catch((reason: unknown) => {
          console.warn('[Kantor Retina] Falling back to legacy scene:',reason);
        });
      }
      const pending = new Map<string,{h:Handover & {key:string}; delivered:boolean}>();
      s.onTick=()=> {
        for(const d of latest.current.desks) { const a=s.get(d.agentId); if(a) { a.busy=d.state==='working' || (latest.current.previewWorking && d.agentId===latest.current.desks[0]?.agentId); a.hidden=!a.busy && ['home','off','closed'].includes(d.state) && a.state==='seat'; if(a.busy) s.bubble(d.agentId,'dots',1); } }
        for(const h of latest.current.walks) {
          if(pending.has(h.key)) continue;
          const a=s.get(h.from), b=s.get(h.to);
          if(!a || !b) { latest.current.onDone(h.key); continue; }
          const candidates=[[b.x-1,b.y],[b.x+1,b.y],[b.x,b.y+1],[b.x,b.y-1]].filter(([x,y])=>s.walk[y]?.[x]);
          const path=candidates.map(([x,y])=>s.path(a.x,a.y,x,y)).filter(Boolean).sort((p:number[][],q:number[][])=>p.length-q.length)[0];
          if(!path) { latest.current.onDone(h.key); continue; }
          a.hidden=false;setAck(`${h.fromName}: task received`);s.bubble(h.from,'check',2);a.state='walk';a.path=path;a.then='errand';a.target={face:'up',kind:'chat'};
          pending.set(h.key,{h,delivered:false});
        }
        for(const [key,p] of pending) {
          const a=s.get(p.h.from);
          if(!p.delivered && a?.state==='errand') { p.delivered=true; s.bubble(p.h.to,'check',3);latest.current.onDelivered(p.h); }
          if(p.delivered && a?.state==='seat') { pending.delete(key);latest.current.onDone(key); }
        }
      };
      const reduced=matchMedia('(prefers-reduced-motion: reduce)');
      const visibility=()=>{ if(document.visibilityState==='visible' && !reduced.matches) s.start(); else {s.stop();s.draw();} };
      visibility();document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',visibility);
      const clockTimer=setInterval(()=>{if(!s.running && !document.hidden)s.draw();},30000);
      const lunchTimer=setInterval(()=> { if(!latest.current.lunch || document.hidden) return; for(const d of latest.current.desks) {const a=s.get(d.agentId); if(a && ['home','ready','review','break'].includes(d.state) && a.state==='seat') {const target={...OFFICE_PLAN.lunch,face:'down',kind:'coffee'};const path=s.path(a.x,a.y,target.x,target.y);if(!path)continue;a.hidden=false;a.state='walk';a.path=path;a.then='errand';a.target=target;} } },15000);
      cleanup=()=>{s.stop();clearInterval(clockTimer);clearInterval(lunchTimer);document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',visibility);scene.current=null;};
    }).catch(e=>{if(alive)setError(e.message);});
    return ()=>{alive=false;cleanup();};
  // Rebuild only when seats or appearances change, not on polling updates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[identity,humanIdentity]);
  return <div className="reference-office campus-office" ref={frame}>
    <canvas ref={surroundings} className="campus-surroundings" aria-hidden="true" />
    <div className="reference-stage" style={size ? {width:size.width,height:size.height} : {width:"100%",aspectRatio:`${OFFICE_PLAN.cols}/${OFFICE_PLAN.rows}`}}>
    {error && <p role="alert">{error}</p>}
    <canvas ref={canvas} className="reference-canvas" aria-label="Animated office floor" onClick={e=>{const s=scene.current;if(!s)return;const r=e.currentTarget.getBoundingClientRect();const id=s.hit((e.clientX-r.left)*s.W/r.width,(e.clientY-r.top)*s.H/r.height);const d=desks.find(d=>d.agentId===id);if(d)onDesk(d);else {const h=visibleHumans.find(h=>`person:${h.id}`===id);if(h)onHuman(h.name);}}} />
    {ack && <div className="scene-ack" role="status">{ack}</div>}
    {letter && shown.some(d=>d.agentId===letter) && <div className="delivery-letter" key={letter} aria-label="Message delivered" style={{ '--letter-x': `${(letterX+1)/OFFICE_PLAN.cols*100}%`, '--letter-y': `${(letterY-1)/OFFICE_PLAN.rows*100}%` } as React.CSSProperties}>✉<small>Delivered</small></div>}
    <div className="reference-hotspots">{shown.map((d,i)=><button key={d.agentId} style={seatBounds(agentSeats[i])} onClick={()=>onDesk(d)} aria-label={`${d.name}. ${d.squad}. ${d.bubble}`}><span>{d.name}<small>{d.bubble}</small></span></button>)}
    {owner && <button style={seatBounds(OWNER_SEAT)} onClick={()=>onHuman(owner.name)} aria-label={`${owner.name}'s office`}><span>{owner.name}<small>Private office</small></span></button>}
    {coworkers.map((h,i)=><button className="human-hotspot" key={h.id} style={seatBounds(coworkerSeats[i])} onClick={()=>onHuman(h.name)} aria-label={`${h.name}'s desk`}><span>{h.name}<small>Human teammate</small></span></button>)}
    <button style={{left:`${OFFICE_PLAN.meeting.x/OFFICE_PLAN.cols*100}%`,top:`${OFFICE_PLAN.meeting.y/OFFICE_PLAN.rows*100}%`,width:`${OFFICE_PLAN.meeting.w/OFFICE_PLAN.cols*100}%`,height:`${OFFICE_PLAN.meeting.h/OFFICE_PLAN.rows*100}%`}} onClick={onMeeting} aria-label="Meeting room: plan an agenda"><span>Meeting area · Plan agenda</span></button>
    </div>
    </div>
    {pages>1 && <div className="floor-pages"><button disabled={!currentPage} onClick={()=>setPage(p=>p-1)}>←</button> Agents {currentPage+1}/{pages} <button disabled={currentPage===pages-1} onClick={()=>setPage(p=>p+1)}>→</button></div>}
    {lunch && <span className="lunch-sign">Lunch break · until 13:00</span>}
  </div>;
}
