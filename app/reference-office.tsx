"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Desk } from '@/lib/office';
import { castFor } from '@/lib/munder-cast';
import { floorSeats, OFFICE_PLAN, OWNER_SEAT, seatBounds } from '@/lib/floor-seats';
import {
  bubbleKindForState,
  compactLabel,
  handoverSpeechPayload,
  interactiveFloorProps,
  meetingSpotsFor,
  ownerReviewSpotsFor,
  resolveDropZone,
  tileRectBounds,
  type BubbleKind,
  type DropZone,
  type FloorPropKind,
  type SpeechBubbleItem,
  type SpeechBubbleTone,
} from '@/lib/munder-workflows';
import type { Handover } from './handover';
import { floorPropLabel, type FloorTheme, type HarvestPhase } from '@/lib/harvest-theme';

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
    (window as unknown as { MDOffice: Vendor }).MDOffice.campusArt = art;
    // Optional Phase 03 Retina workstation & Stardew Valley scene adapters.
    for (const extra of ['/retina-workstation.js', '/office-harvest.js?v=10']) {
      await new Promise<void>(resolve => {
        const script = document.createElement('script');
        script.src = extra;
        script.onload = () => resolve();
        script.onerror = () => resolve();
        document.head.appendChild(script);
      });
    }
  })().catch(e => { loading = undefined; throw e; });
}

const seatPoint = (n: number) => OFFICE_PLAN.desks[n];
const FLOOR_PROPS = interactiveFloorProps();

function describeDropTarget(draggedName: string, zone: DropZone): string {
  switch (zone.kind) {
    case 'desk':
      return `Hand off task to ${zone.name}`;
    case 'human':
      return `Send update to ${zone.name}`;
    case 'meeting':
      return `Call Standup Huddle with ${draggedName}`;
    case 'coffee':
      return `Send ${draggedName} for a coffee break`;
    case 'board':
      return 'Open Task Board';
    case 'server':
      return 'Inspect AI Engines';
    default:
      return `Drop ${draggedName} on floor`;
  }
}

export type ReviewTaskInfo = { id: string; ws: string; title: string };
export type OfficeWalk = Handover & { key: string; kind?: 'assign' | 'revise' | 'review' | 'handoff' };

export default function ReferenceOffice({
  desks,
  humans,
  ownerId,
  officeOpen,
  lunch,
  previewWorking,
  previewReviewId = null,
  huddleIds = [],
  coffeeTick = 0,
  reviewTasksByAgent = {},
  floorTheme = 'harvest',
  harvestPhase = 'day',
  onDesk,
  onHuman,
  onMeeting,
  onPropClick,
  onDropAgent,
  onOpenTask,
  walks,
  onDelivered,
  onDone,
}: {
  desks: Desk[];
  humans: { id: string; name: string; face?: string | null }[];
  ownerId: string | null;
  officeOpen: boolean;
  lunch: boolean;
  previewWorking: boolean;
  previewReviewId?: string | null;
  huddleIds?: string[];
  coffeeTick?: number;
  reviewTasksByAgent?: Record<string, ReviewTaskInfo>;
  floorTheme?: FloorTheme;
  harvestPhase?: HarvestPhase;
  onDesk: (d: Desk) => void;
  onHuman: (name: string) => void;
  onMeeting: (focusAgentId?: string) => void;
  onPropClick?: (prop: FloorPropKind) => void;
  onDropAgent?: (dragged: Desk, zone: DropZone) => void;
  onOpenTask?: (id: string, ws: string) => void;
  walks: OfficeWalk[];
  onDelivered: (h: Handover) => void;
  onDone: (key: string) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const surroundings = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ width: number; height: number; frameWidth: number; frameHeight: number } | null>(null);
  useEffect(() => {
    if (!frame.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const w = Math.min(width, height * OFFICE_PLAN.cols / OFFICE_PLAN.rows);
      setSize({ width: w, height: w * OFFICE_PLAN.rows / OFFICE_PLAN.cols, frameWidth: width + 16, frameHeight: height + 16 });
    });
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    if (!size) return;
    void load().then(async () => {
      if (!active || !surroundings.current) return;
      const O = (window as unknown as { MDOffice: Vendor }).MDOffice;
      if (floorTheme === 'harvest' && O.harvest) {
        try {
          const pack = await O.harvest.load();
          if (active && surroundings.current) {
            O.harvest.paintSurroundings(surroundings.current, size.frameWidth, size.frameHeight, size.width, size.height, pack, harvestPhase);
            return;
          }
        } catch {
          // Fall back cleanly to campus surroundings if harvest art fails to load.
        }
      }
      if (active && surroundings.current) {
        O.paintCampusSurroundings(surroundings.current, size.frameWidth, size.frameHeight, size.width, size.height);
      }
    }).catch(() => { });
    return () => { active = false; };
  }, [size, floorTheme, harvestPhase]);

  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<Vendor>(null);
  const retinaPackRef = useRef<unknown>(null);
  const [sceneReady, setSceneReady] = useState(0);
  const speechElsRef = useRef<Map<string, HTMLElement>>(new Map());
  const latest = useRef({ desks, lunch, previewWorking, previewReviewId, walks, onDelivered, onDone, onDropAgent, onMeeting, onPropClick, onHuman });
  latest.current = { desks, lunch, previewWorking, previewReviewId, walks, onDelivered, onDone, onDropAgent, onMeeting, onPropClick, onHuman };

  const orderedHumans = ownerId ? [...humans.filter(h => h.id === ownerId), ...humans.filter(h => h.id !== ownerId)] : humans;
  const visibleHumans = orderedHumans.slice(0, 6);
  const owner = visibleHumans[0];
  const coworkers = visibleHumans.slice(1);
  const { coworkerSeats, agentSeats } = floorSeats(visibleHumans.length);

  // Two real break destinations: Kitchen Pantry (x=7, y=7) & Dedicated Coffee Machine Bar (x=35, y=5)
  const breakSpotCursorRef = useRef(0);
  const getBreakCoffeeSpots = () => {
    const spots = OFFICE_PLAN.errands.filter(e => e.kind === 'coffee');
    if (spots.length >= 2) {
      return spots.map(e => ({
        ...e,
        isCoffeeBar: e.x >= 30,
        label: e.x >= 30 ? 'Pulling an espresso at the coffee bar ☕' : 'Grabbing a brew in the kitchen 🍳',
      }));
    }
    const fallback = spots[0] ?? OFFICE_PLAN.lunch;
    return [{ ...fallback, face: 'up', kind: 'coffee', isCoffeeBar: false, label: 'Grabbing a quick coffee ☕' }];
  };

  const [letter, setLetter] = useState<string | null>(null);
  const [ack, setAck] = useState('');
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [dragUI, setDragUI] = useState<{ agentId: string; name: string; zone: DropZone; x: number; y: number } | null>(null);
  const [transientBubbles, setTransientBubbles] = useState<Record<string, SpeechBubbleItem & { expiresAt: number }>>({});
  const [reviewArrived, setReviewArrived] = useState<Record<string, boolean>>({});
  const [hoveredActorId, setHoveredActorId] = useState<string | null>(null);
  const dragRef = useRef<{ agentId: string; desk: Desk; startX: number; startY: number; active: boolean; zone: DropZone } | null>(null);
  const justDraggedRef = useRef(0);

  const pages = Math.max(1, Math.ceil(desks.length / agentSeats.length));
  const currentPage = Math.min(page, pages - 1);
  const shown = desks.slice(currentPage * agentSeats.length, currentPage * agentSeats.length + agentSeats.length);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  // Agents currently awaiting human owner review (real Multica state OR visual workflow preview)
  const reviewAgentIds = useMemo(() => {
    if (huddleIds.length > 0) return [];
    const ids = shown.filter(d => d.state === 'review' || !!reviewTasksByAgent[d.agentId]).map(d => d.agentId);
    if (previewReviewId && shown.some(d => d.agentId === previewReviewId) && !ids.includes(previewReviewId)) {
      ids.unshift(previewReviewId);
    }
    return ids.slice(0, 6);
  }, [shown, reviewTasksByAgent, previewReviewId, huddleIds.length]);

  const showTransient = (item: SpeechBubbleItem, ms = 3200, pixelKind?: BubbleKind) => {
    const expiresAt = Date.now() + ms;
    setTransientBubbles(cur => ({ ...cur, [item.actorId]: { ...item, expiresAt } }));
    const s = scene.current;
    if (s && pixelKind) {
      const a = s.get(item.actorId);
      if (a) { a.hidden = false; s.bubble(item.actorId, pixelKind, ms / 1000); }
    }
    setTimeout(() => {
      setTransientBubbles(cur => {
        const existing = cur[item.actorId];
        if (!existing || existing.expiresAt !== expiresAt) return cur;
        const next = { ...cur };
        delete next[item.actorId];
        return next;
      });
    }, ms + 50);
  };

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const receive = (event: Event) => {
      const id = (event as CustomEvent<{ agentId: string }>).detail.agentId;
      const index = latest.current.desks.findIndex(d => d.agentId === id);
      if (index < 0) return;
      setPage(Math.floor(index / agentSeats.length));
      setLetter(id);
      clearTimeout(timer);
      timer = setTimeout(() => setLetter(null), 3000);
      const a = scene.current?.get(id);
      if (a) { a.hidden = false; scene.current.bubble(id, 'mail', 3.5); }
    };
    const celebrate = (event: Event) => {
      const { agentId, kind = 'heart' } = (event as CustomEvent<{ agentId: string; kind?: BubbleKind }>).detail ?? {};
      const s = scene.current;
      if (!s || !agentId) return;
      const a = s.get(agentId);
      if (a) { a.hidden = false; s.bubble(agentId, kind, 4); }
    };
    const speech = (event: Event) => {
      const detail = (event as CustomEvent<{
        actorId: string;
        tone: SpeechBubbleTone;
        badge: string;
        text: string;
        ms?: number;
        pixelKind?: BubbleKind;
      }>).detail;
      if (!detail?.actorId) return;
      showTransient(
        { actorId: detail.actorId, tone: detail.tone, badge: detail.badge, text: detail.text },
        detail.ms ?? 3400,
        detail.pixelKind
      );
    };
    const coffee = (event: Event) => {
      const id = (event as CustomEvent<{ agentId: string }>).detail?.agentId;
      const s = scene.current;
      if (!s || !id) return;
      const a = s.get(id);
      if (!a || a.busy || a.state === 'held' || a.huddleHold || a.reviewHold) return;
      const index = latest.current.desks.findIndex(d => d.agentId === id);
      if (index >= 0) setPage(Math.floor(index / agentSeats.length));
      const spots = getBreakCoffeeSpots();
      const chosen = spots[breakSpotCursorRef.current++ % spots.length];
      a.hidden = false;
      const path = s.path(a.x, a.y, chosen.x, chosen.y);
      if (path && path.length) {
        a.state = 'walk';
        a.path = path;
        a.then = 'errand';
        a.target = { x: chosen.x, y: chosen.y, face: chosen.face || 'up', kind: 'coffee' };
      }
      showTransient({ actorId: id, tone: 'coffee', badge: chosen.isCoffeeBar ? 'Coffee Bar' : 'Kitchen', text: chosen.label }, 3400, 'coffee');
    };
    window.addEventListener('kantor:letter', receive);
    window.addEventListener('kantor:celebrate', celebrate);
    window.addEventListener('kantor:speech', speech);
    window.addEventListener('kantor:coffee', coffee);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('kantor:letter', receive);
      window.removeEventListener('kantor:celebrate', celebrate);
      window.removeEventListener('kantor:speech', speech);
      window.removeEventListener('kantor:coffee', coffee);
    };
  }, [agentSeats.length]);

  useEffect(() => { if (!ack) return; const timer = setTimeout(() => setAck(''), 4000); return () => clearTimeout(timer); }, [ack]);

  // Door entry / exit animation when office switches open <-> closed
  const prevOfficeOpen = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevOfficeOpen.current === null) {
      prevOfficeOpen.current = officeOpen;
      return;
    }
    if (prevOfficeOpen.current === officeOpen) return;
    prevOfficeOpen.current = officeOpen;
    const s = scene.current;
    if (!s || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (officeOpen) {
      setAck('Office opened · Agents walking in');
      shownRef.current.forEach((d, i) => {
        timers.push(setTimeout(() => {
          const a = s.get(d.agentId);
          if (!a) return;
          a.hidden = true;
          s.come(d.agentId);
          s.bubble(d.agentId, 'sun', 3);
        }, i * 240));
      });
    } else {
      setAck('Office closed · Agents heading home');
      shownRef.current.forEach((d, i) => {
        timers.push(setTimeout(() => {
          const a = s.get(d.agentId);
          if (!a || a.busy || a.hidden) return;
          s.bubble(d.agentId, 'zz', 2.5);
          s.leave(d.agentId);
        }, i * 200));
      });
    }
    return () => { timers.forEach(clearTimeout); };
  }, [officeOpen]);

  // Standup Huddle: walk participating agents to unique spots around the meeting table
  const prevHuddle = useRef<string[]>([]);
  useEffect(() => {
    const s = scene.current;
    if (!s) { prevHuddle.current = huddleIds; return; }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (huddleIds.length > 0 && prevHuddle.current.length === 0) {
      const spots = meetingSpotsFor(huddleIds.length, (x, y) => !!s.walk[y]?.[x]);
      huddleIds.forEach((id, idx) => {
        const a = s.get(id);
        if (!a) return;
        a.hidden = false;
        a.reviewHold = false;
        const spot = spots[idx];
        if (reduced) {
          s.bubble(id, 'idea', 5);
          return;
        }
        const path = s.path(a.x, a.y, spot.x, spot.y);
        if (path && path.length) {
          a.state = 'walk';
          a.path = path;
          a.then = 'errand';
          a.target = { x: spot.x, y: spot.y, face: spot.face, kind: 'board' };
          a.huddleHold = true;
        } else {
          s.bubble(id, 'idea', 5);
        }
      });
      setAck(`Team Standup · ${huddleIds.length} agents gathering`);
    } else if (huddleIds.length === 0 && prevHuddle.current.length > 0) {
      prevHuddle.current.forEach(id => {
        const a = s.get(id);
        if (!a) return;
        a.huddleHold = false;
        s.bubble(id, 'check', 3);
        if (a.state !== 'seat' && a.state !== 'held') {
          const desk = s.L.desks[a.desk];
          const st = s.seatTile(desk);
          a.target = null;
          const p = s.path(a.x, a.y, st[0], st[1]);
          if (p) { a.state = 'walk'; a.path = p; a.then = 'seat'; }
        }
      });
    }
    prevHuddle.current = huddleIds;
  }, [huddleIds]);

  // Review at Owner's Desk: agents waiting for human approval physically walk over & wait beside Owner's desk
  const prevReviewIds = useRef<string[]>([]);
  const reviewKey = reviewAgentIds.join('|');
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const spots = ownerReviewSpotsFor(Math.max(1, reviewAgentIds.length), (x, y) => !!s.walk[y]?.[x]);
    const currentSet = new Set(reviewAgentIds);

    // Send newly-in-review agents to wait at the owner's desk
    reviewAgentIds.forEach((id, idx) => {
      const a = s.get(id);
      if (!a || a.state === 'held' || a.huddleHold) return;
      const spot = spots[idx];
      if (!spot) return;
      a.hidden = false;
      a.reviewHold = true;
      a.reviewSpot = spot;
      const alreadyThere = a.x === spot.x && a.y === spot.y && a.state === 'errand';
      const walkingThere = a.state === 'walk' && a.target?.x === spot.x && a.target?.y === spot.y;
      if (alreadyThere) {
        setReviewArrived(cur => (cur[id] ? cur : { ...cur, [id]: true }));
        return;
      }
      if (walkingThere) return;
      if (reduced) {
        a.x = spot.x; a.y = spot.y; a.fx = spot.x * 16 + 8; a.fy = spot.y * 16 + 14;
        a.state = 'errand'; a.face = spot.face; a.timer = 60;
        setReviewArrived(cur => ({ ...cur, [id]: true }));
        s.bubble(id, 'ask', 4);
        return;
      }
      const path = s.path(a.x, a.y, spot.x, spot.y);
      if (path && path.length) {
        a.state = 'walk';
        a.path = path;
        a.then = 'errand';
        a.target = { x: spot.x, y: spot.y, face: spot.face, kind: 'chat' };
        s.bubble(id, 'mail', 3);
        setReviewArrived(cur => (cur[id] ? { ...cur, [id]: false } : cur));
      }
    });

    // Release agents whose review has finished so they walk back to their own desks
    prevReviewIds.current.forEach(id => {
      if (currentSet.has(id)) return;
      const a = s.get(id);
      if (!a) return;
      a.reviewHold = false;
      a.reviewSpot = null;
      setReviewArrived(cur => {
        if (!(id in cur)) return cur;
        const next = { ...cur };
        delete next[id];
        return next;
      });
      if (!a.huddleHold && a.state !== 'seat' && a.state !== 'held') {
        const desk = s.L.desks[a.desk];
        const st = s.seatTile(desk);
        a.target = null;
        const p = s.path(a.x, a.y, st[0], st[1]);
        if (p) { a.state = 'walk'; a.path = p; a.then = 'seat'; }
      }
    });

    prevReviewIds.current = reviewAgentIds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewKey]);

  // Coffee Bar click: send free/idle agents on a refreshing coffee errand
  const prevCoffee = useRef(coffeeTick);
  useEffect(() => {
    if (coffeeTick === prevCoffee.current) return;
    prevCoffee.current = coffeeTick;
    const s = scene.current;
    if (!s) return;
    const spots = getBreakCoffeeSpots();
    const usedPerSpot = spots.map(() => 0);
    let sent = 0;
    for (const d of shownRef.current) {
      if (sent >= 4) break;
      const a = s.get(d.agentId);
      if (!a || a.busy || a.reviewHold || a.huddleHold || a.state !== 'seat') continue;
      a.hidden = false;
      // Alternate across Kitchen Pantry & Coffee Machine Bar so both break zones come alive!
      const spotIdx = (breakSpotCursorRef.current + sent) % spots.length;
      const chosen = spots[spotIdx];
      const slot = usedPerSpot[spotIdx]++;
      const offsetX = slot === 0 ? 0 : (slot % 2 === 1 ? -1 : 1);
      const target = { x: chosen.x + offsetX, y: chosen.y, face: chosen.face || 'up', kind: 'coffee' };
      const path = s.path(a.x, a.y, target.x, target.y) ?? s.path(a.x, a.y, chosen.x, chosen.y);
      if (path && path.length) {
        a.state = 'walk';
        a.path = path;
        a.then = 'errand';
        a.target = target;
        showTransient({ actorId: d.agentId, tone: 'coffee', badge: chosen.isCoffeeBar ? 'Coffee Bar' : 'Kitchen', text: chosen.label }, 3200, 'coffee');
        sent++;
      }
    }
    breakSpotCursorRef.current += Math.max(1, sent);
    setAck(sent > 0 ? `Break time · ${sent} agent${sent > 1 ? 's' : ''} heading to kitchen & coffee bar` : 'Everyone is busy at their desks right now');
  }, [coffeeTick]);

  // Pointer drag & drop across the canvas stage
  const toWorld = (clientX: number, clientY: number) => {
    const cv = canvas.current, s = scene.current;
    if (!cv || !s) return null;
    const r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return {
      wx: ((clientX - r.left) * s.W) / r.width,
      wy: ((clientY - r.top) * s.H) / r.height,
      relX: clientX - r.left,
      relY: clientY - r.top,
    };
  };

  const beginDrag = (desk: Desk, clientX: number, clientY: number) => {
    const s = scene.current;
    if (!s) return;
    dragRef.current = { agentId: desk.agentId, desk, startX: clientX, startY: clientY, active: false, zone: { kind: 'floor' } };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const dr = dragRef.current;
      const s = scene.current;
      if (!dr || !s) return;
      const dist = Math.hypot(e.clientX - dr.startX, e.clientY - dr.startY);
      if (!dr.active && dist < 7) return;
      const pt = toWorld(e.clientX, e.clientY);
      if (!pt) return;
      if (!dr.active) {
        dr.active = true;
        const a = s.get(dr.agentId);
        if (a) a.hidden = false;
        s.grab(dr.agentId);
      }
      s.hold(dr.agentId, pt.wx, pt.wy);
      const zone = resolveDropZone(pt.wx, pt.wy, {
        draggedAgentId: dr.agentId,
        agentDesks: shownRef.current.map((d, i) => ({ agentId: d.agentId, name: d.name, seatIndex: agentSeats[i] })),
        humanDesks: visibleHumans.map((h, i) => ({ name: h.name, seatIndex: i === 0 ? OWNER_SEAT : coworkerSeats[i - 1] })),
      });
      dr.zone = zone;
      setDragUI({ agentId: dr.agentId, name: dr.desk.name, zone, x: pt.relX, y: pt.relY });
    };

    const onUp = () => {
      const dr = dragRef.current;
      if (!dr) return;
      dragRef.current = null;
      setDragUI(null);
      if (!dr.active) return;
      justDraggedRef.current = Date.now();
      const s = scene.current;
      if (s) {
        s.drop(dr.agentId);
        if (dr.zone.kind === 'coffee') {
          const a = s.get(dr.agentId);
          const spots = getBreakCoffeeSpots();
          const barSpot = spots.find(sp => sp.isCoffeeBar) ?? spots[0];
          if (a && barSpot) {
            const p = s.path(a.x, a.y, barSpot.x, barSpot.y);
            if (p) { a.state = 'walk'; a.path = p; a.then = 'errand'; a.target = { x: barSpot.x, y: barSpot.y, face: barSpot.face || 'up', kind: 'coffee' }; }
            showTransient({ actorId: dr.agentId, tone: 'coffee', badge: 'Coffee Bar', text: barSpot.label }, 3200, 'coffee');
          }
        } else if (dr.zone.kind === 'desk') {
          s.bubble(dr.agentId, 'mail', 3);
        } else if (dr.zone.kind === 'meeting') {
          s.bubble(dr.agentId, 'idea', 3);
        }
      }
      latest.current.onDropAgent?.(dr.desk, dr.zone);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [agentSeats, coworkerSeats, visibleHumans]);

  // Build prioritized live speech bubbles (position tracked smoothly at 24fps in s.onTick)
  const speechBubbles = useMemo<SpeechBubbleItem[]>(() => {
    const map = new Map<string, SpeechBubbleItem>();
    const ownerLabel = owner?.name ?? 'Owner';

    // 1. Working & Failed status bubbles at desk
    for (const d of shown) {
      const isPreviewWork = previewWorking && d.agentId === shown[0]?.agentId;
      if (d.state === 'failed') {
        map.set(d.agentId, {
          actorId: d.agentId,
          tone: 'failed',
          badge: 'Blocked',
          text: compactLabel(d.bubble || 'Needs retry', 30),
          clickable: true,
        });
      } else if (d.state === 'working' || isPreviewWork) {
        map.set(d.agentId, {
          actorId: d.agentId,
          tone: 'working',
          badge: 'Working',
          text: isPreviewWork ? 'Working on Q4 Launch Brief…' : compactLabel(d.bubble || 'Working on task…', 30),
          clickable: true,
        });
      }
    }

    // 2. Agents waiting for Human Owner Review (walking to or standing beside Owner's desk!)
    for (const id of reviewAgentIds) {
      const d = shown.find(x => x.agentId === id);
      if (!d) continue;
      const revTask = reviewTasksByAgent[id];
      const title = revTask?.title ?? (id === previewReviewId ? 'Q4 Launch Brief' : d.bubble || 'Work ready');
      const arrived = !!reviewArrived[id];
      map.set(id, {
        actorId: id,
        tone: arrived ? 'review' : 'handover',
        badge: arrived ? 'Approval' : 'To Review',
        text: arrived
          ? `Waiting ${ownerLabel}: ${compactLabel(title, 26)}`
          : `Bringing to ${ownerLabel}: ${compactLabel(title, 24)}`,
        issueId: revTask?.id,
        ws: revTask?.ws,
        clickable: true,
      });
    }

    // 3. Standup huddle lead bubble
    if (huddleIds.length > 0) {
      const leadId = huddleIds[0];
      map.set(leadId, {
        actorId: leadId,
        tone: 'standup',
        badge: 'Standup',
        text: `Huddle · ${huddleIds.length} teammates synced`,
        clickable: true,
      });
    }

    // 4. Active handover walks (always visible with clear moving text!)
    for (const w of walks) {
      const payload = handoverSpeechPayload(w);
      map.set(w.from, {
        actorId: w.from,
        tone: payload.tone,
        badge: payload.badge,
        text: payload.text,
        clickable: false,
      });
    }

    // 5. Highest priority: transient celebrations / delivered / revising reactions
    for (const item of Object.values(transientBubbles)) {
      map.set(item.actorId, item);
    }

    return [...map.values()];
  }, [shown, owner, previewWorking, reviewAgentIds, reviewTasksByAgent, previewReviewId, reviewArrived, huddleIds, walks, transientBubbles]);

  // Sync bubble DOM coordinates immediately whenever the bubble list changes
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    for (const b of speechBubbles) {
      const el = speechElsRef.current.get(b.actorId);
      const a = s.get(b.actorId);
      if (!el || !a || a.hidden) continue;
      el.style.left = `${(a.fx / s.W) * 100}%`;
      el.style.top = `${(Math.max(24, a.fy - 36) / s.H) * 100}%`;
    }
  }, [speechBubbles]);

  const letterPoint = seatPoint(agentSeats[Math.max(0, shown.findIndex(d => d.agentId === letter))]);
  const letterX = letterPoint.x;
  const letterY = letterPoint.y;
  const identity = shown.map(d => d.agentId).join('|');
  const humanIdentity = visibleHumans.map(h => h.id + ':' + h.name).join('|');

  useEffect(() => {
    let alive = true;
    let cleanup = () => { };
    load().then(() => {
      if (!alive || !canvas.current) return;
      const O = (window as unknown as { MDOffice: Vendor }).MDOffice;
      const humanActors = visibleHumans.map((h, i) => ({ id: `person:${h.id}`, name: h.name, desk: i === 0 ? OWNER_SEAT : coworkerSeats[i - 1], recipe: O.recipeOf(['michael', 'jim', 'pam', 'dwight', 'angela', 'oscar'][i]), busy: false, human: true }));
      const s = new O.Scene(canvas.current, { layout: 'campus', floorPlan: OFFICE_PLAN, theme: 'campus', fps: 24, agents: [...shown.map((d, i) => ({ id: d.agentId, name: d.name, desk: agentSeats[i], recipe: O.recipeOf(castFor(d.face)), busy: d.state === 'working' })), ...humanActors] });
      scene.current = s;
      // Full Retina rollout: all 23 workstations share one asset library.
      // Give agents their distinct presets and pick unused faces for humans so everyone looks unique.
      const usedAgentFaces = new Set<string>();
      shown.forEach(d => {
        const actor = s.get(d.agentId);
        if (actor) {
          actor.retinaFaceId = d.face;
          if (d.face) usedAgentFaces.add(d.face);
        }
      });
      const allFaceIds = ['yusuf', 'reno', 'mira', 'danu', 'lia', 'tari', 'raya', 'niko', 'sari', 'bima', 'ardi', 'nala'];
      const humanPool = [...allFaceIds.filter(id => !usedAgentFaces.has(id)), ...allFaceIds.filter(id => usedAgentFaces.has(id))];
      visibleHumans.forEach((h, i) => {
        const actor = s.get(`person:${h.id}`);
        if (actor) actor.retinaFaceId = h.face || humanPool[i % humanPool.length];
      });
      const params = new URLSearchParams(window.location.search);
      const retinaEnabled = params.get('retina') !== '0';
      const debugSeat = params.get('retinaSeat');
      const parsedSeat = debugSeat === null ? Number.NaN : Number(debugSeat);
      const singleSeat = debugSeat !== null && Number.isInteger(parsedSeat) && parsedSeat >= 0 && parsedSeat < OFFICE_PLAN.desks.length;
      if (retinaEnabled && O.retinaWorkstation) {
        void O.retinaWorkstation.load().then((assets: unknown) => {
          if (alive && scene.current === s) {
            retinaPackRef.current = assets;
            const options = singleSeat ? { seatIndex: parsedSeat } : {};
            O.retinaWorkstation.install(s, assets, options);
            setSceneReady(n => n + 1);
          }
        }).catch((reason: unknown) => {
          console.warn('[Kantor Retina] Falling back to legacy scene:', reason);
          if (alive && scene.current === s) setSceneReady(n => n + 1);
        });
      } else {
        setSceneReady(n => n + 1);
      }

      const pending = new Map<string, { h: OfficeWalk; delivered: boolean }>();
      const syncSpeechDOM = () => {
        speechElsRef.current.forEach((el, actorId) => {
          const a = s.get(actorId);
          if (!a || a.hidden) {
            el.style.opacity = '0';
            return;
          }
          el.style.opacity = '1';
          el.style.left = `${(a.fx / s.W) * 100}%`;
          el.style.top = `${(Math.max(24, a.fy - 36) / s.H) * 100}%`;
        });
      };

      s.onTick = () => {
        for (const d of latest.current.desks) {
          const a = s.get(d.agentId);
          if (!a) continue;
          if (a.state === 'held') continue;
          a.busy = d.state === 'working' || (latest.current.previewWorking && d.agentId === latest.current.desks[0]?.agentId);

          // Keep huddled agents standing around the meeting table
          if (a.huddleHold && a.state === 'errand') {
            a.timer = Math.max(a.timer, 8);
            if (!a.bubble || a.bubble.until < s.t) s.bubble(d.agentId, 'idea', 2.6);
            continue;
          }

          // Keep agents waiting for owner approval standing beside the owner's desk
          if (a.reviewHold && a.state === 'errand') {
            a.timer = Math.max(a.timer, 8);
            if (!a.bubble || a.bubble.until < s.t) s.bubble(d.agentId, 'ask', 2.6);
            if (!a._notifiedReviewArrived) {
              a._notifiedReviewArrived = true;
              setReviewArrived(cur => (cur[d.agentId] ? cur : { ...cur, [d.agentId]: true }));
            }
            continue;
          } else if (a._notifiedReviewArrived && !a.reviewHold) {
            a._notifiedReviewArrived = false;
          }

          a.hidden = !a.busy && !a.huddleHold && !a.reviewHold && ['home', 'off', 'closed'].includes(d.state) && a.state === 'seat';
          if (a.hidden) continue;

          // Live pixel bubbles driven by real Multica desk state
          // Suppress redundant '...' pixel bubble while the crisp "WORKING" badge is shown!
          if (a.busy || d.state === 'working') {
            if (a.bubble && a.bubble.kind === 'dots') a.bubble = null;
          } else {
            const desired = bubbleKindForState(d.state);
            if (desired && desired !== 'dots' && (!a.bubble || a.bubble.until < s.t)) {
              if (desired === 'ask' || desired === 'drop') s.bubble(d.agentId, desired, 2.5);
              else if (a.state === 'seat' && Math.floor(s.t) % 7 === (a.desk % 7)) s.bubble(d.agentId, desired, 2);
            }
          }
        }

        for (const h of latest.current.walks) {
          if (pending.has(h.key)) continue;
          const a = s.get(h.from), b = s.get(h.to);
          if (!a || !b) { latest.current.onDone(h.key); continue; }
          const candidates = [[b.x - 1, b.y], [b.x + 1, b.y], [b.x, b.y + 1], [b.x, b.y - 1]].filter(([x, y]) => s.walk[y]?.[x]);
          const path = candidates.map(([x, y]) => s.path(a.x, a.y, x, y)).filter(Boolean).sort((p: number[][], q: number[][]) => p.length - q.length)[0];
          if (!path) { latest.current.onDone(h.key); continue; }
          a.hidden = false;
          setAck(`${h.fromName} → ${h.toName}: ${h.title}`);
          s.bubble(h.from, 'mail', 3);
          a.state = 'walk';
          a.path = path;
          a.then = 'errand';
          a.target = { face: 'up', kind: 'chat' };
          pending.set(h.key, { h, delivered: false });
        }

        for (const [key, p] of pending) {
          const a = s.get(p.h.from);
          if (!p.delivered && a?.state === 'errand') {
            p.delivered = true;
            s.bubble(p.h.to, 'check', 3.2);
            showTransient(
              { actorId: p.h.to, tone: 'approved', badge: 'Received', text: `From ${p.h.fromName}: ${compactLabel(p.h.title, 26)}` },
              2800,
              'check'
            );
            latest.current.onDelivered(p.h);
          }
          if (p.delivered && a?.state === 'seat') {
            pending.delete(key);
            latest.current.onDone(key);
          }
        }

        syncSpeechDOM();
      };

      // Initial placement for already-in-review agents right after scene mounts
      if (reviewAgentIds.length > 0) {
        const spots = ownerReviewSpotsFor(reviewAgentIds.length, (x, y) => !!s.walk[y]?.[x]);
        reviewAgentIds.forEach((id, idx) => {
          const a = s.get(id);
          const spot = spots[idx];
          if (!a || !spot) return;
          a.hidden = false;
          a.reviewHold = true;
          a.reviewSpot = spot;
          const path = s.path(a.x, a.y, spot.x, spot.y);
          if (path && path.length) {
            a.state = 'walk';
            a.path = path;
            a.then = 'errand';
            a.target = { x: spot.x, y: spot.y, face: spot.face, kind: 'chat' };
            s.bubble(id, 'mail', 3);
          }
        });
        prevReviewIds.current = reviewAgentIds;
      }

      const reduced = matchMedia('(prefers-reduced-motion: reduce)');
      const visibility = () => { if (document.visibilityState === 'visible' && !reduced.matches) s.start(); else { s.stop(); s.draw(); syncSpeechDOM(); } };
      visibility();
      document.addEventListener('visibilitychange', visibility);
      reduced.addEventListener('change', visibility);
      const clockTimer = setInterval(() => { if (!s.running && !document.hidden) s.draw(); }, 30000);
      const lunchTimer = setInterval(() => {
        if (!latest.current.lunch || document.hidden) return;
        const breakSpots = [
          ...OFFICE_PLAN.errands.filter(e => e.kind === 'coffee'),
          { ...OFFICE_PLAN.lunch, face: 'down', kind: 'coffee' },
        ];
        latest.current.desks.forEach((d, idx) => {
          const a = s.get(d.agentId);
          if (a && ['home', 'ready', 'break'].includes(d.state) && a.state === 'seat' && !a.huddleHold && !a.reviewHold) {
            const spot = breakSpots[idx % breakSpots.length] ?? { ...OFFICE_PLAN.lunch, face: 'down', kind: 'coffee' };
            const target = { x: spot.x, y: spot.y, face: spot.face || 'up', kind: 'coffee' };
            const path = s.path(a.x, a.y, target.x, target.y);
            if (!path) return;
            a.hidden = false; a.state = 'walk'; a.path = path; a.then = 'errand'; a.target = target;
          }
        });
      }, 15000);
      cleanup = () => { s.stop(); clearInterval(clockTimer); clearInterval(lunchTimer); document.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', visibility); scene.current = null; };
    }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; cleanup(); };
    // Rebuild only when seats or appearances change, not on polling updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, humanIdentity]);

  // Instant zero-rebuild floor sprite swap whenever any human member or agent changes avatar!
  const faceSignature = shown.map(d => `${d.agentId}:${d.face ?? ''}`).join('|')
    + '||' + visibleHumans.map(h => `${h.id}:${h.face ?? ''}`).join('|');
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    let changed = false;
    shown.forEach(d => {
      const actor = s.get(d.agentId);
      if (actor && d.face && actor.retinaFaceId !== d.face) {
        actor.retinaFaceId = d.face;
        changed = true;
      }
    });
    visibleHumans.forEach(h => {
      const actor = s.get(`person:${h.id}`);
      if (actor && h.face && actor.retinaFaceId !== h.face) {
        actor.retinaFaceId = h.face;
        changed = true;
      }
    });
    if (changed && typeof s.draw === 'function') s.draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceSignature, sceneReady]);

  // Live Harvest Moon / Studio Campus theme & time-of-day lighting switcher (zero scene rebuild)
  useEffect(() => {
    let active = true;
    const s = scene.current;
    if (!s) return;
    const O = (window as unknown as { MDOffice?: Vendor }).MDOffice;
    if (!O?.harvest) return;
    if (floorTheme === 'harvest') {
      if (s.harvestTheme) {
        s.harvestTheme.setPhase(harvestPhase);
      } else {
        void O.harvest.load().then((pack: unknown) => {
          if (active && scene.current === s && !s.harvestTheme) {
            O.harvest.install(s, pack, retinaPackRef.current, harvestPhase);
          }
        }).catch((reason: unknown) => {
          console.warn('[Kantor Harvest] Could not activate Harvest Moon theme:', reason);
        });
      }
    } else if (s.harvestTheme) {
      s.harvestTheme.uninstall();
    }
    return () => { active = false; };
  }, [floorTheme, harvestPhase, sceneReady]);

  function handleBubbleClick(item: SpeechBubbleItem) {
    if (item.issueId && item.ws && onOpenTask) {
      onOpenTask(item.issueId, item.ws);
      return;
    }
    if (item.tone === 'standup') {
      onMeeting();
      return;
    }
    const desk = shown.find(d => d.agentId === item.actorId);
    if (desk) onDesk(desk);
  }

  return (
    <div className={`reference-office campus-office${floorTheme === 'harvest' ? ` harvest-office harvest-${harvestPhase}` : ''}${dragUI ? ' is-dragging' : ''}`} ref={frame}>
      <canvas ref={surroundings} className="campus-surroundings" aria-hidden="true" />
      <div
        className="reference-stage"
        ref={stageRef}
        style={size ? { width: size.width, height: size.height } : { width: '100%', aspectRatio: `${OFFICE_PLAN.cols}/${OFFICE_PLAN.rows}` }}
      >
        {error && <p role="alert">{error}</p>}
        <canvas
          ref={canvas}
          className="reference-canvas"
          aria-label="Animated office floor"
          onPointerDown={e => {
            const s = scene.current;
            const pt = toWorld(e.clientX, e.clientY);
            if (!s || !pt) return;
            const id = s.hit(pt.wx, pt.wy);
            const d = shown.find(x => x.agentId === id);
            if (d) beginDrag(d, e.clientX, e.clientY);
          }}
          onClick={e => {
            if (Date.now() - justDraggedRef.current < 260) return;
            const s = scene.current;
            if (!s) return;
            const r = e.currentTarget.getBoundingClientRect();
            const id = s.hit((e.clientX - r.left) * s.W / r.width, (e.clientY - r.top) * s.H / r.height);
            const d = desks.find(d => d.agentId === id);
            if (d) onDesk(d);
            else {
              const h = visibleHumans.find(h => `person:${h.id}` === id);
              if (h) onHuman(h.name);
            }
          }}
        />
        {ack && <div className="scene-ack" role="status">{ack}</div>}
        {letter && shown.some(d => d.agentId === letter) && (
          <div className="delivery-letter" key={letter} aria-label="Message delivered" style={{ '--letter-x': `${(letterX + 1) / OFFICE_PLAN.cols * 100}%`, '--letter-y': `${(letterY - 1) / OFFICE_PLAN.rows * 100}%` } as React.CSSProperties}>
            ✉<small>Delivered</small>
          </div>
        )}

        {/* Live moving speech bubbles tracking characters across working, handover, and owner-desk review */}
        <div className="actor-speech-layer" aria-live="polite">
          {speechBubbles.map(item => (
            <button
              key={item.actorId}
              type="button"
              ref={el => {
                if (el) speechElsRef.current.set(item.actorId, el);
                else speechElsRef.current.delete(item.actorId);
              }}
              className={`actor-speech tone-${item.tone}${item.clickable ? ' is-clickable' : ''}${hoveredActorId === item.actorId ? ' is-expanded' : ''}`}
              onClick={e => {
                e.stopPropagation();
                if (item.clickable) handleBubbleClick(item);
              }}
              onMouseEnter={() => setHoveredActorId(item.actorId)}
              onMouseLeave={() => setHoveredActorId(cur => (cur === item.actorId ? null : cur))}
              tabIndex={item.clickable ? 0 : -1}
              aria-label={`${item.badge}: ${item.text}`}
            >
              <span className="as-badge">{item.badge}</span>
              <span className="as-text">{item.text}</span>
            </button>
          ))}
        </div>

        {dragUI && (
          <div
            className={`drag-pill drag-${dragUI.zone.kind}`}
            style={{ left: dragUI.x, top: Math.max(18, dragUI.y - 44) }}
            role="status"
          >
            {describeDropTarget(dragUI.name, dragUI.zone)}
          </div>
        )}
        <div className="reference-hotspots">
          {shown.map((d, i) => {
            const isTarget = dragUI?.zone.kind === 'desk' && dragUI.zone.agentId === d.agentId;
            return (
              <button
                key={d.agentId}
                className={`hs-seat hs-${d.state}${isTarget ? ' is-drop-target' : ''}`}
                style={seatBounds(agentSeats[i])}
                onPointerDown={e => {
                  if (e.button !== 0) return;
                  beginDrag(d, e.clientX, e.clientY);
                }}
                onMouseEnter={() => setHoveredActorId(d.agentId)}
                onMouseLeave={() => setHoveredActorId(cur => (cur === d.agentId ? null : cur))}
                onClick={() => {
                  if (Date.now() - justDraggedRef.current < 260) return;
                  onDesk(d);
                }}
                aria-label={`${d.name}. ${d.squad}. ${d.bubble}. Drag onto another desk or room to hand off.`}
              >
                <span>
                  <strong className="hs-name">{d.name}</strong>
                  {d.squad && <em className="hs-meta">{d.squad}</em>}
                  <small>{d.bubble}</small>
                  <small className="hs-tip">Drag to hand off · Click to open</small>
                </span>
              </button>
            );
          })}
          {owner && (
            <button
              className={`hs-seat hs-human${dragUI?.zone.kind === 'human' && dragUI.zone.name === owner.name ? ' is-drop-target' : ''}`}
              style={seatBounds(OWNER_SEAT)}
              onClick={() => onHuman(owner.name)}
              aria-label={`${owner.name}'s office`}
            >
              <span><strong className="hs-name">{owner.name}</strong><small>Private office &amp; approvals</small></span>
            </button>
          )}
          {coworkers.map((h, i) => (
            <button
              className={`hs-seat human-hotspot hs-human${dragUI?.zone.kind === 'human' && dragUI.zone.name === h.name ? ' is-drop-target' : ''}`}
              key={h.id}
              style={seatBounds(coworkerSeats[i])}
              onClick={() => onHuman(h.name)}
              aria-label={`${h.name}'s desk`}
            >
              <span><strong className="hs-name">{h.name}</strong><small>Human teammate</small></span>
            </button>
          ))}
          {FLOOR_PROPS.map(prop => {
            const isTarget = dragUI?.zone.kind === prop.kind;
            const copy = floorPropLabel(floorTheme, prop.kind);
            return (
              <button
                key={prop.kind}
                className={`hs-seat hs-prop hs-${prop.kind}${isTarget ? ' is-drop-target' : ''}`}
                style={tileRectBounds(prop)}
                onClick={() => (prop.kind === 'meeting' ? onMeeting() : onPropClick?.(prop.kind))}
                aria-label={`${copy.title}: ${copy.hint}`}
              >
                <span>
                  <strong className="hs-name">{copy.title}</strong>
                  <small>{copy.hint}</small>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {pages > 1 && <div className="floor-pages"><button disabled={!currentPage} onClick={() => setPage(p => p - 1)}>←</button> Agents {currentPage + 1}/{pages} <button disabled={currentPage === pages - 1} onClick={() => setPage(p => p + 1)}>→</button></div>}
      {lunch && <span className="lunch-sign">Lunch break · until 13:00</span>}
    </div>
  );
}
