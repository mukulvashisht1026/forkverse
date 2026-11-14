import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  BranchGeometry,
  BranchItem,
  FocusTarget,
  SpineNode,
  ViewTransform,
} from '../types/tree';
import {
  computeBranchProgress,
  computeFitTransform,
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

interface TreeCanvasProps {
  spine: SpineNode[];
  selectedIndex: number;
  focusTarget: FocusTarget | null;
  isPaused: boolean;
  className?: string;
  fitRequest: { id: number; instant: boolean };
  onSelectNode: (index: number) => void;
  onSetFocus: (target: FocusTarget | null) => void;
  onBranchGrowthComplete: (spineIndex: number, branchId: string) => void;
  onContinue: () => void;
  isContinuing: boolean;
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
  spineIndex: number;
  branchIndex: number;
  accent: string;
  isGroupFocused: boolean;
  isTipHot: boolean;
  isCited: boolean;
  role?: string;
  isPaused: boolean;
  dragMovedRef: React.RefObject<boolean>;
  onSelectNode: (index: number) => void;
  onSetFocus: (target: FocusTarget | null) => void;
  onGrowthComplete: (spineIndex: number, branchId: string) => void;
}

function BranchView({
  branch,
  geometry,
  spineIndex,
  branchIndex,
  accent,
  isGroupFocused,
  isTipHot,
  isCited,
  role,
  isPaused,
  dragMovedRef,
  onSelectNode,
  onSetFocus,
  onGrowthComplete,
}: BranchViewProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const penRef = useRef<SVGCircleElement>(null);
  const tipGroupRef = useRef<SVGGElement>(null);
  const mistGroupRef = useRef<SVGGElement>(null);
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

      tipEl.classList.toggle('on', state.tipVisible);
      mistEl.style.opacity = state.tipVisible ? '1' : String(state.eased * 0.65);
    };

    if (!shouldAnimate) {
      applyProgress(1);
      if (branch.isNew && isPaused) {
        onGrowthComplete(spineIndex, branch.id);
      }
      return;
    }

    const duration = Math.max(3.2, geometry.approxLength / 58);
    let progress = 0;
    let lastTime = performance.now();
    let rafId = 0;
    let cancelled = false;

    applyProgress(0);

    const step = (now: number) => {
      if (cancelled) return;
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      progress = Math.min(1, progress + dt / duration);
      applyProgress(progress);

      if (progress < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        setBurstKey((k) => k + 1);
        onGrowthComplete(spineIndex, branch.id);
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
    geometry.approxLength,
    isPaused,
    onGrowthComplete,
    spineIndex,
  ]);

  const targetFocus: FocusTarget = { spineIndex, branchIndex };

  return (
    <g className={`branch ${isCited ? 'cited' : ''} ${role ? `role-${role}` : ''}`} transform={`translate(${geometry.points[0].x} ${geometry.points[0].y}) scale(${geometry.depthScale}) translate(${-geometry.points[0].x} ${-geometry.points[0].y})`}>
      {/* Living-Tree mist stipple + neural-scan tangent filaments & micro-dendrites */}
      <g ref={mistGroupRef} style={{ transition: 'opacity 0.35s ease' }}>
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
        stroke={isGroupFocused ? accent : '#8e99ad'}
        opacity={isGroupFocused ? 0.28 : 0.14}
        strokeWidth={isGroupFocused ? 3 : 2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transition: 'stroke 0.2s ease, stroke-width 0.2s ease' }}
      />
      <g className={`branch-current${isPaused ? ' paused' : ''}`} aria-hidden="true">
        <path d={geometry.pathD} fill="none" stroke={accent} strokeWidth="5.5" strokeLinecap="round" opacity="0.12" />
        <path d={geometry.pathD} fill="none" stroke={accent} strokeWidth="2.2" strokeLinecap="round" strokeDasharray="34 1100" className="branch-current-trail" style={{ animationDelay: `${(spineIndex * 0.83 + branchIndex * 1.37) % 7}s` }} />
        <path d={geometry.pathD} fill="none" stroke="#f5f2e8" strokeWidth="0.9" strokeLinecap="round" strokeDasharray="10 1100" className="branch-current-core" style={{ animationDelay: `${(spineIndex * 0.83 + branchIndex * 1.37) % 7}s` }} />
      </g>

      {/* Glowing pen dot during live branch growth */}
      <circle ref={penRef} className="pen-dot" r={5.5} />

      {/* Concentric completion burst rings */}
      {burstKey > 0 && (
        <g key={burstKey}>
          {[0, 0.28].map((delay, idx) => (
            <circle
              key={idx}
              className="burst-ring"
              cx={geometry.tip.x}
              cy={geometry.tip.y}
              r={8}
              fill="none"
              stroke={accent}
              strokeWidth={2}
              style={{ animationDelay: `${delay}s` }}
            />
          ))}
        </g>
      )}

      {/* Interactive branch tip node */}
      <g
        ref={tipGroupRef}
        className={`tip-group ${!branch.isNew ? 'on' : ''} ${isTipHot ? 'hot' : ''}`}
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
            onSelectNode(spineIndex);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectNode(spineIndex);
          }
        }}
      >
        <circle
          className="tip-core"
          r={7.5}
          fill="#060d1f"
          stroke={isTipHot ? '#f5f2e8' : accent}
          strokeWidth={2.6}
        />
        <circle className="fill-transparent" r={22} />
        <text
          className="tip-label"
          fill="#ffffff"
          y={geometry.dir < 0 ? -17 : 29}
          textAnchor="middle"
        >
          {branch.name}
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
  fitRequest,
  onSelectNode,
  onSetFocus,
  onBranchGrowthComplete,
  onContinue,
  isContinuing,
  className = '',
  highlight = null,
}: TreeCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);

  const viewRef = useRef<ViewTransform>({ k: 1, x: 0, y: 0 });
  const goalRef = useRef<ViewTransform | null>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    vx: number;
    vy: number;
  } | null>(null);
  const dragMovedRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const ambientStars = useMemo(() => generateAmbientStars(68, 1979), []);
  // Timeline layout: event nodes spaced so their articles fit along the line, in date order.
  const layout = useMemo(() => computeSpineLayout(spine.map((n) => n.branches.length)), [spine]);
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
    return spine.map((node, spineIdx) => {
      const cx = layout.nodeX[spineIdx] ?? spineIdx * SPINE_GAP;
      const accent = NODE_ACCENTS[spineIdx % NODE_ACCENTS.length];
      const lensParticles = generateLensParticles(spineIdx * 53 + 11, 14.5, 42);
      // Each article sprouts from its own point on the line, ordered by publish date,
      // alternating above (-1) and below (+1) the line.
      const rank = branchOrder(node.branches.map((b) => b.publishedAt));
      const branches = node.branches.map((b, branchIdx) => {
        const pos = rank[branchIdx] ?? branchIdx;
        const originX = (layout.originStart[spineIdx] ?? cx) + pos * ORIGIN_STEP;
        const dir: 1 | -1 = pos % 2 ? 1 : -1;
        return {
          branch: b,
          tick: { x: originX, dir, label: tickLabel(b.publishedAt) },
          geometry: generateBranchGeometry(cx, dir, Math.floor(pos / 2), b.seed, accent, originX),
        };
      });
      return { node, cx, accent, lensParticles, branches };
    });
  }, [spine, layout]);

  const applyViewToDom = () => {
    const world = worldRef.current;
    if (!world) return;
    const { x, y, k } = viewRef.current;
    world.setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
  };

  const triggerFit = (instant: boolean) => {
    const svg = svgRef.current;
    const world = worldRef.current;
    if (!svg || !world) return;
    // SVG elements may report empty dimensions while graph data is still rendering.
    const bbox = world.getBBox();
    if (!bbox.width || !bbox.height) return;
    const nextGoal = computeFitTransform(
      bbox,
      svg.clientWidth,
      svg.clientHeight
    );
    if (instant) {
      viewRef.current = nextGoal;
      goalRef.current = null;
      applyViewToDom();
    } else {
      goalRef.current = nextGoal;
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
    let rafId = 0;
    const tick = () => {
      const goal = goalRef.current;
      if (goal) {
        if (isPaused) {
          viewRef.current = { ...goal };
          goalRef.current = null;
          applyViewToDom();
        } else {
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
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
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
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const v = viewRef.current;
      const nextK = Math.max(
        0.14,
        Math.min(3, v.k * Math.exp(-e.deltaY * 0.0015))
      );
      const scale = nextK / v.k;
      v.x = px - (px - v.x) * scale;
      v.y = py - (py - v.y) * scale;
      v.k = nextK;
      goalRef.current = null;
      applyViewToDom();
    };
    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, []);

  const totalSpineWidth = layout.end;
  const isFocusing = focusTarget !== null;
  const isCiting = Boolean(highlight && (highlight.evidenceIds.size > 0 || highlight.eventIds.size > 0));

  return (
    <svg
      ref={svgRef}
      data-testid="tree-canvas"
      role="img"
      aria-label="Tree map: a main timeline spine with curved branches growing forward from each node"
      className={`itl-canvas absolute inset-0 h-full w-full select-none touch-none ${className} ${
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
      onClick={() => {
        if (!dragMovedRef.current) {
          onSetFocus(null);
        }
      }}
    >
      <defs>
        <radialGradient id="node-halo-active" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#5fc2b4" stopOpacity="0.34" />
          <stop offset="48%" stopColor="#d1bd91" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#050b1b" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="node-halo-idle" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#d1bd91" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#050b1b" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Living Tree ambient deep-sky starlight */}
      <g aria-hidden="true" className="pointer-events-none">
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

          {/* Retro-tech ruled baseline & marching calibration ties */}
          <line
            x1={-100}
            y1={5}
            x2={totalSpineWidth + 124}
            y2={5}
            stroke="rgba(209, 189, 145, 0.2)"
            strokeWidth={1}
          />
          <line
            x1={-100}
            y1={0}
            x2={totalSpineWidth + 132}
            y2={0}
            stroke="#d1bd91"
            opacity={0.42}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          <line
            className="ties-march"
            x1={-100}
            y1={0}
            x2={totalSpineWidth + 114}
            y2={0}
            stroke="#d1bd91"
            strokeWidth={11}
            strokeDasharray="2 14"
            opacity={0.28}
          />
          <path
            d={`M${totalSpineWidth + 128},-8.5 L${totalSpineWidth + 152},0 L${totalSpineWidth + 128},8.5 Z`}
            fill="#d1bd91"
          />
        </g>
        <g
          className="continuation-control"
          style={{ cursor: isContinuing ? 'wait' : 'pointer' }}
          transform={`translate(${totalSpineWidth + 174} 0)`}
          role="button"
          tabIndex={0}
          aria-label={isContinuing ? 'Researching next event' : 'Continue research with next event'}
          aria-disabled={isContinuing}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); if (!isContinuing) onContinue(); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault(); event.stopPropagation(); if (!isContinuing) onContinue();
            }
          }}
        >
          <circle r={21} fill="rgba(5,11,27,.82)" stroke="#d1bd91" strokeOpacity={0.7} />
          {isContinuing ? <path d="M-5,-7 L5,0 L-5,7" fill="none" stroke="#fff" strokeWidth={2.5} /> : <path d="M-7,0 H7 M2,-5 L7,0 L2,5" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
        </g>

        {/* Spine nodes and their forward-growing branches */}
        {spineGeometries.map(
          ({ node, cx, accent, lensParticles, branches }, spineIdx) => {
            const isSelected = spineIdx === selectedIndex;
            const isGroupOn =
              focusTarget !== null && focusTarget.spineIndex === spineIdx;
            const isNodeHot =
              isGroupOn && focusTarget?.branchIndex === undefined;
            const nodeNum = String(spineIdx + 1).padStart(2, '0');
            const isNodeCited =
              isCiting &&
              (highlight!.eventIds.has(node.id) || node.branches.some((b) => highlight!.evidenceIds.has(b.id)));

            return (
              <g
                key={node.id}
                className={`tree-group ${isGroupOn ? 'on' : ''} ${
                  isSelected ? 'sel' : ''
                } ${isNodeCited ? 'cited' : ''}`}
              >
                {/* Date ticks: where each article meets the timeline (label on the side opposite its branch) */}
                {branches.map(({ branch, tick }) => (
                  <g key={`tick-${branch.id}`} className="date-tick" aria-hidden="true">
                    <line x1={tick.x} x2={tick.x} y1={-5} y2={5} stroke="#d1bd91" strokeWidth={1} opacity={0.55} />
                    {tick.label && (
                      <text className="date-tick-label" x={tick.x} y={tick.dir < 0 ? 17 : -9} textAnchor="middle">
                        {tick.label}
                      </text>
                    )}
                  </g>
                ))}
                {branches.map(({ branch, geometry }, branchIdx) => (
                  <BranchView
                    key={branch.id}
                    branch={branch}
                    geometry={geometry}
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
                    onSelectNode={onSelectNode}
                    onSetFocus={onSetFocus}
                    onGrowthComplete={onBranchGrowthComplete}
                  />
                ))}

                {/* Main spine node: hybrid of Tree Map numbered instrument coin & Living Tree particle lens */}
                <g
                  className={`node-group ${isNodeHot ? 'hot' : ''}`}
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

                  {/* Selection sonar pulse rings */}
                  <g aria-hidden="true">
                    {[0, 0.6, 1.2].map((delay, ringIdx) => (
                      <circle
                        key={ringIdx}
                        className="sonar-ring"
                        cx={0}
                        cy={0}
                        r={25 + ringIdx * 5}
                        style={{ animationDelay: `${delay}s` }}
                      />
                    ))}
                  </g>

                  {/* Outer vintage instrument calibration reticle */}
                  <circle
                    cx={0}
                    cy={0}
                    r={28}
                    fill="none"
                    stroke={isNodeHot ? '#5fc2b4' : 'rgba(209, 189, 145, 0.34)'}
                    strokeWidth={1}
                    strokeDasharray="1.5 5"
                    aria-hidden="true"
                  />

                  {/* Soft depth shadow */}
                  <circle
                    cx={2}
                    cy={3}
                    r={22}
                    fill="rgba(2, 4, 10, 0.65)"
                    aria-hidden="true"
                  />

                  <g className="node-bob">
                    <g className="node-coin">
                      {/* Outer warm brass bezel */}
                      <circle
                        cx={0}
                        cy={0}
                        r={22}
                        fill="#060d1f"
                        stroke="#d1bd91"
                        strokeWidth={1.6}
                      />
                      {/* Inner accent ring */}
                      <circle
                        cx={0}
                        cy={0}
                        r={17.5}
                        fill="#09132b"
                        stroke={isNodeHot ? '#ff9a4d' : accent}
                        strokeWidth={2.2}
                      />

                      {/* Living Tree particle stipple inside the dark optical lens */}
                      <g aria-hidden="true">
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
                        fill="#ffffff"
                        style={{
                          paintOrder: 'stroke',
                          stroke: '#060d1f',
                          strokeWidth: '3.5px',
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

                  {/* Main node title */}
                  <text
                    className="main-label"
                    fill="#f5f2e8"
                    x={-34}
                    y={-18}
                    textAnchor="end"
                  >
                    {node.name}
                  </text>
                </g>
              </g>
            );
          }
        )}
      </g>
    </svg>
  );
}
