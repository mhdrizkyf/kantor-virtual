// Pure 4-directional grid pathfinder & neighbor selection for any tile-based office floor plan.
export type WalkGrid = readonly (readonly (boolean | number)[])[];
export type GridPoint = [number, number];

const DIRS: readonly GridPoint[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function isTileWalkable(grid: WalkGrid, x: number, y: number): boolean {
  return y >= 0 && y < grid.length && x >= 0 && x < (grid[y]?.length ?? 0) && Boolean(grid[y][x]);
}

/** Breadth-first shortest tile path from (sx, sy) to (gx, gy), returning steps excluding start tile. */
export function findShortestPath(
  grid: WalkGrid,
  sx: number,
  sy: number,
  gx: number,
  gy: number
): GridPoint[] | null {
  if (sx === gx && sy === gy) return [];
  if (!isTileWalkable(grid, gx, gy)) return null;
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  if (!rows || !cols) return null;

  const visited = new Uint8Array(rows * cols);
  const parent = new Int32Array(rows * cols).fill(-1);
  const queue = new Int32Array(rows * cols);
  let head = 0;
  let tail = 0;

  const startIdx = sy * cols + sx;
  const goalIdx = gy * cols + gx;
  if (startIdx < 0 || startIdx >= visited.length || goalIdx < 0 || goalIdx >= visited.length) return null;

  visited[startIdx] = 1;
  queue[tail++] = startIdx;

  while (head < tail) {
    const cur = queue[head++];
    if (cur === goalIdx) {
      const path: GridPoint[] = [];
      let p = cur;
      while (p !== startIdx && p !== -1) {
        path.push([p % cols, Math.floor(p / cols)]);
        p = parent[p];
      }
      path.reverse();
      return path;
    }
    const cx = cur % cols;
    const cy = Math.floor(cur / cols);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isTileWalkable(grid, nx, ny)) continue;
      const nIdx = ny * cols + nx;
      if (visited[nIdx]) continue;
      visited[nIdx] = 1;
      parent[nIdx] = cur;
      queue[tail++] = nIdx;
    }
  }
  return null;
}

/** Find walkable 4-neighbor tiles around (tx, ty) ordered by proximity to (fromX, fromY). */
export function walkableAdjacentTiles(
  grid: WalkGrid,
  tx: number,
  ty: number,
  fromX?: number,
  fromY?: number
): GridPoint[] {
  const candidates: GridPoint[] = [
    [tx - 1, ty],
    [tx + 1, ty],
    [tx, ty + 1],
    [tx, ty - 1],
  ].filter(([x, y]) => isTileWalkable(grid, x, y)) as GridPoint[];
  if (fromX !== undefined && fromY !== undefined) {
    candidates.sort(
      (a, b) =>
        Math.abs(a[0] - fromX) + Math.abs(a[1] - fromY) - (Math.abs(b[0] - fromX) + Math.abs(b[1] - fromY))
    );
  }
  return candidates;
}
