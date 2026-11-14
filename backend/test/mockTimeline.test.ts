import { describe, expect, it, vi } from 'vitest';
import type { RealtimeHub } from '../src/realtime/hub.js';
import { applyMockStep, MOCK_LIVE_STEPS, MOCK_NODES, seedMockTimeline } from '../src/timeline/mock.js';
import { MemoryTimelineStore } from '../src/timeline/store.js';

describe('mock timeline', () => {
  it('seeds the demo nodes with branches, marked as demo data', async () => {
    const store = new MemoryTimelineStore();
    await seedMockTimeline(store);
    const snap = await store.getSnapshot();
    expect(snap.nodes.map((n) => n.id)).toEqual(MOCK_NODES.map((n) => n.id));
    expect(snap.nodes.every((n) => n.scrapeEngine === 'seed' && n.platform.startsWith('Demo data'))).toBe(true);
    expect(snap.nodes.every((n) => n.branches.every((b) => b.seed > 0 && b.growthSide))).toBe(true);
    // No mock item links to a real article.
    expect(JSON.stringify(snap)).not.toContain('sourceUrl');
  });

  it('replays every live step in order and broadcasts each one', async () => {
    const store = new MemoryTimelineStore();
    await seedMockTimeline(store);
    const broadcast = vi.fn();
    const hub = { broadcast } as unknown as RealtimeHub;

    for (const step of MOCK_LIVE_STEPS) await applyMockStep(store, hub, step);

    expect(broadcast).toHaveBeenCalledTimes(MOCK_LIVE_STEPS.length);
    expect(broadcast.mock.calls.map(([e]) => e.type)).toEqual(
      MOCK_LIVE_STEPS.map((s) => (s.kind === 'node' ? 'node:created' : 'branch:created')),
    );
    const snap = await store.getSnapshot();
    const branchCount = snap.nodes.reduce((n, x) => n + x.branches.length, 0);
    const seeded = MOCK_NODES.reduce((n, x) => n + (x.branches?.length ?? 0), 0);
    const added = MOCK_LIVE_STEPS.filter((s) => s.kind === 'branch').length;
    expect(snap.nodes).toHaveLength(MOCK_NODES.length + 1);
    expect(branchCount).toBe(seeded + added);
  });
});
