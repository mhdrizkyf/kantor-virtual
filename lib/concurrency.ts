/**
 * Run an async mapper over `items` with bounded concurrency so large teams (20+ agents,
 * hundreds of tasks) never flood Multica API or Node's HTTP socket pool.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!items.length) return [];
  const cap = Math.max(1, Math.min(items.length, Math.floor(limit) || 1));
  const out = new Array<R>(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      out[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: cap }, () => run()));
  return out;
}
