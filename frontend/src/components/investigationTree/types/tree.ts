export interface BranchItem {
  id: string;
  name: string;
  info: string;
  seed: number;
  isNew?: boolean;
}

export interface SpineNode {
  id: string;
  name: string;
  info: string;
  branches: BranchItem[];
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
