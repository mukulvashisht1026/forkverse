import {
  BoundingBox,
  BranchGeometry,
  FilamentStrand,
  ParticleDot,
  Point2D,
  SynapseArc,
  ViewTransform,
  WaveformTick,
} from '../types/tree';

export const SPINE_GAP = 340;
/** Timeline layout: articles sprout from the line after their event, one origin every ORIGIN_STEP px. */
export const ORIGIN_STEP = 26;
/** Space between an event node and its first article origin. */
export const SEGMENT_PAD = 64;
/** Room after the last origin so its forward-leaning branch clears the next event node. */
const SEGMENT_TAIL = 120;

export interface SpineLayout {
  /** x of each event node on the line. */
  nodeX: number[];
  /** x of the first article origin of each event. */
  originStart: number[];
  /** x where the drawn line should end (after the last event's articles). */
  end: number;
}

/** Event nodes spaced so each one's articles fit along the line between it and the next node. */
export function computeSpineLayout(branchCounts: number[]): SpineLayout {
  const nodeX: number[] = [];
  const originStart: number[] = [];
  let x = 0;
  for (let i = 0; i < branchCounts.length; i++) {
    nodeX.push(x);
    originStart.push(x + SEGMENT_PAD);
    const n = branchCounts[i] ?? 0;
    const segment = n ? SEGMENT_PAD + (n - 1) * ORIGIN_STEP + SEGMENT_TAIL : 0;
    x += Math.max(SPINE_GAP, segment);
  }
  const last = branchCounts.length - 1;
  const lastSegment = last >= 0 && branchCounts[last] ? SEGMENT_PAD + (branchCounts[last]! - 1) * ORIGIN_STEP + 40 : 0;
  return { nodeX, originStart, end: last >= 0 ? nodeX[last]! + lastSegment : 0 };
}

/**
 * Chronological rank per branch (original index -> position on the line): dated items sorted by
 * date ascending, undated items after them in their original order.
 */
export function branchOrder(dates: Array<string | undefined>): number[] {
  const keyed = dates.map((d, i) => ({ i, t: d ? Date.parse(d) : NaN }));
  const dated = keyed.filter((k) => Number.isFinite(k.t)).sort((a, b) => a.t - b.t || a.i - b.i);
  const undated = keyed.filter((k) => !Number.isFinite(k.t));
  const rank = new Array<number>(dates.length);
  [...dated, ...undated].forEach((k, pos) => { rank[k.i] = pos; });
  return rank;
}

/** Short date label for a timeline tick, e.g. "3 Feb 25"; null when the date is missing/invalid. */
export function tickLabel(date?: string): string | null {
  if (!date) return null;
  const t = new Date(date);
  if (Number.isNaN(t.getTime())) return null;
  return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
}

/** Fixed-camera projection for the tree's shallow, deterministic world depth. */
export function projectTreePoint(x: number, y: number, z: number): Point2D {
  const perspective = Math.max(0.78, Math.min(1.08, 1 - z / 1400));
  return {
    x: Number(((x + z * 0.32) * perspective).toFixed(2)),
    y: Number(((y - z * 0.42) * perspective).toFixed(2)),
  };
}

export function treeDepthScale(z: number): number {
  return Math.max(0.88, Math.min(1.12, 1 - z / 1400));
}

/**
 * Curated retro-tech accent palette blending Tree Map's archival brass/parchment
 * with Living Tree's deep nocturnal ember, teal, and slate tones, plus phosphor verdigris.
 */
export const NODE_ACCENTS = [
  '#D1BD91', // Aged Brass
  '#E08243', // Nixie Amber
  '#52A8A1', // Vintage CRT Verdigris
  '#7094C4', // Blueprint Slate
  '#A8935F', // Sorrell Bronze
];

export const LIVING_PARTICLE_PALETTE = [
  '#ff9a4d',
  '#e07b39',
  '#4ca8a1',
  '#7094c4',
  '#d1bd91',
  '#e9dfc4',
];

export const LENS_TEXTURE_PALETTE = [
  '#c9c36a',
  '#8fa04a',
  '#d1bd91',
  '#5f7a3a',
  '#e6dd9a',
];

const PHOSPHOR_VERDIGRIS = '#5fc2b4';

export function createRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function smoothSvgPath(points: Point2D[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  }

  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2;
    const my = (points[i].y + points[i + 1].y) / 2;
    d += ` Q${points[i].x.toFixed(1)},${points[i].y.toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  const last = points[points.length - 1];
  return `${d} L${last.x.toFixed(1)},${last.y.toFixed(1)}`;
}

/**
 * Generates radiating neural/synaptic tangent filaments and delicate micro-dendrites
 * around a branch, inspired by interconnected knowledge-graph scans in a restrained retro palette.
 */
export function generateBranchFilaments(
  cx: number,
  points: Point2D[],
  dir: 1 | -1,
  seed: number,
  accentColor: string
): FilamentStrand[] {
  if (points.length < 4) return [];
  const r = createRng(seed + 911);
  const strands: FilamentStrand[] = [];

  // 1. Crystalline tangent chords fanning from spine axis anchors to inflection points on the branch
  const chordCount = 7;
  for (let i = 0; i < chordCount; i++) {
    const t = 0.22 + (i / (chordCount - 1)) * 0.78;
    const targetIdx = Math.min(
      points.length - 1,
      Math.max(1, Math.floor(t * (points.length - 1)))
    );
    const target = points[targetIdx];

    // Anchor along the spine axis near cx (spreading forward and slightly back for symmetry)
    const anchorX = cx + (i - 1.5) * 26 + (r() - 0.5) * 14;
    const anchorY = dir * (4 + r() * 8);
    const ctrlX = (anchorX + target.x) * 0.5 + (r() - 0.5) * 18;
    const ctrlY = anchorY * 0.35 + target.y * 0.48;

    const useVerdigris = i % 3 === 1;
    strands.push({
      pathD: `M${anchorX.toFixed(1)},${anchorY.toFixed(1)} Q${ctrlX.toFixed(1)},${ctrlY.toFixed(1)} ${target.x.toFixed(1)},${target.y.toFixed(1)}`,
      opacity: Number((0.18 + r() * 0.16).toFixed(2)),
      width: Number((0.65 + r() * 0.35).toFixed(2)),
      color: useVerdigris ? PHOSPHOR_VERDIGRIS : accentColor,
    });
  }

  // 2. Delicate secondary micro-dendrites sprouting forward from the branch body
  const dendriteCount = 3;
  for (let i = 0; i < dendriteCount; i++) {
    const frac = 0.35 + i * 0.22 + r() * 0.08;
    const idx = Math.min(points.length - 2, Math.floor(frac * (points.length - 1)));
    const origin = points[idx];
    const next = points[idx + 1];
    const baseAngle = Math.atan2(next.y - origin.y, next.x - origin.x);
    const offsetAngle = (i % 2 === 0 ? 1 : -1) * (0.42 + r() * 0.36);
    const angle = baseAngle + offsetAngle;
    const len = 28 + r() * 34;

    const endX = origin.x + Math.cos(angle) * len;
    const endY = origin.y + Math.sin(angle) * len;
    const ctrlX = origin.x + Math.cos(baseAngle) * len * 0.52;
    const ctrlY = origin.y + Math.sin(baseAngle) * len * 0.52;

    strands.push({
      pathD: `M${origin.x.toFixed(1)},${origin.y.toFixed(1)} Q${ctrlX.toFixed(1)},${ctrlY.toFixed(1)} ${endX.toFixed(1)},${endY.toFixed(1)}`,
      opacity: Number((0.24 + r() * 0.18).toFixed(2)),
      width: 0.85,
      color: i === 1 ? PHOSPHOR_VERDIGRIS : accentColor,
      tipDot: { x: Number(endX.toFixed(1)), y: Number(endY.toFixed(1)) },
    });
  }

  return strands;
}

/**
 * Generates an organic forward-growing branch starting from main spine node cx.
 * Preserves Tree map's wave-curved forward growth while scattering subtle Living-Tree mist particles
 * and neural-scan filament strands.
 */
export function generateBranchGeometry(
  cx: number,
  dir: 1 | -1,
  pairIndex: number,
  seed: number,
  accentColor: string,
  /** Timeline layout: x on the line where this branch sprouts (instead of fanning out of the node). */
  originX?: number
): BranchGeometry {
  const r = createRng(seed);
  const onLine = originX !== undefined;
  const T = {
    ang0: onLine ? 1.12 + (r() - 0.5) * 0.4 : Math.max(0.75, 1.15 - pairIndex * 0.15 + (r() - 0.5) * 0.3),
    len: onLine ? 150 + r() * 90 : 190 + pairIndex * 45 + r() * 80,
    a1: 0.035 + r() * 0.05,
    f1: 0.05 + r() * 0.05,
    p1: r() * 6.28,
    a2: 0.02 + r() * 0.04,
    f2: 0.16 + r() * 0.1,
    p2: r() * 6.28,
    pull: 0.015 + r() * 0.03,
  };

  const xLimit = onLine ? originX + 140 : cx + SPINE_GAP * 0.62;
  let x = onLine ? originX : cx + 8;
  let y = onLine ? 4 * dir : 29 * dir;
  let ang = dir * T.ang0;
  let dist = 0;

  const step = 6;
  const count = Math.max(4, (T.len / step) | 0);
  const points: Point2D[] = [{ x, y }];

  for (let s = 0; s < count; s++) {
    const q = s;
    ang +=
      T.a1 * Math.sin(T.f1 * q + T.p1) +
      T.a2 * Math.sin(T.f2 * q + T.p2) +
      (dir * 0.12 - ang) * T.pull;
    ang =
      dir < 0
        ? Math.max(-1.35, Math.min(-0.12, ang))
        : Math.max(0.12, Math.min(1.35, ang));
    x += Math.cos(ang) * step;
    y += Math.sin(ang) * step;
    dist += step;
    points.push({ x, y });
    if (x > xLimit) break;
  }

  // Give each secondary branch a stable world-space depth, then project its curve
  // through one fixed camera. The branch root stays pinned to the spine.
  const depth = ((pairIndex % 3) - 1) * 92 + dir * 24;
  for (let i = 1; i < points.length; i++) {
    const progress = i / (points.length - 1);
    const projected = projectTreePoint(points[i].x, points[i].y, depth * progress);
    points[i] = projected;
  }

  // Generate subtle Living-Tree particle stipple along the branch curve
  const mistParticles: ParticleDot[] = [];
  const mistCount = Math.min(48, points.length * 2);
  for (let i = 0; i < mistCount; i++) {
    const tIdx = Math.min(
      points.length - 1,
      Math.floor(r() * points.length)
    );
    const pt = points[tIdx];
    const progress = tIdx / Math.max(1, points.length - 1);
    const spread = 11 - progress * 4;
    const useAccent = r() < 0.55;
    mistParticles.push({
      x: Number((pt.x + (r() - 0.5) * spread).toFixed(1)),
      y: Number((pt.y + (r() - 0.5) * spread).toFixed(1)),
      r: Number((0.55 + r() * 1.15).toFixed(2)),
      color: useAccent
        ? accentColor
        : LIVING_PARTICLE_PALETTE[(r() * LIVING_PARTICLE_PALETTE.length) | 0],
      opacity: Number(((0.22 + r() * 0.45) * (1 - progress * 0.35)).toFixed(2)),
      twinkleDelay: r() < 0.12 ? Number((r() * 5).toFixed(1)) : undefined,
    });
  }

  const filaments = generateBranchFilaments(
    onLine ? originX : cx,
    points,
    dir,
    seed,
    accentColor
  );

  return {
    pathD: smoothSvgPath(points),
    approxLength: dist,
    tip: points[points.length - 1],
    dir,
    depthScale: treeDepthScale(((pairIndex % 3) - 1) * 92 + dir * 24),
    points,
    mistParticles,
    filaments,
  };
}

/**
 * Generates symmetrical rhythmic waveform envelope ticks and inter-node harmonic arcs
 * along the main spine axis, evoking the brain-scan knowledge-graph silhouette.
 */
export function generateSpineSynapses(
  branchCounts: number[],
  gap = SPINE_GAP,
  seed = 313,
  /** Actual node positions (timeline layout); defaults to i * gap. */
  nodeX?: number[]
): { ticks: WaveformTick[]; arcs: SynapseArc[] } {
  const r = createRng(seed);
  const ticks: WaveformTick[] = [];
  const arcs: SynapseArc[] = [];
  const n = branchCounts.length;
  if (n === 0) return { ticks, arcs };
  const pos = (i: number) => nodeX?.[i] ?? i * gap;

  const startX = -88;
  const endX = pos(n - 1) + 112;
  const step = 11;

  for (let x = startX; x <= endX; x += step) {
    // Influence envelope swells smoothly around each main node according to its branch count
    let envelope = 4;
    for (let i = 0; i < n; i++) {
      const cx = pos(i);
      const dist = Math.abs(x - cx);
      const weight = 14 + Math.min(3, branchCounts[i]) * 5.5;
      envelope += weight * Math.exp(-(dist * dist) / (2 * 56 * 56));
    }
    const jitter = 0.72 + r() * 0.52;
    const halfHeight = Number((envelope * jitter).toFixed(1));
    const isTeal = r() < 0.42;

    ticks.push({
      x: Number(x.toFixed(1)),
      halfHeight,
      opacity: Number((0.12 + Math.min(0.24, halfHeight / 110)).toFixed(2)),
      color: isTeal ? PHOSPHOR_VERDIGRIS : '#d1bd91',
    });
  }

  // Inter-node harmonic synaptic arcs bridging adjacent nodes above and below the spine
  for (let i = 0; i < n - 1; i++) {
    const x1 = pos(i);
    const x2 = pos(i + 1);
    const midX = (x1 + x2) / 2;
    const accent = NODE_ACCENTS[i % NODE_ACCENTS.length];

    for (const dir of [-1, 1] as const) {
      const archH = dir * (28 + (branchCounts[i] + branchCounts[i + 1]) * 6 + r() * 14);
      arcs.push({
        pathD: `M${x1.toFixed(1)},0 Q${midX.toFixed(1)},${archH.toFixed(1)} ${x2.toFixed(1)},0`,
        opacity: Number((0.14 + r() * 0.08).toFixed(2)),
        color: dir < 0 ? PHOSPHOR_VERDIGRIS : accent,
      });

      // Secondary inner chord
      const innerH = dir * (14 + r() * 12);
      arcs.push({
        pathD: `M${(x1 + 26).toFixed(1)},0 Q${midX.toFixed(1)},${innerH.toFixed(1)} ${(x2 - 26).toFixed(1)},0`,
        opacity: 0.13,
        color: '#d1bd91',
      });
    }
  }

  return { ticks, arcs };
}

/**
 * Computes eased progress reach along a branch path (0..1 -> 0..totalLength).
 */
export function computeBranchProgress(progress: number, totalLength: number): {
  eased: number;
  dashOffset: number;
  tipVisible: boolean;
  penActive: boolean;
} {
  const clamped = Math.max(0, Math.min(1, progress));
  const eased = (1 - Math.cos(Math.PI * clamped)) / 2;
  return {
    eased,
    dashOffset: totalLength * (1 - eased),
    tipVisible: clamped >= 0.97,
    penActive: clamped > 0 && clamped < 1,
  };
}

/**
 * Living Tree optical lens stipple inside each main node coin.
 */
export function generateLensParticles(
  seed: number,
  maxRadius = 15,
  count = 44
): ParticleDot[] {
  const r = createRng(seed);
  const dots: ParticleDot[] = [];
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2;
    const rad = Math.sqrt(r()) * maxRadius;
    dots.push({
      x: Number((Math.cos(a) * rad).toFixed(1)),
      y: Number((Math.sin(a) * rad).toFixed(1)),
      r: Number((0.45 + r() * 0.95).toFixed(2)),
      color: LENS_TEXTURE_PALETTE[(r() * LENS_TEXTURE_PALETTE.length) | 0],
      opacity: Number((0.28 + r() * 0.42).toFixed(2)),
    });
  }
  return dots;
}

/**
 * Living Tree ground horizon line scatter + gentle downward ember drift under the spine.
 */
export function generateGroundParticles(
  spineCount: number,
  gap = SPINE_GAP,
  seed = 7,
  /** Drawn line length (timeline layout); defaults to (count - 1) * gap. */
  spineWidth?: number
): ParticleDot[] {
  const r = createRng(seed);
  const width = (spineWidth ?? Math.max(1, spineCount - 1) * gap) + 320;
  const startX = -150;
  const dots: ParticleDot[] = [];

  // Horizon scatter along y = 0
  const horizonCount = Math.round(width * 0.28);
  for (let i = 0; i < horizonCount; i++) {
    const x = startX + r() * width;
    const y = (r() - 0.5) * 14;
    dots.push({
      x: Number(x.toFixed(1)),
      y: Number(y.toFixed(1)),
      r: Number((0.5 + r() * 1.15).toFixed(2)),
      color: LIVING_PARTICLE_PALETTE[(r() * LIVING_PARTICLE_PALETTE.length) | 0],
      opacity: Number((0.25 + r() * 0.45).toFixed(2)),
      twinkleDelay: r() < 0.08 ? Number((r() * 5).toFixed(1)) : undefined,
    });
  }

  // Soft falling drift below horizon
  const dripCount = spineCount * 55;
  for (let i = 0; i < dripCount; i++) {
    const x = startX + r() * width;
    const y = 12 + Math.pow(r(), 2.2) * 175;
    dots.push({
      x: Number(x.toFixed(1)),
      y: Number(y.toFixed(1)),
      r: Number((0.4 + r() * 0.9).toFixed(2)),
      color: LIVING_PARTICLE_PALETTE[(r() * LIVING_PARTICLE_PALETTE.length) | 0],
      opacity: Number(Math.max(0.06, 0.52 - y / 340).toFixed(2)),
      twinkleDelay: r() < 0.06 ? Number((r() * 5).toFixed(1)) : undefined,
    });
  }

  return dots;
}

/**
 * Ambient deep-sky stars for the Living Tree nocturnal background.
 */
export function generateAmbientStars(
  count = 64,
  seed = 1979
): Array<{ xPct: number; yPct: number; r: number; opacity: number; delay: number }> {
  const r = createRng(seed);
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      xPct: Number((r() * 100).toFixed(2)),
      yPct: Number((r() * 100).toFixed(2)),
      r: Number((0.6 + r() * 1.2).toFixed(2)),
      opacity: Number((0.15 + r() * 0.45).toFixed(2)),
      delay: Number((r() * 6).toFixed(1)),
    });
  }
  return stars;
}

/**
 * Calculates optimal pan/zoom transform to fit the tree bounding box inside the viewport.
 */
export function computeFitTransform(
  bbox: BoundingBox,
  viewportWidth: number,
  viewportHeight: number
): ViewTransform {
  if (bbox.width <= 0 || bbox.height <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return { k: 1, x: viewportWidth / 2, y: viewportHeight / 2 };
  }

  const padX = viewportWidth < 640 ? 24 : 88;
  const top = viewportWidth < 640 ? 108 : 112;
  const bottom = Math.min(230, viewportHeight * 0.3);

  const availW = Math.max(120, viewportWidth - 2 * padX);
  const availH = Math.max(120, viewportHeight - top - bottom);
  const k = Math.max(0.14, Math.min(1.2, availW / bbox.width, availH / bbox.height));

  return {
    k,
    x: viewportWidth / 2 - (bbox.x + bbox.width / 2) * k,
    y: top + availH / 2 - (bbox.y + bbox.height / 2) * k,
  };
}
