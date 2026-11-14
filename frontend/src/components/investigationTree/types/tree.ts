export interface BranchItem {
  id: string;
  name: string;
  info: string;
  seed: number;
  isNew?: boolean;
  /** ISO date; orders the branch along the timeline line. */
  publishedAt?: string;
  /** Claim view: supports / contradicts / context (colours the tip). */
  stance?: 'supports' | 'contradicts' | 'context';
  /** Politician view: outcome report (fulfilled = supports, not fulfilled = contradicts, in progress = context). */
  outcomeReport?: boolean;
}

export interface SpineNode {
  id: string;
  name: string;
  info: string;
  branches: BranchItem[];
  /** Claim view: unverified claim, drawn on the separate dashed lane below the timeline. */
  pending?: boolean;
  /** Claim view: contradicting evidence exists. */
  disputed?: boolean;
  /** Politician view: what later reports say happened. */
  outcome?: 'fulfilled' | 'not_fulfilled' | 'in_progress' | 'no_update';
  /** Politician view: only one source reports the claim (badge, but stays on the main line). */
  unverified?: boolean;
}

/** Claim view: a neutral connection between two claims (by node id). */
export interface TreeLink {
  from: string;
  to: string;
  type: 'evolution' | 'follow_up' | 'potential_inconsistency';
  basis: 'stated' | 'sequence_only' | 'inferred';
  description: string;
}

export interface FocusTarget {
  spineIndex: number;
  branchIndex?: number;
}

export interface ViewTransform {
  k: number;
  x: number;
  y: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface ParticleDot {
  x: number;
  y: number;
  r: number;
  color: string;
  opacity: number;
  twinkleDelay?: number;
}

export interface FilamentStrand {
  pathD: string;
  opacity: number;
  width: number;
  color: string;
  tipDot?: Point2D;
}

export interface WaveformTick {
  x: number;
  halfHeight: number;
  opacity: number;
  color: string;
}

export interface SynapseArc {
  pathD: string;
  opacity: number;
  color: string;
}

export interface BranchGeometry {
  pathD: string;
  approxLength: number;
  tip: Point2D;
  dir: 1 | -1;
  depthScale: number;
  points: Point2D[];
  mistParticles: ParticleDot[];
  filaments: FilamentStrand[];
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
