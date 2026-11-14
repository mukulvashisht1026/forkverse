import type { BranchNode, FocusTarget, SpineNode } from '../types/tree';

export const SPINE_PALETTE = [
  '#ff9a4d',
  '#e8682c',
  '#3fc1c9',
  '#5b8def',
  '#9fd8ff',
  '#f3e6c4',
] as const;

export const TOP_CANOPY_PALETTE = [
  '#ff9a4d',
  '#e8682c',
  '#f3e6c4',
  '#9fd8ff',
] as const;

export const BOTTOM_ROOT_PALETTE = [
  '#3fc1c9',
  '#5b8def',
  '#9fd8ff',
  '#7ee8fa',
] as const;

export const LENS_PALETTE = [
  '#c9c36a',
  '#8fa04a',
  '#e6dd9a',
  '#5f7a3a',
  '#f3e6c4',
] as const;

export const NODE_GAP = 340;
export const FALL_DISTANCE = 190;

export interface Particle {
  x: number;
  y: number;
  s: number;
  r: number;
  c: string;
  d?: number;
  br?: BranchOrb;
  fall?: number;
  ph?: number;
}

export interface LensDot {
  x: number;
  y: number;
  r: number;
  c: string;
  s: number;
}

export interface BranchOrb {
  j: number;
  b: BranchNode;
  verticalDir: -1 | 1;
  limb: Array<[number, number, number]>;
  maxD: number;
  minY: number;
  maxY: number;
  minX: number;
  maxX: number;
  x: number;
  y: number;
  lean: 1 | -1;
  tx: number;
  ty: number;
  dur: number;
  hot: number;
  prog: number;
  reach: number;
  pulsePhase: number;
}

export interface LayoutGroup {
  i: number;
  x: number;
  dim: number;
  hot: number;
  parts: Particle[];
  orbs: BranchOrb[];
  lensDots: LensDot[];
}

export interface TreeBounds {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface ViewTransform {
  k: number;
  x: number;
  y: number;
}

export interface SpineLayout {
  starParts: Particle[];
  groundParts: Particle[];
  groups: LayoutGroup[];
  bounds: TreeBounds;
}

export function createRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: readonly T[], r: () => number): T {
  return arr[(r() * arr.length) | 0];
}

export function resolveBranchVerticalDir(
  branch: BranchNode,
  j: number,
  allBranches: BranchNode[]
): -1 | 1 {
  if (branch.growthSide === 'top') return -1;
  if (branch.growthSide === 'bottom') return 1;

  // Prefer social/public branches below the spine and market/news/policy above,
  // while guaranteeing balanced dual-side growth when a node has >= 2 branches.
  const preferred: -1 | 1 =
    branch.sourceType === 'social' || branch.sourceType === 'manual' ? 1 : -1;

  if (allBranches.length >= 2) {
    const allSame = allBranches.every(
      (b) =>
        (b.growthSide === 'top'
          ? -1
          : b.growthSide === 'bottom'
            ? 1
            : b.sourceType === 'social' || b.sourceType === 'manual'
              ? 1
              : -1) === preferred
    );
    if (allSame) {
      return j % 2 === 0 ? -1 : 1;
    }
  }
  return preferred;
}

export function growBranchGeometry(
  cx: number,
  side: 1 | -1,
  verticalDir: -1 | 1,
  k: number,
  seed: number,
  branch: BranchNode,
  j: number
): { orb: BranchOrb; particles: Particle[] } {
  const r = createRng(seed);
  const startY = verticalDir * 32;
  const targetAngle = verticalDir * (Math.PI / 2);

  // Give downward branches slightly wider horizontal clearance so they curve around the main node label
  const minLean = verticalDir === 1 ? 0.3 : 0.2;
  const leanMagnitude = minLean + (k % 3) * 0.25 + r() * 0.25;
  const signedLean =
    verticalDir === -1 ? side * leanMagnitude : -side * leanMagnitude;

  const tr = {
    len: 130 + k * 42 + r() * 105,
    curl: 0.04 + r() * 0.17,
    spread: 0.38 + r() * 0.72,
    fork: 0.014 + r() * 0.026,
    pull: 0.012 + r() * 0.042,
    lean: signedLean,
  };

  const palette =
    verticalDir === -1 ? TOP_CANOPY_PALETTE : BOTTOM_ROOT_PALETTE;

  const particles: Particle[] = [];
  const orb: BranchOrb = {
    j,
    b: branch,
    verticalDir,
    limb: [],
    maxD: 0,
    minY: startY,
    maxY: startY,
    minX: cx,
    maxX: cx,
    x: cx,
    y: startY,
    lean: side,
    tx: cx,
    ty: startY,
    dur: 1.8,
    hot: 0,
    prog: branch._prog ?? 1,
    reach: 0,
    pulsePhase: r(),
  };

  function walk(
    x: number,
    y: number,
    ang: number,
    len: number,
    d: number,
    depth: number
  ) {
    const step = 5;
    const n = Math.max(3, (len / step) | 0);
    for (let s = 0; s < n; s++) {
      ang += (r() - 0.5) * 2 * tr.curl + (targetAngle - ang) * tr.pull;
      x += Math.cos(ang) * step;
      y += Math.sin(ang) * step;
      d += step;
      if (depth === 0) orb.limb.push([x, y, d]);
      orb.maxD = Math.max(orb.maxD, d);
      orb.minY = Math.min(orb.minY, y);
      orb.maxY = Math.max(orb.maxY, y);
      orb.minX = Math.min(orb.minX, x);
      orb.maxX = Math.max(orb.maxX, x);

      const cnt = depth === 0 ? 5 : depth === 1 ? 3 : 2;
      const sp = Math.max(1.5, 7 - depth * 2 - (s / n) * 3);
      for (let q = 0; q < cnt; q++) {
        particles.push({
          x: x + (r() - 0.5) * sp,
          y: y + (r() - 0.5) * sp,
          s: r() * 6.28,
          r: (0.45 + r() * 1.15) * (1 - depth * 0.15),
          c: pick(palette, r),
          d: d + r() * 4,
          br: orb,
        });
      }
      if (depth < 3 && s > 2 && r() < tr.fork * (depth === 0 ? 1.6 : 1)) {
        walk(
          x,
          y,
          ang + (r() < 0.5 ? -1 : 1) * tr.spread * (0.5 + r()),
          (n - s) * step * (0.35 + r() * 0.4),
          d,
          depth + 1
        );
      }
    }
  }

  walk(cx, startY, targetAngle + tr.lean, tr.len, 0, 0);
  const tip = orb.limb[orb.limb.length - 1] ?? [cx, startY + verticalDir * 95, 95];
  orb.x = tip[0];
  orb.y = tip[1];
  orb.lean = orb.x >= cx ? 1 : -1;
  orb.tx = orb.x + orb.lean * 16;
  orb.ty = orb.y + 4;
  orb.dur = Math.max(1.8, orb.maxD / 110);
  orb.reach = (1 - Math.pow(1 - orb.prog, 3)) * orb.maxD;

  return { orb, particles };
}

export function buildSpineLayout(spine: SpineNode[]): SpineLayout {
  const n = Math.max(1, spine.length);
  const r0 = createRng(7);
  const width = (n - 1) * NODE_GAP;
  let minY = -150;
  let maxY = 150;
  let bx0 = -180;
  let bx1 = width + 180;

  // Ambient deep-field starlight dust
  const starParts: Particle[] = [];
  for (let i = 0; i < n * 48; i++) {
    starParts.push({
      x: -420 + r0() * (width + 840),
      y: -360 + r0() * 720,
      s: r0() * 6.28,
      r: 0.4 + r0() * 0.9,
      c: r0() > 0.5 ? '#9fd8ff' : '#cfd8ea',
    });
  }

  // Horizontal spine baseline stream
  const groundParts: Particle[] = [];
  const groundCount = n * 500;
  for (let i = 0; i < groundCount; i++) {
    groundParts.push({
      x: -140 + r0() * (width + 280),
      y: (r0() - 0.5) * 9,
      s: r0() * 6.28,
      r: 0.5 + r0() * 1.4,
      c: pick(SPINE_PALETTE, r0),
    });
  }
  for (let i = 0; i < n * 70; i++) {
    groundParts.push({
      x: -140 + r0() * (width + 280),
      y: 8,
      s: r0() * 6.28,
      r: 0.45 + r0() * 1.0,
      c: pick(SPINE_PALETTE, r0),
      fall: 0.14 + r0() * 0.42,
      ph: r0(),
    });
  }

  const groups: LayoutGroup[] = spine.map((m, i) => {
    const cx = i * NODE_GAP;
    const grp: LayoutGroup = {
      i,
      x: cx,
      dim: 1,
      hot: 1,
      parts: [],
      orbs: [],
      lensDots: [],
    };

    const branches = m.branches || [];
    let topCount = 0;
    let bottomCount = 0;

    branches.forEach((b, j) => {
      const seed = b.seed ?? i * 131 + j * 17 + 3;
      const verticalDir = resolveBranchVerticalDir(b, j, branches);
      const sideIndex = verticalDir === -1 ? topCount++ : bottomCount++;
      const side: 1 | -1 = sideIndex % 2 === 0 ? -1 : 1;
      const k = Math.floor(sideIndex / 2);

      const { orb, particles } = growBranchGeometry(
        cx,
        side,
        verticalDir,
        k,
        seed,
        b,
        j
      );
      // Freshly appended branches grow into the graph; loaded branches stay settled.
      if (b._animateGrowth && b._prog === undefined) {
        b._prog = 0;
      }
      orb.prog = b._prog ?? 1;
      orb.reach = (1 - Math.pow(1 - orb.prog, 3)) * orb.maxD;
      minY = Math.min(minY, orb.minY - 40);
      maxY = Math.max(maxY, orb.maxY + 40);
      bx0 = Math.min(bx0, orb.minX - 160);
      bx1 = Math.max(bx1, orb.maxX + 160);
      grp.parts.push(...particles);
      grp.orbs.push(orb);
    });

    // De-overlap branch tip labels within each quadrant (top-left, top-right, bottom-left, bottom-right)
    for (const vDir of [-1, 1] as const) {
      for (const hSide of [-1, 1] as const) {
        const quadOrbs = grp.orbs
          .filter((o) => o.verticalDir === vDir && o.lean === hSide)
          .sort((a, b) => a.ty - b.ty);
        for (let idx = 1; idx < quadOrbs.length; idx++) {
          const prev = quadOrbs[idx - 1];
          const curr = quadOrbs[idx];
          if (Math.abs(curr.ty - prev.ty) < 22) {
            curr.ty = prev.ty + 22;
          }
        }
      }
      // Keep downward branch labels clear of the centered main node title near y=58
      if (vDir === 1) {
        for (const o of grp.orbs) {
          if (o.verticalDir === 1 && o.ty < 88 && Math.abs(o.x - cx) < 110) {
            o.ty = 92;
          }
        }
      }
    }

    const r = createRng(i * 53 + 11);
    for (let q = 0; q < 110; q++) {
      const a = r() * 6.283;
      const rad = Math.sqrt(r()) * 25;
      grp.lensDots.push({
        x: Math.cos(a) * rad,
        y: Math.sin(a) * rad,
        r: 0.5 + r() * 1.2,
        c: pick(LENS_PALETTE, r),
        s: r() * 6.28,
      });
    }
    return grp;
  });

  return {
    starParts,
    groundParts,
    groups,
    bounds: {
      x0: bx0,
      x1: bx1,
      y0: minY - 30,
      y1: Math.max(FALL_DISTANCE + 40, maxY + 40),
    },
  };
}

export function screenToWorld(
  px: number,
  py: number,
  view: ViewTransform
): [number, number] {
  return [(px - view.x) / view.k, (py - view.y) / view.k];
}

export function hitTestWorld(
  wx: number,
  wy: number,
  groups: LayoutGroup[]
): FocusTarget | null {
  let best: FocusTarget | null = null;
  let bestDist = Infinity;

  for (const g of groups) {
    const dMain = Math.hypot(wx - g.x, wy);
    if (dMain < 40 && dMain < bestDist) {
      bestDist = dMain;
      best = { i: g.i };
    }
    for (const o of g.orbs) {
      if (o.prog < 1) continue;
      const dOrb = Math.hypot(wx - o.x, wy - o.y);
      if (dOrb < 24 && dOrb < bestDist) {
        bestDist = dOrb;
        best = { i: g.i, j: o.j };
      }
    }
  }
  return best;
}

export function computeFitView(
  bounds: TreeBounds,
  cw: number,
  ch: number
): ViewTransform {
  const safeW = Math.max(1, bounds.x1 - bounds.x0);
  const safeH = Math.max(1, bounds.y1 - bounds.y0);
  const padW = Math.max(200, cw - 120);
  const padH = Math.max(200, ch - 140);
  const k = Math.min(1.15, Math.min(padW / safeW, padH / safeH));
  return {
    k,
    x: cw / 2 - (bounds.x0 + safeW / 2) * k,
    y: ch / 2 - (bounds.y0 + safeH / 2) * k,
  };
}
