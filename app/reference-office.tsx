"use client";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Desk } from '@/lib/office';
import { castFor } from '@/lib/munder-cast';
import { floorSeats, OFFICE_PLAN, OWNER_SEAT, seatBounds } from '@/lib/floor-seats';
import {
  bubbleKindForState,
  buildTwoWayDialog,
  GOODBYE_LINES,
  interactiveFloorProps,
  meetingSpotsFor,
  MORNING_GREETINGS,
  ownerReviewSpotsFor,
  pickOwnerInteraction,
  resolveDropZone,
  tileRectBounds,
  type BubbleKind,
  type DropZone,
  type FloorPropKind,
  type OwnerActivityKind,
  type OwnerStrollPlan,
  type ReviewStyle,
  type SpeechBubbleItem,
  type SpeechBubbleTone,
} from '@/lib/munder-workflows';
import {
  buildFloorSpeechBubbles,
  clampNum,
  computeFloorScale,
  computeHoverCardPlacement,
  computeReviewAssignments,
  computeSpeechBubblePlacement,
  describeDropTarget,
  getBreakCoffeeSpots,
  isActorAbsentFromDesk,
  planLunchErrands,
  planWorkdayLifeStep,
  resolveHumanFaces,
  seatPointFor,
  walkableAdjacentTiles,
} from '@/lib/office-engine';
import type { Handover } from './handover';
import { floorPropLabel, type FloorTheme, type HarvestPhase } from '@/lib/harvest-theme';
import type { OfficePhase } from '@/lib/office-time';

// The campus extends the MIT procedural engine with a shared floor plan and custom artwork.
// Its isolated JS API is deliberately kept at this boundary.
type Vendor = any;
let loading: Promise<void> | undefined;
function load() {
  return loading ??= (async () => {
    for (const name of ['/vendor/munder/avatars.js', '/vendor/munder/office.js?v=2', '/office-campus.js']) await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script'); s.src = name; s.onload = () => resolve(); s.onerror = () => reject(new Error('Could not load office artwork')); document.head.appendChild(s);
    });
    const art = new Image(); art.src = '/art/office-reference.png'; await art.decode();
    (window as unknown as { MDOffice: Vendor }).MDOffice.campusArt = art;
    // Optional Phase 03 Retina workstation & Stardew Valley scene adapters.
    for (const extra of ['/retina-workstation.js', '/office-harvest.js?v=16']) {
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

const FLOOR_PROPS = interactiveFloorProps();

export type ReviewTaskInfo = { id: string; ws: string; title: string; questionCount?: number };
export type OfficeWalk = Handover & { key: string; kind?: 'assign' | 'revise' | 'review' | 'handoff' };

type HoverCardState = {
  key: string;
  actorId?: string;
  anchorEl: HTMLElement;
  title: string;
  badge?: string;
  detail: string;
  tip?: string;
};

const ReferenceOffice = memo(function ReferenceOffice({
  desks,
  humans,
  ownerId,
  officeOpen,
  officePhase = 'working',
  phaseLabel = '',
  lunch,
  reviewStyle = 'auto',
  previewWorking,
  previewReviewId = null,
  huddleIds = [],
  coffeeTick = 0,
  reviewTasksByAgent = {},
  floorTheme = 'harvest',
  harvestPhase = 'day',
  paused = false,
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
  officePhase?: OfficePhase;
  phaseLabel?: string;
  lunch: boolean;
  reviewStyle?: ReviewStyle;
  previewWorking: boolean;
  previewReviewId?: string | null;
  huddleIds?: string[];
  coffeeTick?: number;
  reviewTasksByAgent?: Record<string, ReviewTaskInfo>;
  floorTheme?: FloorTheme;
  harvestPhase?: HarvestPhase;
  paused?: boolean;
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
      setSize(computeFloorScale(width, height, OFFICE_PLAN));
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
  const orderedHumans = ownerId ? [...humans.filter(h => h.id === ownerId), ...humans.filter(h => h.id !== ownerId)] : humans;
  const visibleHumans = orderedHumans.slice(0, 6);
  const owner = visibleHumans[0];
  const coworkers = visibleHumans.slice(1);
  const { coworkerSeats, agentSeats } = floorSeats(visibleHumans.length);
  const offDuty = !officeOpen || (officePhase !== 'working' && officePhase !== 'lunch');
  const latest = useRef({ desks, lunch, officeOpen, officePhase, offDuty, paused, previewWorking, previewReviewId, walks, onDelivered, onDone, onDropAgent, onMeeting, onPropClick, onHuman, agentSeats, coworkerSeats, visibleHumans });
  latest.current = { desks, lunch, officeOpen, officePhase, offDuty, paused, previewWorking, previewReviewId, walks, onDelivered, onDone, onDropAgent, onMeeting, onPropClick, onHuman, agentSeats, coworkerSeats, visibleHumans };

  // Active human owner stroll state (for arrival-triggered 2-way agent chats & room interactions)
  const ownerStrollRef = useRef<{
    ownerActorId: string;
    plan: OwnerStrollPlan;
    arrived: boolean;
    replyTimer: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const ownerLastTargetRef = useRef<string | null>(null);
  const ownerSeedRef = useRef(1);

  // Two real break destinations: Kitchen Pantry (x=7, y=7) & Dedicated Coffee Machine Bar (x=35, y=5)
  const breakSpotCursorRef = useRef(0);

  const [letter, setLetter] = useState<string | null>(null);
  const [ack, setAck] = useState('');
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [dragUI, setDragUI] = useState<{ agentId: string; name: string; zone: DropZone; x: number; y: number } | null>(null);
  const [transientBubbles, setTransientBubbles] = useState<Record<string, SpeechBubbleItem & { expiresAt: number }>>({});
  const [reviewArrived, setReviewArrived] = useState<Record<string, boolean>>({});
  const [hoveredActorId, setHoveredActorId] = useState<string | null>(null);
  const [hoverCard, setHoverCard] = useState<HoverCardState | null>(null);
  const hoverCardRef = useRef<HTMLDivElement>(null);
  const [hoverCardPos, setHoverCardPos] = useState<{ left: number; top: number; arrowX: number; below: boolean } | null>(null);
  const dragRef = useRef<{ agentId: string; desk: Desk; startX: number; startY: number; active: boolean; zone: DropZone } | null>(null);
  const justDraggedRef = useRef(0);

  // Clear hovercard whenever dragging starts, scene pauses (drawer/modal opens), or floor page changes
  useEffect(() => {
    if (paused || dragUI) setHoverCard(null);
  }, [paused, dragUI]);
  useEffect(() => {
    setHoverCard(null);
  }, [page]);

  const showHoverCard = useCallback((next: HoverCardState) => {
    if (dragRef.current?.active) return;
    setHoverCard(next);
  }, []);

  const hideHoverCard = useCallback((key: string) => {
    setHoverCard(cur => (cur?.key === key ? null : cur));
  }, []);

  // Measure and clamp/flip the active hovercard inside safe viewport & office-frame bounds (zero clipping!)
  useLayoutEffect(() => {
    if (!hoverCard || paused || dragUI) {
      setHoverCardPos(null);
      return;
    }
    const update = () => {
      const cardEl = hoverCardRef.current;
      const anchorEl = hoverCard.anchorEl;
      if (!cardEl || !anchorEl || !anchorEl.isConnected) {
        setHoverCardPos(null);
        return;
      }
      const ar = anchorEl.getBoundingClientRect();
      const fr = frame.current?.getBoundingClientRect();
      setHoverCardPos(computeHoverCardPlacement({
        anchor: ar,
        frame: fr,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
        cardW: cardEl.offsetWidth || 210,
        cardH: cardEl.offsetHeight || 78,
      }));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [hoverCard, paused, dragUI]);

  // Promote active hovercard to native browser Top Layer via popover="manual" when supported
  const hasHoverPos = hoverCardPos !== null;
  useEffect(() => {
    const el = hoverCardRef.current;
    if (!el || typeof HTMLElement === 'undefined' || !Object.hasOwn(HTMLElement.prototype, 'popover')) return;
    if (hoverCard && hasHoverPos && !paused && !dragUI) {
      if (el.getAttribute('popover') !== 'manual') el.setAttribute('popover', 'manual');
      try { if (!el.matches(':popover-open')) el.showPopover(); } catch { /* ignore */ }
    } else {
      try { if (el.matches(':popover-open')) el.hidePopover(); } catch { /* ignore */ }
    }
  }, [hoverCard, hasHoverPos, paused, dragUI]);

  const pages = Math.max(1, Math.ceil(desks.length / agentSeats.length));
  const currentPage = Math.min(page, pages - 1);
  const shown = useMemo(
    () => desks.slice(currentPage * agentSeats.length, currentPage * agentSeats.length + agentSeats.length),
    [desks, currentPage, agentSeats.length]
  );
  const shownRef = useRef(shown);
  shownRef.current = shown;

  // Agents currently awaiting human owner review (partitioned into Alt 1: Walk to Owner vs Alt 2: Desk Bubble)
  const { walkReviewIds, deskReviewIds } = useMemo(
    () => computeReviewAssignments({ shown, reviewTasksByAgent, previewReviewId, huddleCount: huddleIds.length, offDuty, reviewStyle }),
    [shown, reviewTasksByAgent, previewReviewId, huddleIds.length, offDuty, reviewStyle]
  );
  const reviewAgentIds = walkReviewIds;

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

  /** Send the Human Owner on a natural studio stroll (Coffee Bar, Pantry, Washroom, Lounge, or 2-way agent check-in). */
  const triggerOwnerStroll = (preferredKind?: OwnerActivityKind | 'agent', force = false) => {
    const s = scene.current;
    const curOwner = latest.current.visibleHumans[0];
    if (!s || !curOwner) return;
    if (!force && (document.hidden || latest.current.paused || latest.current.offDuty || !s.running)) return;
    const ownerIdKey = `person:${curOwner.id}`;
    const ownerActor = s.get(ownerIdKey);
    if (!ownerActor || ownerActor.hidden || ownerActor.state === 'held') return;
    // Do not interrupt an existing casual walk/errand unless user explicitly triggered a new destination
    if (!force && ownerActor.state !== 'seat') return;
    // Stay at Executive Suite desk while agents are queued inside the Owner's room awaiting approval
    const hasWaitingReview = !force && s.agents.some((ag: Vendor) => ag.reviewHold && !ag.hidden);
    if (hasWaitingReview) return;
    // Don't collide with an active handover walk initiated by the Owner
    if (latest.current.walks.some(w => w.from === ownerIdKey || w.to === ownerIdKey)) return;

    const occupied = new Set<string>();
    for (const ag of s.agents) {
      if (ag.id !== ownerIdKey && ag.target && typeof ag.target.x === 'number') {
        occupied.add(`${ag.target.x},${ag.target.y}`);
      }
    }

    const visitableAgents = shownRef.current
      .filter(d => {
        const ag = s.get(d.agentId);
        return ag && !ag.hidden && !ag.reviewHold && !ag.huddleHold && ag.state === 'seat';
      })
      .map(d => ({ agentId: d.agentId, name: d.name, state: d.state }));

    const plan = pickOwnerInteraction({
      lunch: latest.current.lunch,
      seed: ownerSeedRef.current++,
      agents: visitableAgents,
      preferredKind,
      lastTargetKey: ownerLastTargetRef.current,
      occupiedKeys: occupied,
      isWalkable: (x, y) => !!s.walk[y]?.[x],
    });
    if (!plan) return;

    let dest: { x: number; y: number; face: 'up' | 'down'; kind: string } | null = null;
    if (plan.type === 'visit-agent') {
      const ag = s.get(plan.agent.agentId);
      if (!ag) return;
      const candidates = [
        [ag.x, ag.y + 1],
        [ag.x, ag.y - 1],
        [ag.x - 1, ag.y],
        [ag.x + 1, ag.y],
      ].filter(([x, y]) => s.walk[y]?.[x]);
      let bestPath: number[][] | null = null;
      let bestTile: number[] | null = null;
      for (const tile of candidates) {
        const p = s.path(ownerActor.x, ownerActor.y, tile[0], tile[1]);
        if (p && p.length && (!bestPath || p.length < bestPath.length)) {
          bestPath = p;
          bestTile = tile;
        }
      }
      if (!bestPath || !bestTile) return;
      dest = { x: bestTile[0], y: bestTile[1], face: bestTile[1] > ag.y ? 'up' : 'down', kind: 'chat' };
      ownerActor.state = 'walk';
      ownerActor.path = bestPath;
      ownerActor.then = 'errand';
      ownerActor.target = dest;
      ownerLastTargetRef.current = `agent:${plan.agent.agentId}`;
      showTransient({ actorId: ownerIdKey, tone: 'standup', badge: 'Keliling', text: plan.departLine }, 2800, 'dots');
    } else {
      const path = s.path(ownerActor.x, ownerActor.y, plan.spot.x, plan.spot.y);
      if (!path || !path.length) return;
      dest = {
        x: plan.spot.x,
        y: plan.spot.y,
        face: plan.spot.face,
        kind: plan.spot.kind === 'coffee' || plan.spot.kind === 'pantry'
          ? 'coffee'
          : plan.spot.kind === 'washroom' || plan.spot.kind === 'hub'
            ? 'cooler'
            : plan.spot.kind === 'board' || plan.spot.kind === 'boardroom'
              ? 'board'
              : 'window',
      };
      ownerActor.state = 'walk';
      ownerActor.path = path;
      ownerActor.then = 'errand';
      ownerActor.target = dest;
      ownerLastTargetRef.current = `spot:${plan.spot.id}`;
      showTransient({ actorId: ownerIdKey, tone: plan.spot.tone, badge: plan.spot.badge, text: plan.departLine }, 3000, plan.spot.bubbleKind);
    }

    if (ownerStrollRef.current?.replyTimer) clearTimeout(ownerStrollRef.current.replyTimer);
    ownerStrollRef.current = { ownerActorId: ownerIdKey, plan, arrived: false, replyTimer: null };
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
    const dialog = (event: Event) => {
      const detail = (event as CustomEvent<{
        fromId: string;
        toId: string;
        fromName: string;
        toName: string;
        title: string;
        kind: 'handoff' | 'assign' | 'revise' | 'review' | 'approve';
      }>).detail;
      if (!detail?.fromId || !detail?.toId) return;
      const dlg = buildTwoWayDialog(detail);
      showTransient(
        { actorId: detail.fromId, tone: dlg.senderTone, badge: dlg.senderBadge, text: dlg.senderText },
        3600,
        dlg.senderPixel
      );
      setTimeout(() => {
        showTransient(
          { actorId: detail.toId, tone: dlg.replyTone, badge: dlg.replyBadge, text: dlg.replyText },
          3600,
          dlg.replyPixel
        );
      }, 1050);
    };
    const ownerStroll = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: OwnerActivityKind | 'agent' }>).detail;
      triggerOwnerStroll(detail?.kind, true);
    };
    window.addEventListener('kantor:letter', receive);
    window.addEventListener('kantor:celebrate', celebrate);
    window.addEventListener('kantor:speech', speech);
    window.addEventListener('kantor:coffee', coffee);
    window.addEventListener('kantor:dialog', dialog);
    window.addEventListener('kantor:owner-stroll', ownerStroll);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('kantor:letter', receive);
      window.removeEventListener('kantor:celebrate', celebrate);
      window.removeEventListener('kantor:speech', speech);
      window.removeEventListener('kantor:coffee', coffee);
      window.removeEventListener('kantor:dialog', dialog);
      window.removeEventListener('kantor:owner-stroll', ownerStroll);
    };
  }, [agentSeats.length]);

  useEffect(() => { if (!ack) return; const timer = setTimeout(() => setAck(''), 4000); return () => clearTimeout(timer); }, [ack]);

  // Door entry / exit animation when office switches open <-> closed OR work hours start (08:00) / end (17:30)
  const prevOffDuty = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevOffDuty.current === null) {
      prevOffDuty.current = offDuty;
      return;
    }
    if (prevOffDuty.current === offDuty) return;
    prevOffDuty.current = offDuty;
    const s = scene.current;
    if (!s || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (!offDuty) {
      setAck('Jam kerja dimulai · Agen masuk kantor');
      shownRef.current.forEach((d, i) => {
        timers.push(setTimeout(() => {
          const a = s.get(d.agentId);
          if (!a) return;
          a.hidden = true;
          s.come(d.agentId);
          const greet = MORNING_GREETINGS[i % MORNING_GREETINGS.length];
          if (i < 4) showTransient({ actorId: d.agentId, tone: 'approved', badge: 'Pagi', text: greet }, 3200, 'sun');
          else s.bubble(d.agentId, 'sun', 3);
        }, i * 260));
      });
    } else {
      setAck(officeOpen ? 'Jam kerja selesai (17:30) · Agen pulang' : 'Kantor ditutup · Agen pulang');
      shownRef.current.forEach((d, i) => {
        timers.push(setTimeout(() => {
          const a = s.get(d.agentId);
          if (!a || a.busy || a.hidden) return;
          a.reviewHold = false;
          a.huddleHold = false;
          const bye = GOODBYE_LINES[i % GOODBYE_LINES.length];
          if (i < 3) showTransient({ actorId: d.agentId, tone: 'coffee', badge: 'Pulang', text: bye }, 2800, 'zz');
          else s.bubble(d.agentId, 'zz', 2.5);
          s.leave(d.agentId);
        }, i * 220));
      });
    }
    return () => { timers.forEach(clearTimeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offDuty]);

  // End of lunch break (13:15): gently call break-roaming agents back to their desks
  const prevLunchRef = useRef(lunch);
  useEffect(() => {
    const wasLunch = prevLunchRef.current;
    prevLunchRef.current = lunch;
    if (!wasLunch || lunch) return;
    const s = scene.current;
    if (!s || offDuty) return;
    shownRef.current.forEach((d, i) => {
      const a = s.get(d.agentId);
      if (!a || a.hidden || a.busy || a.huddleHold || a.reviewHold || a.state === 'seat' || a.state === 'held') return;
      const desk = s.L.desks[a.desk];
      const st = s.seatTile(desk);
      a.target = null;
      const p = s.path(a.x, a.y, st[0], st[1]);
      if (p) { a.state = 'walk'; a.path = p; a.then = 'seat'; }
      if (i < 3) showTransient({ actorId: d.agentId, tone: 'working', badge: '13:15', text: 'Balik kerja lagi 💪' }, 2800, 'sun');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lunch, offDuty]);

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
      const { agentSeats: curAgentSeats, coworkerSeats: curCoworkerSeats, visibleHumans: curHumans } = latest.current;
      const zone = resolveDropZone(pt.wx, pt.wy, {
        draggedAgentId: dr.agentId,
        agentDesks: shownRef.current.map((d, i) => ({ agentId: d.agentId, name: d.name, seatIndex: curAgentSeats[i] })),
        humanDesks: curHumans.map((h, i) => ({ name: h.name, seatIndex: i === 0 ? OWNER_SEAT : curCoworkerSeats[i - 1] })),
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
  }, []);

  // Build prioritized live speech bubbles via lib/office-engine/dialog-overlay
  const speechBubbles = useMemo<SpeechBubbleItem[]>(
    () => buildFloorSpeechBubbles({
      shown,
      ownerName: owner?.name ?? 'Owner',
      offDuty,
      previewWorking,
      walkReviewIds,
      deskReviewIds,
      reviewTasksByAgent,
      previewReviewId,
      reviewArrived,
      huddleIds,
      walks,
      transientBubbles,
    }),
    [shown, owner, offDuty, previewWorking, walkReviewIds, deskReviewIds, reviewTasksByAgent, previewReviewId, reviewArrived, huddleIds, walks, transientBubbles]
  );

  // Position any speech bubble strictly inside the visible office frame with automatic top/bottom flip & dynamic tail
  const placeSpeechEl = useCallback((el: HTMLElement, a: { fx: number; fy: number }, s: { W: number; H: number }) => {
    const stageEl = stageRef.current;
    const frameEl = frame.current;
    const stageW = stageEl?.clientWidth || 0;
    const stageH = stageEl?.clientHeight || 0;
    if (!stageW || !stageH) {
      el.style.left = `${(a.fx / s.W) * 100}%`;
      el.style.top = `${(Math.max(28, a.fy - 36) / s.H) * 100}%`;
      return;
    }
    const placed = computeSpeechBubblePlacement({
      actorX: a.fx,
      actorY: a.fy,
      worldW: s.W,
      worldH: s.H,
      stageW,
      stageH,
      frameW: frameEl?.clientWidth || stageW,
      frameH: frameEl?.clientHeight || stageH,
      bubbleW: el.offsetWidth || 88,
      bubbleH: el.offsetHeight || 26,
    });
    el.classList.toggle('is-below', placed.flipBelow);
    el.style.left = `${placed.left}px`;
    el.style.top = `${placed.top}px`;
    el.style.setProperty('--tail-x', `${placed.tailX}px`);
  }, []);

  // Sync bubble DOM coordinates immediately whenever the bubble list, hover expansion, or stage size changes
  useLayoutEffect(() => {
    const s = scene.current;
    if (!s) return;
    for (const b of speechBubbles) {
      const el = speechElsRef.current.get(b.actorId);
      const a = s.get(b.actorId);
      if (!el || !a || a.hidden) continue;
      placeSpeechEl(el, a, s);
    }
  }, [speechBubbles, hoveredActorId, size, placeSpeechEl]);

  const letterPoint = seatPointFor(agentSeats[Math.max(0, shown.findIndex(d => d.agentId === letter))], OFFICE_PLAN);
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
          actor.hidden = isActorAbsentFromDesk({ busy: !!actor.busy, offDuty: latest.current.offDuty, deskState: d.state });
          if (d.face) usedAgentFaces.add(d.face);
        }
      });
      const humanFaces = resolveHumanFaces(visibleHumans, usedAgentFaces);
      visibleHumans.forEach(h => {
        const actor = s.get(`person:${h.id}`);
        if (actor) actor.retinaFaceId = humanFaces[h.id];
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
      const lastSpeechPos = new Map<string, string>();
      const syncSpeechDOM = () => {
        speechElsRef.current.forEach((el, actorId) => {
          const a = s.get(actorId);
          if (!a || a.hidden) {
            if (lastSpeechPos.get(actorId) !== 'hidden') {
              el.style.opacity = '0';
              lastSpeechPos.set(actorId, 'hidden');
            }
            return;
          }
          const rx = Math.round(a.fx * 2);
          const ry = Math.round(a.fy * 2);
          const ew = el.offsetWidth;
          const key = `${rx},${ry},${ew}`;
          if (lastSpeechPos.get(actorId) === key) return;
          lastSpeechPos.set(actorId, key);
          el.style.opacity = '1';
          placeSpeechEl(el, a, s);
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

          a.hidden = isActorAbsentFromDesk({
            busy: !!a.busy,
            huddleHold: !!a.huddleHold,
            reviewHold: !!a.reviewHold,
            offDuty: latest.current.offDuty,
            deskState: d.state,
            actorState: a.state,
          });
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
          const candidates = walkableAdjacentTiles(s.walk, b.x, b.y, a.x, a.y);
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
            const dlg = buildTwoWayDialog({
              kind: p.h.kind ?? 'handoff',
              fromName: p.h.fromName,
              toName: p.h.toName,
              title: p.h.title,
            });
            s.bubble(p.h.to, dlg.replyPixel, 3.4);
            showTransient(
              { actorId: p.h.to, tone: dlg.replyTone, badge: dlg.replyBadge, text: dlg.replyText },
              3400,
              dlg.replyPixel
            );
            latest.current.onDelivered(p.h);
          }
          if (p.delivered && a?.state === 'seat') {
            pending.delete(key);
            latest.current.onDone(key);
          }
        }

        // Human Owner stroll arrival choreography: natural pause + 2-way agent chat or room reaction
        const stroll = ownerStrollRef.current;
        if (stroll) {
          const oa = s.get(stroll.ownerActorId);
          if (!oa || oa.state === 'seat' || oa.state === 'held') {
            if (stroll.replyTimer) clearTimeout(stroll.replyTimer);
            ownerStrollRef.current = null;
          } else if (!stroll.arrived && oa.state === 'errand') {
            stroll.arrived = true;
            oa.timer = Math.max(oa.timer, stroll.plan.staySecs);
            if (stroll.plan.type === 'visit-agent') {
              const visitPlan = stroll.plan;
              showTransient(
                { actorId: stroll.ownerActorId, tone: 'standup', badge: 'Ngobrol', text: visitPlan.ownerLine },
                3600,
                'dots'
              );
              stroll.replyTimer = setTimeout(() => {
                const targetAg = scene.current?.get(visitPlan.agent.agentId);
                if (!targetAg || targetAg.hidden) return;
                showTransient(
                  { actorId: visitPlan.agent.agentId, tone: 'approved', badge: 'Balas', text: visitPlan.agentReply },
                  3600,
                  'heart'
                );
              }, 1150);
            } else {
              const spotPlan = stroll.plan;
              showTransient(
                { actorId: stroll.ownerActorId, tone: spotPlan.spot.tone, badge: spotPlan.spot.badge, text: spotPlan.arriveLine },
                3800,
                spotPlan.spot.bubbleKind
              );
            }
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
      const visibility = () => { if (document.visibilityState === 'visible' && !reduced.matches && !latest.current.paused) s.start(); else { s.stop(); s.draw(); syncSpeechDOM(); } };
      visibility();
      document.addEventListener('visibilitychange', visibility);
      reduced.addEventListener('change', visibility);
      const clockTimer = setInterval(() => { if (!s.running && !document.hidden) s.draw(); }, 30000);
      // Human Owner natural life routine: first stroll ~8.5s after opening, then every ~19s!
      const ownerFirstStroll = setTimeout(() => { triggerOwnerStroll(); }, 8500);
      const ownerLifeTimer = setInterval(() => { triggerOwnerStroll(); }, 19000);
      let activitySeed = 1;
      const lifeTimer = setInterval(() => {
        if (document.hidden || latest.current.paused || latest.current.offDuty || !s.running) return;
        const isBreak = latest.current.lunch;
        const freeDesks = shownRef.current.filter(d => {
          const a = s.get(d.agentId);
          return a && !a.hidden && !a.busy && !a.huddleHold && !a.reviewHold && a.state === 'seat' && ['home', 'ready', 'break'].includes(d.state);
        });
        if (!freeDesks.length) return;

        // Track currently roaming agents & occupied destinations so the floor looks lively, never crowded.
        const roamingCount = shownRef.current.filter(d => {
          const a = s.get(d.agentId);
          return a && !a.hidden && !a.huddleHold && !a.reviewHold && (a.state === 'walk' || a.state === 'errand');
        }).length;
        const occupied = new Set<string>();
        for (const ag of s.agents) {
          if (ag.target && typeof ag.target.x === 'number') occupied.add(`${ag.target.x},${ag.target.y}`);
        }

        if (isBreak) {
          const { errands, nextSeed } = planLunchErrands({
            freeDesks,
            roamingCount,
            occupiedKeys: occupied,
            seed: activitySeed,
            isWalkable: (x, y) => !!s.walk[y]?.[x],
          });
          activitySeed = nextSeed;
          for (const item of errands) {
            const a = s.get(item.agentId);
            if (!a) continue;
            const path = s.path(a.x, a.y, item.spot.x, item.spot.y);
            if (!path || !path.length) continue;
            a.state = 'walk';
            a.path = path;
            a.then = 'errand';
            a.target = { x: item.spot.x, y: item.spot.y, face: item.spot.face, kind: 'coffee' };
            showTransient({ actorId: item.agentId, tone: 'coffee', badge: 'Istirahat', text: item.line }, 3600, item.spot.bubbleKind);
          }
          return;
        }

        const step = planWorkdayLifeStep({
          freeDesks,
          roamingCount,
          occupiedKeys: occupied,
          seed: activitySeed,
          isWalkable: (x, y) => !!s.walk[y]?.[x],
        });
        if (!step) return;
        activitySeed = step.nextSeed;

        if (step.kind === 'peer-chat') {
          const a = s.get(step.firstId);
          const b = s.get(step.secondId);
          if (!a || !b) return;
          const near = walkableAdjacentTiles(s.walk, b.x, b.y, a.x, a.y)[0];
          if (near) {
            const path = s.path(a.x, a.y, near[0], near[1]);
            if (path && path.length && path.length <= 18) {
              a.state = 'walk';
              a.path = path;
              a.then = 'errand';
              a.target = { x: near[0], y: near[1], face: 'down', kind: 'chat' };
            }
          }
          showTransient({ actorId: step.firstId, tone: 'standup', badge: 'Ngobrol', text: step.questionText }, 3200, 'dots');
          setTimeout(() => {
            showTransient({ actorId: step.secondId, tone: 'approved', badge: 'Ngobrol', text: step.replyText }, 3200, 'heart');
          }, 1350);
          return;
        }

        const actor = s.get(step.agentId);
        if (!actor) return;
        const path = s.path(actor.x, actor.y, step.spot.x, step.spot.y);
        if (!path || !path.length) return;
        actor.state = 'walk';
        actor.path = path;
        actor.then = 'errand';
        actor.target = { x: step.spot.x, y: step.spot.y, face: step.spot.face, kind: step.targetKind };
        showTransient({ actorId: step.agentId, tone: 'coffee', badge: step.spot.badge, text: step.line }, 3400, step.bubbleKind);
      }, 12000);
      cleanup = () => {
        s.stop();
        clearInterval(clockTimer);
        clearInterval(lifeTimer);
        clearTimeout(ownerFirstStroll);
        clearInterval(ownerLifeTimer);
        if (ownerStrollRef.current?.replyTimer) clearTimeout(ownerStrollRef.current.replyTimer);
        ownerStrollRef.current = null;
        document.removeEventListener('visibilitychange', visibility);
        reduced.removeEventListener('change', visibility);
        scene.current = null;
      };
    }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; cleanup(); };
    // Rebuild only when seats or appearances change, not on polling updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, humanIdentity]);

  // Pause 60fps canvas loop while a foreground modal/drawer is open so typing stays lag-free.
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (paused || reduced || document.visibilityState !== 'visible') {
      s.stop();
      s.draw();
    } else {
      s.start();
    }
  }, [paused, sceneReady]);

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
          <div
            className="delivery-letter"
            key={letter}
            aria-label="Message delivered"
            style={{
              '--letter-x': `${clampNum(((letterX + 1) / OFFICE_PLAN.cols) * 100, 6, 90)}%`,
              '--letter-y': `${clampNum(((letterY - 1) / OFFICE_PLAN.rows) * 100, 8, 90)}%`,
            } as React.CSSProperties}
          >
            ✉<small>Delivered</small>
          </div>
        )}

        {/* Live moving speech bubbles tracking characters across working, handover, and owner-desk review */}
        <div className="actor-speech-layer" aria-live="polite">
          {speechBubbles.map(item => {
            const suppressedByCard = hoverCard?.actorId === item.actorId;
            return (
              <button
                key={item.actorId}
                type="button"
                ref={el => {
                  if (el) speechElsRef.current.set(item.actorId, el);
                  else speechElsRef.current.delete(item.actorId);
                }}
                className={`actor-speech is-px-placed tone-${item.tone}${item.clickable ? ' is-clickable' : ''}${hoveredActorId === item.actorId && !suppressedByCard ? ' is-expanded' : ''}${suppressedByCard ? ' is-suppressed' : ''}`}
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
            );
          })}
        </div>

        {dragUI && (() => {
          const sw = stageRef.current?.clientWidth || size?.width || 768;
          const sh = stageRef.current?.clientHeight || size?.height || 448;
          const pillLeft = clampNum(dragUI.x, Math.min(110, sw / 2), Math.max(sw / 2, sw - 110));
          const pillTop = dragUI.y < 54 ? Math.min(sh - 34, dragUI.y + 22) : Math.max(10, dragUI.y - 44);
          return (
            <div
              className={`drag-pill drag-${dragUI.zone.kind}`}
              style={{ left: pillLeft, top: pillTop }}
              role="status"
            >
              {describeDropTarget(dragUI.name, dragUI.zone)}
            </div>
          );
        })()}
        <div className="reference-hotspots">
          {shown.map((d, i) => {
            const isTarget = dragUI?.zone.kind === 'desk' && dragUI.zone.agentId === d.agentId;
            const cardKey = `desk:${d.agentId}`;
            const openCard = (el: HTMLElement) =>
              showHoverCard({
                key: cardKey,
                actorId: d.agentId,
                anchorEl: el,
                title: d.name,
                badge: d.squad || undefined,
                detail: d.bubble,
                tip: 'Drag to hand off · Click to open',
              });
            return (
              <button
                key={d.agentId}
                className={`hs-seat hs-${d.state}${isTarget ? ' is-drop-target' : ''}`}
                style={seatBounds(agentSeats[i])}
                onPointerDown={e => {
                  if (e.button !== 0) return;
                  setHoverCard(null);
                  beginDrag(d, e.clientX, e.clientY);
                }}
                onMouseEnter={e => openCard(e.currentTarget)}
                onMouseLeave={() => hideHoverCard(cardKey)}
                onFocus={e => openCard(e.currentTarget)}
                onBlur={() => hideHoverCard(cardKey)}
                onClick={() => {
                  if (Date.now() - justDraggedRef.current < 260) return;
                  setHoverCard(null);
                  onDesk(d);
                }}
                aria-label={`${d.name}. ${d.squad}. ${d.bubble}. Drag onto another desk or room to hand off.`}
              />
            );
          })}
          {owner && (() => {
            const cardKey = `owner:${owner.id}`;
            const openCard = (el: HTMLElement) =>
              showHoverCard({
                key: cardKey,
                actorId: `person:${owner.id}`,
                anchorEl: el,
                title: owner.name,
                detail: 'Private office & approvals',
              });
            return (
              <button
                className={`hs-seat hs-human${dragUI?.zone.kind === 'human' && dragUI.zone.name === owner.name ? ' is-drop-target' : ''}`}
                style={seatBounds(OWNER_SEAT)}
                onMouseEnter={e => openCard(e.currentTarget)}
                onMouseLeave={() => hideHoverCard(cardKey)}
                onFocus={e => openCard(e.currentTarget)}
                onBlur={() => hideHoverCard(cardKey)}
                onClick={() => { setHoverCard(null); onHuman(owner.name); }}
                aria-label={`${owner.name}'s office`}
              />
            );
          })()}
          {coworkers.map((h, i) => {
            const cardKey = `human:${h.id}`;
            const openCard = (el: HTMLElement) =>
              showHoverCard({
                key: cardKey,
                actorId: `person:${h.id}`,
                anchorEl: el,
                title: h.name,
                detail: 'Human teammate',
              });
            return (
              <button
                className={`hs-seat human-hotspot hs-human${dragUI?.zone.kind === 'human' && dragUI.zone.name === h.name ? ' is-drop-target' : ''}`}
                key={h.id}
                style={seatBounds(coworkerSeats[i])}
                onMouseEnter={e => openCard(e.currentTarget)}
                onMouseLeave={() => hideHoverCard(cardKey)}
                onFocus={e => openCard(e.currentTarget)}
                onBlur={() => hideHoverCard(cardKey)}
                onClick={() => { setHoverCard(null); onHuman(h.name); }}
                aria-label={`${h.name}'s desk`}
              />
            );
          })}
          {FLOOR_PROPS.map(prop => {
            const isTarget = dragUI?.zone.kind === prop.kind;
            const copy = floorPropLabel(floorTheme, prop.kind);
            const cardKey = `prop:${prop.kind}`;
            const openCard = (el: HTMLElement) =>
              showHoverCard({
                key: cardKey,
                anchorEl: el,
                title: copy.title,
                detail: copy.hint,
              });
            return (
              <button
                key={prop.kind}
                className={`hs-seat hs-prop hs-${prop.kind}${isTarget ? ' is-drop-target' : ''}`}
                style={tileRectBounds(prop)}
                onMouseEnter={e => openCard(e.currentTarget)}
                onMouseLeave={() => hideHoverCard(cardKey)}
                onFocus={e => openCard(e.currentTarget)}
                onBlur={() => hideHoverCard(cardKey)}
                onClick={() => { setHoverCard(null); if (prop.kind === 'meeting') onMeeting(); else onPropClick?.(prop.kind); }}
                aria-label={`${copy.title}: ${copy.hint}`}
              />
            );
          })}
        </div>
      </div>
      {typeof document !== 'undefined' && hoverCard && !paused && !dragUI && createPortal(
        <div
          ref={hoverCardRef}
          role="tooltip"
          className={`office-hovercard${hoverCardPos?.below ? ' is-below' : ''}${floorTheme === 'harvest' ? ' is-harvest' : ''}`}
          style={hoverCardPos ? {
            left: `${hoverCardPos.left}px`,
            top: `${hoverCardPos.top}px`,
            visibility: 'visible',
            '--arrow-x': `${hoverCardPos.arrowX}px`,
          } as React.CSSProperties : {
            left: '0px',
            top: '0px',
            visibility: 'hidden',
          }}
        >
          <strong className="hs-name">{hoverCard.title}</strong>
          {hoverCard.badge && <em className="hs-meta">{hoverCard.badge}</em>}
          <small>{hoverCard.detail}</small>
          {hoverCard.tip && <small className="hs-tip">{hoverCard.tip}</small>}
        </div>,
        document.body
      )}
      {pages > 1 && <div className="floor-pages"><button disabled={!currentPage} onClick={() => setPage(p => p - 1)}>←</button> Agents {currentPage + 1}/{pages} <button disabled={currentPage === pages - 1} onClick={() => setPage(p => p + 1)}>→</button></div>}
      {officePhase !== 'working' && (
        <span className={`lunch-sign phase-${officePhase}`}>
          {phaseLabel || (lunch ? 'Jam istirahat · 12:00–13:15' : 'Di luar jam kerja · 08:00–17:30')}
        </span>
      )}
    </div>
  );
});

export default ReferenceOffice;
