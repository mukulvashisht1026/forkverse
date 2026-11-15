import { useEffect, useMemo, useRef, useState } from 'react';
import type { TreeLink } from '../types/tree';
import type {
  BranchGeometry,
  BranchItem,
  FocusTarget,
  SpineNode,
  ViewTransform,
} from '../types/tree';
import {
  computeBranchProgress,
  computeFixedTransform,
  generateAmbientStars,
  generateBranchGeometry,
  generateGroundParticles,
  generateLensParticles,
  generateSpineSynapses,
  NODE_ACCENTS,
  SPINE_GAP,
  ORIGIN_STEP,
  branchOrder,
  computeSpineLayout,
  tickLabel,
} from '../utils/treeMath';
import { zoomViewAtWheel } from '../utils/wheelZoom';

/** Claim view: y of the dashed lane holding pending (unverified) claims. */
const UNVERIFIED_LANE_Y = 290;
/** Node spacing grows with branch count only up to this many (a fan's width stops growing after that). */
const FAN_SPACING_BRANCHES = 8;
/** Claim / timeline view: wrap a node title into short lines of equal width (ellipsis only past maxLines). */
/** Node titles keep a fixed column width and grow upward (last line stays just above the line). */
const TITLE_MAX_LINES = 8;
/** Branch tip heading while hovered: characters per line, max lines, line height. */
const TIP_FULL_WIDTH = 38;
const TIP_FULL_LINES = 8;
const TIP_LINE = 12;
function wrapLabel(text: string, width = 26, maxLines = 2): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line ? `${line} ${w}` : w).length <= width) line = line ? `${line} ${w}` : w;
    else {
      if (line) lines.push(line);
      line = w.length > width ? `${w.slice(0, width - 1)}…` : w;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && lines.join(' ').length < text.trim().length) {
    lines[maxLines - 1] = `${lines[maxLines - 1]!.slice(0, width - 1).trimEnd()}…`;
  }
  return lines.slice(0, maxLines);
}

/** Claim view: minimum spacing between claim nodes (claims carry few articles each). */
const CLAIM_GAP = 330;

/** Edge scroll: px/s at the inner side of the button and at the screen edge; margin kept at the ends. */
const EDGE_MIN_SPEED = 260;
const EDGE_MAX_SPEED = 1100;
const EDGE_PAD = 90;

/** Small waving red flag (pole at x, base at y). */
function RedFlag({ x, y, size = 1 }: { x: number; y: number; size?: number }) {
  return (
    <g className="red-flag" transform={`translate(${x} ${y}) scale(${size})`} aria-hidden="true">
      <line className="red-flag-pole" x1={0} y1={0} x2={0} y2={-17} />
      <path className="red-flag-cloth" d="M0.6 -17 C4 -18.6 7 -15.4 11 -16.6 L11 -9.6 C7 -8.4 4 -11.6 0.6 -10 Z" />
    </g>
  );
}

/** Hover card drawn in the canvas (world units, counter-scaled so text stays readable). */
function FlagTooltip({ lines, x, y, scale = 1, anchor = 'start' }: { lines: string[]; x: number; y: number; scale?: number; anchor?: 'start' | 'end' }) {
  const width = Math.min(330, Math.max(...lines.map((l) => l.length)) * 5.9 + 18);
  const height = lines.length * 14 + 10;
  const left = anchor === 'end' ? -width : 0;
  return (
    <g className="flag-tooltip" transform={`translate(${x} ${y}) scale(${scale})`} pointerEvents="none">
      <rect x={left} y={-height} width={width} height={height} rx={6} />
      {lines.map((l, i) => (
        <text key={i} className={i === 0 ? 'flag-tooltip-title' : 'flag-tooltip-line'} x={left + 9} y={-height + 16 + i * 14}>{l}</text>
      ))}
    </g>
  );
}

interface TreeCanvasProps {
  spine: SpineNode[];
  selectedIndex: number;
  focusTarget: FocusTarget | null;
  isPaused: boolean;
  researching: boolean;
  className?: string;
  fitRequest: { id: number; instant: boolean };
  onSelectNode: (index: number) => void;
  onSelectBranch: (spineIndex: number, branchIndex: number) => void;
  onSetFocus: (target: FocusTarget | null) => void;
  onGrowthComplete: (eventId: string, evidenceId?: string) => void;
  onContinue: () => void;
  isContinuing: boolean;
  /** Claim view: neutral links between claims, drawn as labelled arcs above the timeline. */
  links?: TreeLink[];
  /** Claim view: established and pending claims are laid out on separate lanes, compactly. */
  claimView?: boolean;
  /** Every branch shows its full heading (toolbar "Show all headings"). */
  showAllHeadings?: boolean;
  /** Claim view: note shown at the end of the unverified lane (e.g. "+12 more unverified"). */
  laneNote?: string;
  onViewChange?: (view: ViewTransform) => void;
  onCanvasReady?: (svg: SVGSVGElement | null) => void;
  /** Evidence/event ids cited by the current answer: these stay lit, everything else dims. */
  highlight?: {
    evidenceIds: ReadonlySet<string>;
    eventIds: ReadonlySet<string>;
    /** Proof engine roles per evidence id: colours the lit branches. */
    roles?: ReadonlyMap<string, string>;
  } | null;
}

interface BranchViewProps {
  branch: BranchItem;
  geometry: BranchGeometry;
  eventId: string;
  growthDelay: number;
  spineIndex: number;
  branchIndex: number;
  accent: string;
  isGroupFocused: boolean;
  isTipHot: boolean;
  isCited: boolean;
  role?: string;
  isPaused: boolean;
  dragMovedRef: React.RefObject<boolean>;
  onSelectBranch: (spineIndex: number, branchIndex: number) => void;
  onSetFocus: (target: FocusTarget | null) => void;
  onGrowthComplete: (eventId: string, evidenceId?: string) => void;
  /** Pointer is over this branch's circle or line: show its full heading. */
  showHeading: boolean;
  /** "Show all headings": every branch shows its full heading, not only on hover. */
  showAllHeadings?: boolean;
  onHeadingHover: (on: boolean) => void;
}

function BranchView({
  branch,
  geometry,
  eventId,
  growthDelay,
  spineIndex,
  branchIndex,
  accent,
  isGroupFocused,
  isTipHot,
  isCited,
  role,
  isPaused,
  dragMovedRef,
  onSelectBranch,
  onSetFocus,
  onGrowthComplete,
  showHeading,
  showAllHeadings = false,
  onHeadingHover,
}: BranchViewProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const penRef = useRef<SVGCircleElement>(null);
  const tipGroupRef = useRef<SVGGElement>(null);
  const mistGroupRef = useRef<SVGGElement>(null);
  const growthProgressRef = useRef(0);
  const [burstKey, setBurstKey] = useState<number>(0);

  useEffect(() => {
    const pathEl = pathRef.current;
    const penEl = penRef.current;
    const tipEl = tipGroupRef.current;
    const mistEl = mistGroupRef.current;
    if (!pathEl || !penEl || !tipEl || !mistEl) return;

    const totalLen = pathEl.getTotalLength();
    const shouldAnimate = Boolean(branch.isNew) && !isPaused;

    const applyProgress = (p: number) => {
      const state = computeBranchProgress(p, totalLen);
      if (p >= 1) {
        pathEl.removeAttribute('stroke-dasharray');
        pathEl.removeAttribute('stroke-dashoffset');
        pathEl.style.visibility = 'visible';
      } else {
        pathEl.setAttribute('stroke-dasharray', String(totalLen));
        pathEl.setAttribute('stroke-dashoffset', String(state.dashOffset));
        pathEl.style.visibility = state.eased > 0 ? 'visible' : 'hidden';
      }

      if (state.penActive) {
        const pt = pathEl.getPointAtLength(totalLen * state.eased);
        penEl.setAttribute('cx', String(pt.x));
        penEl.setAttribute('cy', String(pt.y));
        penEl.classList.add('on');
      } else {
        penEl.classList.remove('on');
      }

      tipEl.classList.toggle('ready', state.tipVisible);
      tipEl.style.opacity = state.tipVisible ? '1' : '0';
      mistEl.style.opacity = state.tipVisible ? '1' : String(state.eased * 0.65);
    };

    if (!shouldAnimate) {
      growthProgressRef.current = 1;
      applyProgress(1);
      if (branch.isNew && isPaused) {
        onGrowthComplete(eventId, branch.id);
      }
      return;
    }

    const duration = Math.min(1.6, Math.max(0.9, geometry.approxLength / 320));
    let progress = growthProgressRef.current;
    let waitElapsed = 0;
    let lastTime = performance.now();
    let rafId = 0;
    let cancelled = false;

    applyProgress(progress);

    const step = (now: number) => {
      if (cancelled) return;
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      if (waitElapsed < growthDelay) {
        waitElapsed += dt;
        rafId = requestAnimationFrame(step);
        return;
      }
      progress = Math.min(1, progress + dt / duration);
      growthProgressRef.current = progress;
      applyProgress(progress);

      if (progress < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        growthProgressRef.current = 1;
        setBurstKey((k) => k + 1);
        onGrowthComplete(eventId, branch.id);
      }
    };

    rafId = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [
    branch.id,
    branch.isNew,
    eventId,
    growthDelay,
    geometry.approxLength,
    isPaused,
    onGrowthComplete,
    spineIndex,
  ]);

  const targetFocus: FocusTarget = { spineIndex, branchIndex };

  return (
    <g className={`branch ${isCited ? 'cited' : ''} ${branch.live ? `live-${branch.live}` : ''} ${branch.vet ? `vet-${branch.vet}` : ''} ${role ? `role-${role}` : ''} ${branch.stance ? `stance-${branch.stance}` : ''} ${branch.outcomeReport ? 'outcome-report' : ''} ${branch.sourceReport ? 'source-report' : ''}`} transform={`translate(${geometry.points[0].x} ${geometry.points[0].y}) scale(${geometry.depthScale}) translate(${-geometry.points[0].x} ${-geometry.points[0].y})`}>
      {/* Living-Tree mist stipple + neural-scan tangent filaments & micro-dendrites */}
      <g ref={mistGroupRef} className="branch-filaments" style={{ transition: 'opacity 0.35s ease' }}>
        {geometry.filaments.map((strand, idx) => (
          <g key={`fil-${idx}`}>
            <path
              d={strand.pathD}
              fill="none"
              stroke={strand.color}
              strokeWidth={isGroupFocused ? strand.width * 1.25 : strand.width}
              opacity={
                isTipHot
                  ? Math.min(0.32, strand.opacity * 0.9)
                  : isGroupFocused
                    ? Math.min(0.26, strand.opacity * 0.75)
                    : strand.opacity * 0.55
              }
              style={{ transition: 'opacity 0.22s ease, stroke-width 0.22s ease' }}
            />
            {strand.tipDot && (
              <circle
                cx={strand.tipDot.x}
                cy={strand.tipDot.y}
                r={isGroupFocused ? 1.6 : 1.15}
                fill={strand.color}
                opacity={isGroupFocused ? 0.85 : 0.45}
                style={{ transition: 'opacity 0.22s ease' }}
              />
            )}
          </g>
        ))}

        {geometry.mistParticles.map((dot, idx) => (
          <circle
            key={idx}
            cx={dot.x}
            cy={dot.y}
            r={dot.r}
            fill={dot.color}
            opacity={dot.opacity}
            className={dot.twinkleDelay !== undefined ? 'twinkle-dot' : undefined}
            style={
              dot.twinkleDelay !== undefined
                ? { animationDelay: `${dot.twinkleDelay}s` }
                : undefined
            }
          />
        ))}
      </g>

      {/* Quiet branch rail, halo, and bounded colored current moving along the existing curve. */}
      <path
        ref={pathRef}
        d={geometry.pathD}
        fill="none"
        stroke={isGroupFocused ? accent : '#68746e'}
        opacity={isGroupFocused ? 0.8 : 0.52}
        strokeWidth={isGroupFocused ? 1.7 : 1.35}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transition: 'stroke 0.2s ease, stroke-width 0.2s ease' }}
      />
      {/* Invisible, wider hit area along the line: hovering the line shows the full heading. */}
      <path className="branch-hit" d={geometry.pathD} fill="none" stroke="transparent" strokeWidth={10} pointerEvents="stroke" onMouseEnter={() => onHeadingHover(true)} onMouseLeave={() => onHeadingHover(false)} />
      <g className={`branch-current${isPaused ? ' paused' : ''}`} aria-hidden="true">
        <path d={geometry.pathD} fill="none" stroke={accent} strokeWidth="5.5" strokeLinecap="round" opacity="0.12" />
        <path d={geometry.pathD} fill="none" stroke={accent} strokeWidth="2.2" strokeLinecap="round" strokeDasharray="34 1100" className="branch-current-trail" style={{ animationDelay: `${(spineIndex * 0.83 + branchIndex * 1.37) % 7}s` }} />
        <path d={geometry.pathD} fill="none" stroke="#f5f2e8" strokeWidth="0.9" strokeLinecap="round" strokeDasharray="10 1100" className="branch-current-core" style={{ animationDelay: `${(spineIndex * 0.83 + branchIndex * 1.37) % 7}s` }} />
      </g>

      {/* Glowing pen dot during live branch growth */}
      <circle ref={penRef} className="pen-dot" r={5.5} />

      {/* One restrained completion highlight */}
      {burstKey > 0 && (
        <g key={burstKey}>
          <circle className="burst-ring" cx={geometry.tip.x} cy={geometry.tip.y} r={8} fill="none" stroke={accent} strokeWidth={1.4} />
        </g>
      )}

      {/* Interactive branch tip node */}
      <g
        ref={tipGroupRef}
        data-card-anchor={`evidence:${eventId}:${branch.id}`}
        className={`tip-group ${isTipHot ? 'hot' : ''}`}
        tabIndex={0}
        role="button"
        aria-label={branch.name}
        transform={`translate(${geometry.tip.x} ${geometry.tip.y})`}
        onMouseEnter={() => onSetFocus(targetFocus)}
        onMouseLeave={() => onSetFocus(null)}
        onFocus={() => onSetFocus(targetFocus)}
        onBlur={() => onSetFocus(null)}
        onClick={(e) => {
          e.stopPropagation();
          if (!dragMovedRef.current) {
            onSelectBranch(spineIndex, branchIndex);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectBranch(spineIndex, branchIndex);
          }
        }}
      >
        <circle
          onMouseEnter={() => onHeadingHover(true)}
          onMouseLeave={() => onHeadingHover(false)}
          className={`tip-core${branch.unverifiedClaim ? ' tip-unverified' : ''}`}
          r={tipRadius(branch.sources)}
          fill="#060d1f"
          stroke={isTipHot ? '#f5f2e8' : accent}
          strokeWidth={2.6}
        />
        {branch.sources !== undefined && branch.sources > 1 && (
          <text className="tip-source-count" y={3.5} textAnchor="middle" aria-label={`${branch.sources} sources`}>{branch.sources}</text>
        )}
        <circle className="keyboard-focus-ring" r={14} fill="none" />
        {/* Hit target of the tip circle (drawn over it): hovering it shows the full heading. */}
        <circle className="fill-transparent" r={16} onMouseEnter={() => onHeadingHover(true)} onMouseLeave={() => onHeadingHover(false)} />
        {branch.flag && <RedFlag x={6} y={-9} />}
        {branch.flag && isTipHot && <FlagTooltip lines={branch.flag.lines} x={14} y={-18} scale={1 / geometry.depthScale} />}
        {branch.vetTag && (
          <g className="vet-tip" aria-hidden="true">
            {branch.vet === 'manipulative' && <circle className="vet-tip-ring" r={12} />}
            <text className="vet-tag" x={-13} y={geometry.dir < 0 ? 14 : -10} textAnchor="end">{branch.vetTag}</text>
          </g>
        )}
        {branch.live && (
          <g className="live-tip" aria-hidden="true">
            <circle className="live-tip-ring" r={11} />
            {branch.live === 'fresh' && <circle className="live-tip-ring delay" r={11} />}
            <text className="live-new-tag" x={13} y={geometry.dir < 0 ? 14 : -10}>NEW</text>
          </g>
        )}
        {/* While hovered, the full heading is drawn by TipHeadingOverlay (above sibling branches). */}
        {!(showHeading && branch.fullName) && (() => {
          // "Show all headings": the full heading, wrapped, growing away from the tip.
          const lines = showAllHeadings && branch.fullName ? wrapLabel(branch.fullName, TIP_FULL_WIDTH, TIP_FULL_LINES) : [branch.name];
          const y0 = geometry.dir < 0 ? -17 - (lines.length - 1) * TIP_LINE : 29;
          return (
            <text className="tip-label" fill="#ffffff" y={y0} textAnchor="middle">
              {lines.map((line, li) => <tspan key={li} x={0} dy={li ? TIP_LINE : 0}>{line}</tspan>)}
            </text>
          );
        })()}
      </g>
    </g>
  );
}

/** Timeline view: a claim stated by more independent sources gets a bigger tip (capped). */
export function tipRadius(sources?: number): number {
  return sources && sources > 1 ? 7.5 + Math.min(sources - 1, 4) * 1.6 : 7.5;
}

/**
 * Full heading of the hovered branch tip, drawn after the node's other branches so no sibling tip
 * covers it. Same transforms as BranchView (depth scale around the origin, then the tip position).
 */
function TipHeadingOverlay({ branch, geometry }: { branch: BranchItem; geometry: BranchGeometry }) {
  const lines = wrapLabel(branch.fullName ?? branch.name, TIP_FULL_WIDTH, TIP_FULL_LINES);
  const y0 = geometry.dir < 0 ? -17 - (lines.length - 1) * TIP_LINE : 29;
  const o = geometry.points[0];
  return (
    <g className="tip-heading-overlay" aria-hidden="true" pointerEvents="none" transform={`translate(${o.x} ${o.y}) scale(${geometry.depthScale}) translate(${-o.x} ${-o.y})`}>
      <g transform={`translate(${geometry.tip.x} ${geometry.tip.y})`}>
        <text className="tip-label" fill="#ffffff" y={y0} textAnchor="middle">
          {lines.map((line, li) => <tspan key={li} x={0} dy={li ? TIP_LINE : 0}>{line}</tspan>)}
        </text>
      </g>
    </g>
  );
}

export function TreeCanvas({
  spine,
  selectedIndex,
  focusTarget,
  isPaused,
  researching,
  fitRequest,
  onSelectNode,
  onSelectBranch,
  onSetFocus,
  onGrowthComplete,
  onViewChange,
  onCanvasReady,
  className = '',
  highlight = null,
  links = [],
  claimView = false,
  showAllHeadings = false,
  laneNote,
}: TreeCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  useEffect(() => { onCanvasReady?.(svgRef.current); }, [onCanvasReady]);

  const viewRef = useRef<ViewTransform>({ k: 1, x: 0, y: 0 });
  /** Length of the drawn spine, so the camera measures the graph itself and not the background decoration. */
  const contentWidthRef = useRef(0);
  const goalRef = useRef<ViewTransform | null>(null);
  const cameraRafRef = useRef<number | null>(null);
  const scheduleCameraRef = useRef<() => void>(() => {});
  const dragRef = useRef<{
    x: number;
    y: number;
    vx: number;
    vy: number;
  } | null>(null);
  const dragMovedRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  /** Branch whose circle or line is under the pointer (its full heading is shown). */
  const [headingTip, setHeadingTip] = useState<{ s: number; b: number } | null>(null);
  /** Edge scroll ("game camera"): direction held (-1 = look left, 1 = look right), speed 0..1. */
  const edgeRef = useRef<{ dir: -1 | 0 | 1; strength: number; velocity: number }>({ dir: 0, strength: 0, velocity: 0 });
  const bboxRef = useRef<{ box: DOMRect | null; at: number }>({ box: null, at: 0 });
  const [edges, setEdges] = useState({ left: false, right: false });
  const edgesRef = useRef(edges);

  const ambientStars = useMemo(() => generateAmbientStars(68, 1979), []);
  // Timeline layout: event nodes spaced so their articles fit along the line, in date order.
  const layout = useMemo(() => {
    // Every view: branches fan out of their node, so nodes use the compact spacing. Claim view also
    // has an unverified lane; other views only have the main lane (pending is unset).
    const lane = (pending: boolean) => spine.map((n, i) => ({ n, i })).filter(({ n }) => Boolean(n.pending) === pending);
    const main = lane(false);
    const pend = lane(true);
    // Fans grow out of the node, so spacing only needs room for a fan, not one origin per branch.
    const fan = (n: number) => Math.min(n, FAN_SPACING_BRANCHES);
    const mainL = computeSpineLayout(main.map(({ n }) => fan(n.branches.length)), CLAIM_GAP);
    const pendL = computeSpineLayout(pend.map(({ n }) => fan(n.branches.length)), CLAIM_GAP);
    const nodeX = new Array<number>(spine.length);
    const originStart = new Array<number>(spine.length);
    main.forEach(({ i }, k) => { nodeX[i] = mainL.nodeX[k]!; originStart[i] = mainL.originStart[k]!; });
    pend.forEach(({ i }, k) => { nodeX[i] = pendL.nodeX[k]!; originStart[i] = pendL.originStart[k]!; });
    return { nodeX, originStart, end: Math.max(mainL.end, main.length ? 0 : pendL.end) };
  }, [spine, claimView]);
  const groundParticles = useMemo(
    () => generateGroundParticles(spine.length, SPINE_GAP, 7, layout.end),
    [spine.length, layout.end]
  );
  const spineSynapses = useMemo(
    () =>
      generateSpineSynapses(
        spine.map((n) => n.branches.length),
        SPINE_GAP,
        313,
        layout.nodeX
      ),
    [spine, layout]
  );

  const spineGeometries = useMemo(() => {
    const result = spine.map((node, spineIdx) => {
      const cx = layout.nodeX[spineIdx] ?? spineIdx * SPINE_GAP;
      const accent = NODE_ACCENTS[spineIdx % NODE_ACCENTS.length];
      const lensParticles = generateLensParticles(spineIdx * 53 + 11, 14.5, 42);
      // Branches fan out of the node itself, ordered by date, alternating above (-1) and below (+1).
      const rank = branchOrder(node.branches.map((b) => b.publishedAt));
      // Pending (unverified) claims sit on their own lane below; their branches only grow downward
      // so they never reach the main timeline.
      const laneY = node.pending ? UNVERIFIED_LANE_Y : 0;
      const branches = node.branches.map((b, branchIdx) => {
        const pos = rank[branchIdx] ?? branchIdx;
        const dir: 1 | -1 = node.pending ? 1 : pos % 2 ? 1 : -1;
        // Every child is visibly attached to the node it belongs to (same design in every view,
        // including nodes that arrive live over the WebSocket).
        return {
          branch: b,
          tick: { x: cx, dir, label: tickLabel(b.publishedAt), show: false },
          geometry: generateBranchGeometry(cx, dir, node.pending ? pos : Math.floor(pos / 2), b.seed, accent),
        };
      });
      return { node, cx, laneY, accent, lensParticles, branches };
    });
    // Date labels: one row below the line, only where the date changes and there is room.
    const MIN_LABEL_GAP = 56;
    let lastX = -Infinity;
    let lastLabel: string | null = null;
    // Branches fan out of the node itself, so a per-branch date tick would sit on the node: none.
    const ticks: (typeof result)[number]['branches'][number]['tick'][] = [];
    for (const t of ticks) {
      // Below-line labels only under upward branches, so no stem passes through the text.
      if (!t.label || t.dir > 0 || t.label === lastLabel || t.x - lastX < MIN_LABEL_GAP) continue;
      t.show = true;
      lastX = t.x;
      lastLabel = t.label;
    }
    return result;
  }, [spine, layout, claimView]);

  /** World bounding box, cached (getBBox is too costly to call every animation frame). */
  const worldBox = (maxAgeMs = 400): DOMRect | null => {
    const world = worldRef.current;
    if (!world) return null;
    const now = performance.now();
    if (!bboxRef.current.box || now - bboxRef.current.at > maxAgeMs) {
      const b = world.getBBox();
      bboxRef.current = { box: b.width ? b : null, at: now };
    }
    return bboxRef.current.box;
  };

  /** Show an edge button only when part of the graph is hidden beyond that edge. */
  const updateEdges = () => {
    const svg = svgRef.current;
    const box = worldBox();
    if (!svg || !box) return;
    const { x, k } = viewRef.current;
    const left = x + box.x * k < -EDGE_PAD / 2;
    const right = x + (box.x + box.width) * k > svg.clientWidth + EDGE_PAD / 2;
    if (left !== edgesRef.current.left || right !== edgesRef.current.right) {
      edgesRef.current = { left, right };
      setEdges(edgesRef.current);
    }
  };

  const applyViewToDom = () => {
    const world = worldRef.current;
    if (!world) return;
    const { x, y, k } = viewRef.current;
    world.setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
    onViewChange?.({ x, y, k });
    updateEdges();
  };

  const triggerFit = (instant: boolean) => {
    const svg = svgRef.current;
    const world = worldRef.current;
    if (!svg || !world) return;
    // SVG elements may report empty dimensions while graph data is still rendering.
    const bbox = world.getBBox();
    if (!bbox.width || !bbox.height) return;
    // Every view uses the same scale (nodes/branches keep one size); long graphs start at their
    // beginning and are scrolled. Keep the start clear of a chat panel docked on the left.
    const svgRect = svg.getBoundingClientRect();
    const chat = document.querySelector('.gh-chat-window')?.getBoundingClientRect();
    const chatOnLeft = chat && chat.width > 0 && chat.left - svgRect.left < 80 && chat.right > svgRect.left && chat.right < svgRect.left + svgRect.width * 0.6;
    const leftInset = chatOnLeft ? chat.right - svgRect.left + 16 : 0;
    // Horizontal extent from the layout (first node's title ... arrow at the end); the world bbox
    // also contains background stars and particles, which would push the start off screen.
    const content = { x: -260, width: contentWidthRef.current + 420, y: bbox.y, height: bbox.height };
    const nextGoal = computeFixedTransform(content, svg.clientWidth, svg.clientHeight, { leftInset });
    if (instant) {
      viewRef.current = nextGoal;
      goalRef.current = null;
      applyViewToDom();
    } else {
      goalRef.current = nextGoal;
      scheduleCameraRef.current();
    }
  };

  // Fit after data render/layout and whenever graph or viewport changes.
  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      triggerFit(fitRequest.instant);
    });
    const observer = new ResizeObserver(() => triggerFit(true));
    if (svgRef.current) observer.observe(svgRef.current);
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [fitRequest.id, fitRequest.instant, spine.length]);

  // Refit cleanly on viewport resize
  useEffect(() => {
    const handleResize = () => triggerFit(true);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Smooth camera lerp loop for Fit view transitions
  useEffect(() => {
    let disposed = false;
    const tick = () => {
      cameraRafRef.current = null;
      if (disposed || document.hidden) return;
      const goal = goalRef.current;
      if (!goal) return;
      if (isPaused) {
        viewRef.current = { ...goal };
        goalRef.current = null;
        applyViewToDom();
        return;
      }
      const v = viewRef.current;
      v.k += (goal.k - v.k) * 0.1;
      v.x += (goal.x - v.x) * 0.1;
      v.y += (goal.y - v.y) * 0.1;
      applyViewToDom();
      if (
        Math.abs(goal.k - v.k) < 0.001 &&
        Math.abs(goal.x - v.x) < 0.5 &&
        Math.abs(goal.y - v.y) < 0.5
      ) {
        viewRef.current = { ...goal };
        goalRef.current = null;
        applyViewToDom();
      } else {
        cameraRafRef.current = requestAnimationFrame(tick);
      }
    };
    const schedule = () => {
      if (cameraRafRef.current === null && !document.hidden && goalRef.current && !isPaused) {
        cameraRafRef.current = requestAnimationFrame(tick);
      }
    };
    scheduleCameraRef.current = schedule;
    const onVisibilityChange = () => {
      if (document.hidden && cameraRafRef.current !== null) {
        cancelAnimationFrame(cameraRafRef.current);
        cameraRafRef.current = null;
      } else {
        schedule();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    if (isPaused && goalRef.current) {
      viewRef.current = { ...goalRef.current };
      goalRef.current = null;
      applyViewToDom();
    } else {
      schedule();
    }
    return () => {
      disposed = true;
      scheduleCameraRef.current = () => {};
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (cameraRafRef.current !== null) cancelAnimationFrame(cameraRafRef.current);
      cameraRafRef.current = null;
    };
  }, [isPaused]);

  // Panning via pointer events on window
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!dragMovedRef.current && Math.hypot(dx, dy) > 5) {
        dragMovedRef.current = true;
        setIsDragging(true);
        onSetFocus(null);
      }
      if (dragMovedRef.current) {
        viewRef.current.x = drag.vx + dx;
        viewRef.current.y = drag.vy + dy;
        applyViewToDom();
      }
    };

    const handlePointerUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setIsDragging(false);
      setTimeout(() => {
        dragMovedRef.current = false;
      }, 0);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [onSetFocus]);

  // Wheel zoom centered at cursor
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // Listen on the canvas surface, not just the SVG: branch hit targets are overlay
    // elements, and wheel events over them do not reach the SVG.
    const surface = svg.parentElement ?? svg;
    const handleWheel: EventListener = (event) => {
      const e = event as WheelEvent;
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        // Pinch (trackpads send ctrl+wheel) or Ctrl/Cmd + wheel: zoom at the cursor.
        Object.assign(v, zoomViewAtWheel(v, e.deltaY, { x: e.clientX, y: e.clientY }, rect));
      } else {
        // Plain wheel / two-finger scroll: move along the timeline (vertical wheel scrolls
        // sideways; Shift + wheel or a vertical trackpad gesture with a sideways one moves up/down).
        const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? 0 : e.deltaY;
        const vertical = e.shiftKey ? e.deltaY : 0;
        v.x -= sideways;
        v.y -= vertical;
      }
      goalRef.current = null;
      applyViewToDom();
    };
    surface.addEventListener('wheel', handleWheel, { passive: false });
    return () => surface.removeEventListener('wheel', handleWheel);
  }, []);

  // Edge scroll: while an edge button is hovered/pressed the camera glides that way, easing in
  // and out (velocity lerp), faster the closer the pointer is to the screen edge, and stops at
  // the end of the graph.
  useEffect(() => {
    let rafId = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const edge = edgeRef.current;
      const svg = svgRef.current;
      const box = worldBox(800);
      const target = edge.dir * (EDGE_MIN_SPEED + (EDGE_MAX_SPEED - EDGE_MIN_SPEED) * edge.strength);
      // Ease towards the target speed: quick start, soft stop.
      edge.velocity += (target - edge.velocity) * Math.min(1, dt * (edge.dir ? 5 : 7));
      if (Math.abs(edge.velocity) < 2 && !edge.dir) edge.velocity = 0;
      if (edge.velocity && svg && box) {
        const v = viewRef.current;
        goalRef.current = null; // the user is steering: cancel fit animations
        // Looking right moves the graph left (x decreases), and vice versa.
        let nextX = v.x - edge.velocity * dt;
        const minX = svg.clientWidth - EDGE_PAD - (box.x + box.width) * v.k; // right end reached
        const maxX = EDGE_PAD - box.x * v.k; // left end reached
        if (minX < maxX) nextX = Math.min(maxX, Math.max(minX, nextX));
        if (nextX === v.x) edge.velocity = 0;
        v.x = nextX;
        applyViewToDom();
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Graph content changed: refresh the cached bounds and which edge buttons apply.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      bboxRef.current.at = 0;
      updateEdges();
    });
    return () => cancelAnimationFrame(id);
  }, [spineGeometries]);

  /** Pointer position inside an edge button -> speed (0 at the inner side, 1 at the screen edge). */
  const steer = (dir: -1 | 1) => (e: React.PointerEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = dir < 0 ? 1 - (e.clientX - r.left) / r.width : (e.clientX - r.left) / r.width;
    edgeRef.current.dir = dir;
    edgeRef.current.strength = Math.max(0, Math.min(1, t));
  };
  const release = () => {
    edgeRef.current.dir = 0;
    edgeRef.current.strength = 0;
  };
  /** Keyboard / click: glide about two thirds of a screen. */
  const jump = (dir: -1 | 1) => {
    const svg = svgRef.current;
    const box = worldBox(0);
    if (!svg || !box) return;
    const v = viewRef.current;
    const minX = svg.clientWidth - EDGE_PAD - (box.x + box.width) * v.k;
    const maxX = EDGE_PAD - box.x * v.k;
    const x = Math.min(maxX, Math.max(minX, v.x - dir * svg.clientWidth * 0.66));
    goalRef.current = { ...v, x };
  };

  const totalSpineWidth = layout.end;
  contentWidthRef.current = totalSpineWidth;
  const isFocusing = focusTarget !== null;
  const isCiting = Boolean(highlight && (highlight.evidenceIds.size > 0 || highlight.eventIds.size > 0));

  useEffect(() => {
    if (!isPaused) return;
    for (const node of spine) if (node.isNew) onGrowthComplete(node.id);
  }, [isPaused, onGrowthComplete, spine]);

  return (
    <>
    <svg
      ref={svgRef}
      data-testid="tree-canvas"
      role="img"
      aria-label="Tree map: a main timeline spine with curved branches growing forward from each node"
      className={`itl-canvas absolute inset-0 h-full w-full select-none touch-none ${className} ${claimView ? 'claim-view' : ''} ${
        isDragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
      onPointerDown={(e) => {
        dragRef.current = {
          x: e.clientX,
          y: e.clientY,
          vx: viewRef.current.x,
          vy: viewRef.current.y,
        };
        dragMovedRef.current = false;
        goalRef.current = null;
      }}
      onClick={(event) => {
        if (!dragMovedRef.current && event.target === svgRef.current) onSetFocus(null);
      }}
    >
      <defs>
        <radialGradient id="node-halo-active" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#247c78" stopOpacity="0.14" />
          <stop offset="48%" stopColor="#d1a900" stopOpacity="0.11" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="node-halo-idle" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#aeb8b1" stopOpacity="0.13" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Living Tree ambient deep-sky starlight */}
      <g aria-hidden="true" className="pointer-events-none ambient-stars">
        {ambientStars.map((star, idx) => (
          <circle
            key={idx}
            cx={`${star.xPct}%`}
            cy={`${star.yPct}%`}
            r={star.r}
            fill="#dce8ff"
            opacity={star.opacity}
            className="twinkle-dot"
            style={{ animationDelay: `${star.delay}s` }}
          />
        ))}
      </g>

      <g
        ref={worldRef}
        id="world"
        className={[isFocusing ? 'focusing' : '', isCiting ? 'citing' : ''].filter(Boolean).join(' ') || undefined}
      >
        {/* Living Tree horizon particle scatter + neural waveform envelope & harmonic arcs */}
        <g aria-hidden="true" className="spine-layer">
          <g className="spine-decorations">
          {spineSynapses.arcs.map((arc, idx) => (
            <path
              key={`arc-${idx}`}
              d={arc.pathD}
              fill="none"
              stroke={arc.color}
              strokeWidth={0.85}
              opacity={arc.opacity}
            />
          ))}

          {spineSynapses.ticks.map((tick, idx) => (
            <line
              key={`tick-${idx}`}
              x1={tick.x}
              y1={-tick.halfHeight}
              x2={tick.x}
              y2={tick.halfHeight}
              stroke={tick.color}
              strokeWidth={1}
              strokeLinecap="round"
              opacity={tick.opacity}
            />
          ))}

          {groundParticles.map((dot, idx) => (
            <circle
              key={idx}
              cx={dot.x}
              cy={dot.y}
              r={dot.r}
              fill={dot.color}
              opacity={dot.opacity}
              className={
                dot.twinkleDelay !== undefined ? 'twinkle-dot' : undefined
              }
              style={
                dot.twinkleDelay !== undefined
                  ? { animationDelay: `${dot.twinkleDelay}s` }
                  : undefined
              }
            />
          ))}
          </g>

          {/* Spine: soft glow band, gradient line (start -> end of the story), light highlight
              and a slow flowing shimmer; gradients in user space (a horizontal line has no height). */}
          <defs>
            <linearGradient id="spine-gradient" gradientUnits="userSpaceOnUse" x1={-100} y1={0} x2={totalSpineWidth + 152} y2={0}>
              <stop offset="0%" stopColor="#5fa591" stopOpacity={0} />
              <stop offset="5%" stopColor="#5fa591" />
              <stop offset="55%" stopColor="#5f86b5" />
              <stop offset="100%" stopColor="#c9924f" />
            </linearGradient>
          </defs>
          <line className="spine-glow" x1={-100} y1={0} x2={totalSpineWidth + 130} y2={0} stroke="url(#spine-gradient)" strokeWidth={14} strokeLinecap="round" opacity={0.13} />
          <line className="spine-line" x1={-100} y1={0} x2={totalSpineWidth + 132} y2={0} stroke="url(#spine-gradient)" strokeWidth={3.2} strokeLinecap="round" />
          <line className="spine-highlight" x1={-60} y1={-0.8} x2={totalSpineWidth + 120} y2={-0.8} stroke="#ffffff" strokeWidth={0.9} strokeLinecap="round" opacity={0.55} />
          <line className="spine-flow" x1={-60} y1={0} x2={totalSpineWidth + 120} y2={0} stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round" strokeDasharray="2 34" opacity={0.75} />
          <path
            className="spine-arrow"
            d={`M${totalSpineWidth + 126},-7 L${totalSpineWidth + 148},0 L${totalSpineWidth + 126},7 Q${totalSpineWidth + 130},0 ${totalSpineWidth + 126},-7 Z`}
            fill="#c9924f"
          />
        </g>
        {researching && spine.length > 0 && <g className={`research-frontier${isPaused ? ' is-static' : ''}`} transform={`translate(${totalSpineWidth + 42} 0)`} role="status" aria-label="Researching sources">
          <line x1={-32} y1={0} x2={-10} y2={0} />
          <circle r={4} />
          <text x={10} y={4}>Researching sources…</text>
        </g>}

        {/* Unverified lane: pending claims, visually separated from established ones */}
        {(() => {
          const pending = spineGeometries.filter((g) => g.laneY);
          if (!pending.length) return null;
          const x1 = Math.min(...pending.map((g) => g.cx)) - 90;
          const x2 = Math.max(...pending.map((g) => g.cx + 64 + Math.max(0, g.branches.length - 1) * ORIGIN_STEP)) + 60;
          return (
            <g className="unverified-lane" aria-hidden="true">
              <line x1={x1} y1={UNVERIFIED_LANE_Y} x2={x2} y2={UNVERIFIED_LANE_Y} stroke="#8b9baa" strokeWidth={1.5} strokeDasharray="6 7" opacity={0.55} />
              <text className="lane-label" x={x1} y={UNVERIFIED_LANE_Y - 14}>UNVERIFIED · awaiting corroboration</text>
              {laneNote && <text className="lane-label lane-note" x={x2 + 12} y={UNVERIFIED_LANE_Y + 4}>{laneNote}</text>}
            </g>
          );
        })()}

        {/* Claim links: neutral, labelled connections between claims (never causal claims) */}
        {links.length > 0 && (() => {
          const at = new Map(spineGeometries.map((g) => [g.node.id, { x: g.cx, y: g.laneY }]));
          const minY = Math.min(...spineGeometries.filter((g) => !g.laneY).flatMap((g) => g.branches.map((b) => b.geometry.tip.y)), -60);
          return links.map((link, i) => {
            const a = at.get(link.from);
            const b = at.get(link.to);
            if (!a || !b) return null;
            const apex = minY - 70 - (i % 3) * 34;
            const mid = (a.x + b.x) / 2;
            const label = `${link.type === 'potential_inconsistency' ? 'possible inconsistency' : link.type.replace('_', '-')} · ${link.basis.replace('_', ' ')}`;
            return (
              <g key={`${link.from}-${link.to}-${link.type}`} className={`claim-link link-${link.type} basis-${link.basis}`}>
                <title>{link.description}</title>
                <path d={`M${a.x},${a.y - 22} C${a.x},${apex} ${b.x},${apex} ${b.x},${b.y - 22}`} fill="none" />
                <text x={mid} y={apex + 26} textAnchor="middle">{label}</text>
              </g>
            );
          });
        })()}

        {/* Spine nodes and their forward-growing branches */}
        {spineGeometries.map(
          ({ node, cx, laneY, accent, lensParticles, branches }, spineIdx) => {
            const isSelected = spineIdx === selectedIndex;
            const isGroupOn =
              focusTarget !== null && focusTarget.spineIndex === spineIdx;
            const isNodeHot =
              isGroupOn && focusTarget?.branchIndex === undefined;
            const nodeNum = String(spineIdx + 1).padStart(2, '0');
            const isNodeCited =
              isCiting &&
              (highlight!.eventIds.has(node.id) || node.branches.some((b) => highlight!.evidenceIds.has(b.id)));
            const eventRevealDelay = node.isNew
              ? Math.max(0, ...branches.filter(({ branch }) => branch.isNew).map(({ geometry }, index) => Math.min(index * 0.1, 0.3) + Math.min(1.6, Math.max(0.9, geometry.approxLength / 320))))
              : 0;

            return (
              <g
                key={node.id}
                className={`tree-group ${isGroupOn ? 'on' : ''} ${
                  isSelected ? 'sel' : ''
                } ${isNodeCited ? 'cited' : ''} ${node.pending ? 'pending' : ''} ${node.disputed ? 'disputed' : ''} ${node.live ? `live-${node.live}` : ''}`}
                transform={laneY ? `translate(0 ${laneY})` : undefined}
              >
                {/* Added by live tracking: pulse rings + badge (fresh), quiet badge afterwards (recent) */}
                {node.live && (
                  <g className="live-node" aria-label={node.live === 'fresh' ? 'Just added by live tracking' : 'Recently added by live tracking'}>
                    <circle className="live-node-glow" cx={cx} cy={0} r={30} />
                    {node.live === 'fresh' && [0, 0.7, 1.4].map((d) => (
                      <circle key={d} className="live-node-ring" cx={cx} cy={0} r={26} style={{ animationDelay: `${d}s` }} />
                    ))}
                    <g transform={`translate(${cx} ${-50})`}><g className="live-badge">
                      <rect className="live-badge-bg" x={node.live === 'fresh' ? -38 : -42} y={-9} width={node.live === 'fresh' ? 76 : 84} height={16} rx={8} />
                      <circle className="live-badge-dot" cx={node.live === 'fresh' ? -28 : -32} cy={-1} r={3} />
                      <text className="live-badge-text" x={4} y={3} textAnchor="middle">{node.live === 'fresh' ? 'NEW · LIVE' : 'LIVE UPDATE'}</text>
                    </g></g>
                  </g>
                )}
                {node.disputed && <circle className="disputed-ring" cx={cx} cy={0} r={27} fill="none" />}
                {node.flags && (
                  <g className="node-flags">
                    <RedFlag x={cx + 22} y={-14} size={1.2} />
                    {node.flags.count > 1 && <text className="node-flag-count" x={cx + 38} y={-26}>{node.flags.count}</text>}
                  </g>
                )}
                {(node.unverified || (node.pending && !claimView)) && <text className="pending-badge" x={cx} y={42} textAnchor="middle">UNVERIFIED</text>}
                {node.outcome && (
                  <text className={`outcome-badge outcome-${node.outcome}`} x={cx} y={node.pending || node.unverified ? 55 : 42} textAnchor="middle">
                    {node.outcome === 'no_update' ? 'NO UPDATE YET' : node.outcome.replace('_', ' ').toUpperCase()}
                  </text>
                )}
                {/* Date ticks: where each article meets the timeline; sparse labels in one row below the line */}
                {branches.map(({ branch, tick }) => (
                  <g key={`tick-${branch.id}`} className="date-tick" aria-hidden="true">
                    <line x1={tick.x} x2={tick.x} y1={-3} y2={3} stroke="#d1bd91" strokeWidth={1} opacity={0.35} />
                    {tick.show && (
                      <>
                        <line x1={tick.x} x2={tick.x} y1={3} y2={10} stroke="#d1bd91" strokeWidth={1} opacity={0.35} />
                        <text className="date-tick-label" x={tick.x} y={21} textAnchor="middle">
                          {tick.label}
                        </text>
                      </>
                    )}
                  </g>
                ))}
                {branches.map(({ branch, geometry }, branchIdx) => (
                  <BranchView
                    key={branch.id}
                    branch={branch}
                    geometry={geometry}
                    eventId={node.id}
                    growthDelay={branch.isNew ? Math.min(branchIdx * 0.1, 0.3) : 0}
                    spineIndex={spineIdx}
                    branchIndex={branchIdx}
                    accent={accent}
                    isGroupFocused={isGroupOn}
                    isTipHot={
                      isGroupOn && focusTarget?.branchIndex === branchIdx
                    }
                    isCited={isCiting && highlight!.evidenceIds.has(branch.id)}
                    role={isCiting ? highlight!.roles?.get(branch.id) : undefined}
                    isPaused={isPaused}
                    dragMovedRef={dragMovedRef}
                    onSelectBranch={onSelectBranch}
                    onSetFocus={onSetFocus}
                    onGrowthComplete={onGrowthComplete}
                    showHeading={headingTip?.s === spineIdx && headingTip.b === branchIdx}
                    showAllHeadings={showAllHeadings}
                    onHeadingHover={(on) => setHeadingTip((cur) => (on ? { s: spineIdx, b: branchIdx } : cur?.s === spineIdx && cur.b === branchIdx ? null : cur))}
                  />
                ))}

                {(() => {
                  const hot = headingTip?.s === spineIdx ? branches[headingTip.b] : undefined;
                  return hot?.branch.fullName ? <TipHeadingOverlay branch={hot.branch} geometry={hot.geometry} /> : null;
                })()}

                {/* Main spine node: hybrid of Tree Map numbered instrument coin & Living Tree particle lens */}
                <g
                  data-card-anchor={`event:${node.id}`}
                  className={`node-group ${isNodeHot ? 'hot' : ''} ${node.isNew && !isPaused ? 'new-event' : ''}`}
                  style={node.isNew && !isPaused ? { animationDelay: `${eventRevealDelay}s` } : undefined}
                  onAnimationEnd={(event) => {
                    if (event.target === event.currentTarget && node.isNew) onGrowthComplete(node.id);
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={node.name}
                  transform={`translate(${cx} 0)`}
                  onMouseEnter={() => onSetFocus({ spineIndex: spineIdx })}
                  onMouseLeave={() => onSetFocus(null)}
                  onFocus={() => onSetFocus({ spineIndex: spineIdx })}
                  onBlur={() => onSetFocus(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!dragMovedRef.current) {
                      onSelectNode(spineIdx);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectNode(spineIdx);
                    }
                  }}
                >
                  {/* Soft focal atmospheric glow behind optical lens */}
                  <circle
                    cx={0}
                    cy={0}
                    r={isSelected || isNodeHot ? 54 : 38}
                    fill={
                      isSelected || isNodeHot
                       ? 'url(#node-halo-active)'
                        : 'url(#node-halo-idle)'
                    }
                    aria-hidden="true"
                  />

                  <circle className="selection-ring" cx={0} cy={0} r={34} fill="none" aria-hidden="true" />

                  {/* Outer vintage instrument calibration reticle */}
                  <circle
                    cx={0}
                    cy={0}
                    r={28}
                    fill="none"
                    stroke={isNodeHot ? '#8b6900' : 'rgba(104, 116, 110, 0.42)'}
                    strokeWidth={1}
                    strokeDasharray="1.5 5"
                    aria-hidden="true"
                  />

                  {/* Soft depth shadow */}
                  <circle
                    cx={2}
                    cy={3}
                    r={22}
                    fill="rgba(31, 43, 36, 0.12)"
                    aria-hidden="true"
                  />

                  <g className="node-bob">
                    <g className="node-coin">
                      {/* Outer warm brass bezel */}
                      <circle
                        cx={0}
                        cy={0}
                        r={22}
                        fill="#ffffff"
                        stroke="#7c8981"
                        strokeWidth={1.4}
                      />
                      {/* Inner accent ring */}
                      <circle
                        cx={0}
                        cy={0}
                        r={17.5}
                        fill="#f3f5f2"
                        stroke={isNodeHot ? '#8b6900' : accent}
                        strokeWidth={1.6}
                      />

                      {/* Living Tree particle stipple inside the dark optical lens */}
                      <g aria-hidden="true" className="node-lens-texture">
                        {lensParticles.map((dot, dotIdx) => (
                          <circle
                            key={dotIdx}
                            cx={dot.x}
                            cy={dot.y}
                            r={dot.r}
                            fill={dot.color}
                            opacity={dot.opacity}
                          />
                        ))}
                      </g>

                      {/* Crisp tabular index number */}
                      <text
                        y={4.5}
                        textAnchor="middle"
                        className="font-mono-tabular pointer-events-none text-[12px] font-semibold"
                        fill="#29332e"
                        style={{
                          paintOrder: 'stroke',
                          stroke: '#ffffff',
                          strokeWidth: '2px',
                          strokeLinejoin: 'round',
                        }}
                      >
                        {nodeNum}
                      </text>
                    </g>
                  </g>

                  {/* Retro drafting corner calibration reticles on hover/focus */}
                  <g className="node-spark" aria-hidden="true">
                    {[
                      [29, -29],
                      [36, 0],
                      [-29, 29],
                      [-36, 0],
                    ].map(([sx, sy], idx) => (
                      <circle
                        key={idx}
                        cx={sx}
                        cy={sy}
                        r={2.2}
                        fill="#d1bd91"
                      />
                    ))}
                  </g>

                  {/* Hit target */}
                  <circle className="fill-transparent" r={35} />
                  <circle className="keyboard-focus-ring" r={29} fill="none" />

                  {/* Main node title */}
                  <text
                    className="main-label"
                    fill="#f5f2e8"
                    x={-42}
                    y={-13 - (wrapLabel(node.name, 26, TITLE_MAX_LINES).length - 1) * 13}
                    textAnchor="end"
                  >
                    {wrapLabel(node.name, 26, TITLE_MAX_LINES).map((line, li) => (
                      <tspan key={li} x={-42} dy={li ? 13 : 0}>{line}</tspan>
                    ))}
                  </text>
                </g>
                {/* Drawn last so the hover card sits above this node's branches */}
                {node.flags && isNodeHot && <FlagTooltip lines={node.flags.lines} x={cx + 30} y={-36} />}
              </g>
            );
          }
        )}
      </g>
    </svg>
    {(['left', 'right'] as const).map((side) => {
      const dir = side === 'left' ? -1 : 1;
      return (
        <button
          key={side}
          type="button"
          className={`edge-scroll edge-${side} ${edges[side] ? 'can' : ''}`}
          aria-label={side === 'left' ? 'Scroll graph left (earlier)' : 'Scroll graph right (later)'}
          tabIndex={edges[side] ? 0 : -1}
          onPointerEnter={steer(dir)}
          onPointerMove={steer(dir)}
          onPointerDown={(e) => { e.stopPropagation(); steer(dir)(e); edgeRef.current.strength = 1; }}
          onPointerUp={steer(dir)}
          onPointerLeave={release}
          onPointerCancel={release}
          onBlur={release}
          onClick={(e) => { if (e.detail === 0) jump(dir); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); jump(-1); }
            if (e.key === 'ArrowRight') { e.preventDefault(); jump(1); }
          }}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d={side === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      );
    })}
    </>
  );
}
