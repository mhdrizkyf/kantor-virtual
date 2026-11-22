import plan from './office-floor-plan.json';
export const OFFICE_PLAN = plan;
export const OWNER_SEAT = 8;
export const COWORKER_SEATS = [9, 10, 11, 12, 13];
export const SHARED_SEATS = plan.desks.map((_,i)=>i).filter(i=>i!==OWNER_SEAT);
export function floorSeats(humanCount: number) {
  const coworkerSeats = COWORKER_SEATS.slice(0, Math.max(0, Math.min(5, humanCount - 1)));
  return { coworkerSeats, agentSeats: SHARED_SEATS.filter(seat => !coworkerSeats.includes(seat)) };
}
export function seatBounds(seat: number) {
  const d = plan.desks[seat];
  return {left:`${d.x/plan.cols*100}%`,top:`${(d.y-(d.seat==='s'?.35:1.8))/plan.rows*100}%`,width:`${2/plan.cols*100}%`,height:`${2.4/plan.rows*100}%`};
}
