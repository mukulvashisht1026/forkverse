import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSpineLayout,
  computeFitView,
  createRng,
  hitTestWorld,
  NODE_GAP,
  resolveBranchVerticalDir,
  screenToWorld,
} from './treeMath';
import type { SpineNode } from '../types/tree';

const TEST_SPINE: SpineNode[] = [
  {
    id: 'test-node-1',
    name: 'Tariff Declaration',
    declaration: 'Proposed 25% import tariffs.',
    info: 'Market and social reaction.',
    platform: 'X',
    scrapeEngine: 'exa',
    stockImpact: { summary: 'Mixed industrials', tickers: [] },
    publicAppeal: {
      sentimentLabel: 'Divided',
      positivePct: 45,
      neutralPct: 20,
      negativePct: 35,
      narrative: 'Active debate across platforms.',
    },
    branches: [
      {
        id: 'br-1',
        name: 'Reuters · Auto Shock',
        info: 'Supplier impact report.',
        sourceType: 'market',
        growthSide: 'top',
        seed: 134,
        _prog: 1,
      },
      {
        id: 'br-2',
        name: 'X · Public Thread',
        info: 'Social sentiment response.',
        sourceType: 'social',
        growthSide: 'bottom',
        seed: 151,
        _prog: 1,
      },
      {
        id: 'br-3',
        name: 'Bloomberg · Yields',
        info: 'Treasury yield shift.',
        sourceType: 'news',
        growthSide: 'top',
        seed: 168,
        _prog: 1,
      },
      {
        id: 'br-4',
        name: 'Reddit · Consumer Pulse',
        info: 'Price concern threads.',
        sourceType: 'social',
        growthSide: 'bottom',
        seed: 185,
        _prog: 1,
      },
    ],
  },
  {
    id: 'test-node-2',
    name: 'Energy Permits',
    declaration: 'Fast-track LNG approvals.',
    info: 'Energy equities rallied.',
    platform: 'X',
    scrapeEngine: 'context.dev',
    stockImpact: { summary: 'Energy higher', tickers: [] },
    publicAppeal: {
      sentimentLabel: 'Net Positive',
      positivePct: 52,
      neutralPct: 20,
      negativePct: 28,
      narrative: 'Fuel cost optimism.',
    },
    branches: [
      {
        id: 'br-5',
        name: 'WSJ · LNG Lift',
        info: 'Export terminal rally.',
        sourceType: 'market',
        growthSide: 'top',
        seed: 265,
        _prog: 1,
      },
      {
        id: 'br-6',
        name: 'X · Fuel Sentiment',
        info: 'Household cost reactions.',
        sourceType: 'social',
        growthSide: 'bottom',
        seed: 299,
        _prog: 1,
      },
    ],
  },
];

test('createRng produces deterministic sequences for identical seeds', () => {
  const r1 = createRng(1337);
  const r2 = createRng(1337);
  const seq1 = [r1(), r1(), r1(), r1()];
  const seq2 = [r2(), r2(), r2(), r2()];
  assert.deepEqual(seq1, seq2);
  assert.ok(seq1.every((v) => v >= 0 && v < 1));
});

test('buildSpineLayout places branches both above and below the main spine', () => {
  const layout = buildSpineLayout(TEST_SPINE);
  assert.equal(layout.groups.length, TEST_SPINE.length);

  layout.groups.forEach((group, idx) => {
    assert.equal(group.x, idx * NODE_GAP);
    assert.equal(group.orbs.length, TEST_SPINE[idx].branches.length);
    assert.ok(group.lensDots.length > 0);

    const hasTop = group.orbs.some((o) => o.verticalDir === -1 && o.y < -30);
    const hasBottom = group.orbs.some((o) => o.verticalDir === 1 && o.y > 30);
    assert.ok(hasTop, `Group ${idx} should have upward canopy branches`);
    assert.ok(hasBottom, `Group ${idx} should have downward root branches`);

    for (const vDir of [-1, 1] as const) {
      for (const hSide of [-1, 1] as const) {
        const quadOrbs = group.orbs
          .filter((o) => o.verticalDir === vDir && o.lean === hSide)
          .sort((a, b) => a.ty - b.ty);
        for (let i = 1; i < quadOrbs.length; i++) {
          assert.ok(
            Math.abs(quadOrbs[i].ty - quadOrbs[i - 1].ty) >= 22,
            'Expected branch labels in same quadrant to stay vertically separated'
          );
        }
      }
    }
  });

  assert.ok(layout.starParts.length > 0);
  assert.ok(layout.groundParts.length > 0);
  assert.ok(layout.bounds.y0 < -150);
  assert.ok(layout.bounds.y1 > 180);
});

test('resolveBranchVerticalDir balances all-news branches across top and bottom', () => {
  const branches = [
    { id: '1', name: 'A', info: '', sourceType: 'news' as const, seed: 1 },
    { id: '2', name: 'B', info: '', sourceType: 'news' as const, seed: 2 },
  ];
  assert.equal(resolveBranchVerticalDir(branches[0], 0, branches), -1);
  assert.equal(resolveBranchVerticalDir(branches[1], 1, branches), 1);
});

test('hitTestWorld detects main spine nodes and completed branch orbs', () => {
  const layout = buildSpineLayout(TEST_SPINE);
  const firstGroup = layout.groups[0];
  const hitMain = hitTestWorld(firstGroup.x + 10, 5, layout.groups);
  assert.deepEqual(hitMain, { i: 0 });

  const firstOrb = firstGroup.orbs[0];
  const hitOrb = hitTestWorld(firstOrb.x + 2, firstOrb.y - 2, layout.groups);
  assert.deepEqual(hitOrb, { i: 0, j: 0 });

  const bottomOrb = firstGroup.orbs.find((o) => o.verticalDir === 1);
  assert.ok(bottomOrb);
  const hitBottom = hitTestWorld(bottomOrb.x, bottomOrb.y, layout.groups);
  assert.deepEqual(hitBottom, { i: 0, j: bottomOrb.j });

  const miss = hitTestWorld(-5000, -5000, layout.groups);
  assert.equal(miss, null);
});

test('screenToWorld and computeFitView invert coordinates cleanly', () => {
  const layout = buildSpineLayout(TEST_SPINE);
  const view = computeFitView(layout.bounds, 1440, 900);
  assert.ok(view.k > 0 && view.k <= 1.2);
  const [wx, wy] = screenToWorld(view.x + NODE_GAP * view.k, view.y, view);
  assert.ok(Math.abs(wx - NODE_GAP) < 1e-6);
  assert.ok(Math.abs(wy) < 1e-6);
});
