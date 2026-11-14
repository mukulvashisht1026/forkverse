/**
 * "Added by live tracking" marks for graph items (timeline nodes, claims, evidence branches).
 * An id is FRESH right after a live monitor added it (strong pulse + regrowth), then RECENT
 * (quiet "LIVE UPDATE" badge) until it expires.
 */
export type LiveMark = 'fresh' | 'recent';

export const FRESH_MS = 45_000;
export const RECENT_MS = 15 * 60_000;

/** Record ids as added now (keeps the earlier time if an id was already marked). */
export function addLiveIds(prev: ReadonlyMap<string, number>, ids: Iterable<string>, now: number): Map<string, number> {
  const next = new Map(prev);
  for (const id of ids) if (id && !next.has(id)) next.set(id, now);
  return next;
}

/** Current mark per id; expired ids are left out. */
export function liveMarksAt(added: ReadonlyMap<string, number>, now: number): Map<string, LiveMark> {
  const marks = new Map<string, LiveMark>();
  for (const [id, at] of added) {
    const age = now - at;
    if (age < FRESH_MS) marks.set(id, 'fresh');
    else if (age < RECENT_MS) marks.set(id, 'recent');
  }
  return marks;
}

/** Drop ids older than RECENT_MS (keeps the map small). */
export function pruneLiveIds(added: ReadonlyMap<string, number>, now: number): Map<string, number> {
  return new Map([...added].filter(([, at]) => now - at < RECENT_MS));
}
