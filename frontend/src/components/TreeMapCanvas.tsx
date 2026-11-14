import { useEffect, useRef } from 'react';
import type { BranchSourceType, FocusTarget, SpineNode } from '../types/tree';
import {
  buildSpineLayout,
  computeFitView,
  FALL_DISTANCE,
  hitTestWorld,
  screenToWorld,
  type Particle,
  type SpineLayout,
  type ViewTransform,
} from '../utils/treeMath';

interface TreeMapCanvasProps {
  spine: SpineNode[];
  selectedIndex: number;
  focus: FocusTarget | null;
  moving: boolean;
  fitSignal: number;
  onHoverTarget: (target: FocusTarget | null) => void;
  onSelectTarget: (target: FocusTarget) => void;
  onClearPin: () => void;
}

function createTintedGlow(innerRgba: string, outerRgba: string): HTMLCanvasElement {
  const glow = document.createElement('canvas');
  glow.width = 64;
  glow.height = 64;
  const g = glow.getContext('2d');
  if (g) {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.28, innerRgba);
    gr.addColorStop(1, outerRgba);
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  }
  return glow;
}

export function TreeMapCanvas({
  spine,
  selectedIndex,
  focus,
  moving,
  fitSignal,
  onHoverTarget,
  onSelectTarget,
  onClearPin,
}: TreeMapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const layoutRef = useRef<SpineLayout>(buildSpineLayout(spine));
  const spineRef = useRef<SpineNode[]>(spine);
  const selectedRef = useRef<number>(selectedIndex);
  const focusRef = useRef<FocusTarget | null>(focus);
  const movingRef = useRef<boolean>(moving);

  const callbacksRef = useRef({ onHoverTarget, onSelectTarget, onClearPin });
  callbacksRef.current = { onHoverTarget, onSelectTarget, onClearPin };

  const viewRef = useRef<ViewTransform>({ k: 1, x: 0, y: 0 });
  const goalRef = useRef<ViewTransform | null>(null);
  const groundDimRef = useRef<number>(1);
  const timeRef = useRef<number>(0);
  const hasFittedOnceRef = useRef<boolean>(false);

  useEffect(() => {
    spineRef.current = spine;
    layoutRef.current = buildSpineLayout(spine);
    const canvas = canvasRef.current;
    if (canvas && !hasFittedOnceRef.current) {
      hasFittedOnceRef.current = true;
      const cw = canvas.clientWidth || window.innerWidth;
      const ch = canvas.clientHeight || window.innerHeight;
      viewRef.current = computeFitView(layoutRef.current.bounds, cw, ch);
      goalRef.current = null;
    }
  }, [spine]);

  useEffect(() => {
    selectedRef.current = selectedIndex;
  }, [selectedIndex]);

  useEffect(() => {
    focusRef.current = focus;
  }, [focus]);

  useEffect(() => {
    movingRef.current = moving;
  }, [moving]);

  useEffect(() => {
    if (fitSignal === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cw = canvas.clientWidth || window.innerWidth;
    const ch = canvas.clientHeight || window.innerHeight;
    goalRef.current = computeFitView(layoutRef.current.bounds, cw, ch);
  }, [fitSignal]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const glowMap: Record<BranchSourceType, HTMLCanvasElement> = {
      market: createTintedGlow('rgba(255,168,94,0.72)', 'rgba(255,130,50,0)'),
      policy: createTintedGlow('rgba(235,220,145,0.68)', 'rgba(200,180,90,0)'),
      social: createTintedGlow('rgba(63,193,201,0.75)', 'rgba(63,193,201,0)'),
      news: createTintedGlow('rgba(170,218,255,0.68)', 'rgba(110,175,255,0)'),
      manual: createTintedGlow('rgba(190,225,255,0.62)', 'rgba(120,180,255,0)'),
    };

    let cw = 0;
    let ch = 0;

    const resize = () => {
      cw = canvas.clientWidth;
      ch = canvas.clientHeight;
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      if (!hasFittedOnceRef.current || fitSignal === 0) {
        viewRef.current = computeFitView(layoutRef.current.bounds, cw, ch);
        goalRef.current = null;
        hasFittedOnceRef.current = true;
      }
    };

    resize();
    window.addEventListener('resize', resize);

    let drag: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      moved: boolean;
    } | null = null;
    let pointer = { x: 0, y: 0 };

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      drag = {
        x: e.clientX,
        y: e.clientY,
        vx: viewRef.current.x,
        vy: viewRef.current.y,
        moved: false,
      };
      goalRef.current = null;
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (Math.hypot(dx, dy) > 5) drag.moved = true;
        if (drag.moved) {
          viewRef.current.x = drag.vx + dx;
          viewRef.current.y = drag.vy + dy;
          canvas.style.cursor = 'grabbing';
          callbacksRef.current.onHoverTarget(null);
          return;
        }
      }

      const [wx, wy] = screenToWorld(pointer.x, pointer.y, viewRef.current);
      const hit = hitTestWorld(wx, wy, layoutRef.current.groups);
      canvas.style.cursor = hit ? 'pointer' : 'grab';
      callbacksRef.current.onHoverTarget(hit);
    };

    const onPointerUp = () => {
      if (drag && !drag.moved) {
        const [wx, wy] = screenToWorld(pointer.x, pointer.y, viewRef.current);
        const hit = hitTestWorld(wx, wy, layoutRef.current.groups);
        if (hit) {
          callbacksRef.current.onSelectTarget(hit);
        } else {
          callbacksRef.current.onClearPin();
        }
      }
      drag = null;
      canvas.style.cursor = 'grab';
    };

    const onPointerLeave = () => {
      if (!drag) {
        callbacksRef.current.onHoverTarget(null);
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const nextK = Math.max(0.22, Math.min(3, viewRef.current.k * factor));
      const scale = nextK / viewRef.current.k;
      viewRef.current.x = px - (px - viewRef.current.x) * scale;
      viewRef.current.y = py - (py - viewRef.current.y) * scale;
      viewRef.current.k = nextK;
      goalRef.current = null;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    const drawParticles = (parts: Particle[], dim: number, drift: number) => {
      const T = timeRef.current;
      for (const p of parts) {
        if (p.br && (p.d ?? 0) > p.br.reach) continue;
        const tw = 0.6 + 0.4 * Math.sin(T * 1.6 + p.s * 3);
        const x = p.x + Math.sin(T * 0.6 + p.s) * drift;
        let y = p.y + Math.cos(T * 0.5 + p.s * 1.3) * drift;
        let a = tw * dim * (0.6 + 0.4 * Math.sin(p.s * 7));
        if (p.fall && p.ph !== undefined) {
          const f = (T * p.fall * 40 + p.ph * FALL_DISTANCE) % FALL_DISTANCE;
          y += f;
          a *= 1 - f / FALL_DISTANCE;
        }
        if (p.br && p.br.prog < 1) {
          a *= 1 + Math.max(0, 1 - (p.br.reach - (p.d ?? 0)) / 30) * 1.6;
        }
        ctx.globalAlpha = a;
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(x, y, p.r, 0, 6.283);
        ctx.fill();
      }
    };

    let rafId = 0;
    let last = performance.now();

    const frame = (now: number) => {
      rafId = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (movingRef.current) {
        timeRef.current += dt;
      }
      const T = timeRef.current;

      const goal = goalRef.current;
      const view = viewRef.current;
      if (goal) {
        view.k += (goal.k - view.k) * 0.12;
        view.x += (goal.x - view.x) * 0.12;
        view.y += (goal.y - view.y) * 0.12;
        if (
          Math.abs(goal.k - view.k) < 0.001 &&
          Math.abs(goal.x - view.x) < 0.5 &&
          Math.abs(goal.y - view.y) < 0.5
        ) {
          view.k = goal.k;
          view.x = goal.x;
          view.y = goal.y;
          goalRef.current = null;
        }
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(
        dpr * view.k,
        0,
        0,
        dpr * view.k,
        dpr * view.x,
        dpr * view.y
      );

      const activeFocus = focusRef.current;
      groundDimRef.current +=
        ((activeFocus ? 0.24 : 1) - groundDimRef.current) * 0.1;

      ctx.globalCompositeOperation = 'lighter';
      drawParticles(
        layoutRef.current.starParts,
        groundDimRef.current * 0.38,
        0.5
      );
      drawParticles(layoutRef.current.groundParts, groundDimRef.current, 1.2);

      // Subtle traveling signal pulse along the horizontal main spine
      if (layoutRef.current.groups.length > 1) {
        const lastX =
          layoutRef.current.groups[layoutRef.current.groups.length - 1].x;
        const span = lastX + 200;
        const pulseX = -100 + ((T * 95) % span);
        ctx.globalAlpha = groundDimRef.current * 0.75;
        ctx.drawImage(glowMap.news, pulseX - 18, -18, 36, 36);
      }

      ctx.textBaseline = 'alphabetic';
      ctx.font = '400 13px "Hanken Grotesk", system-ui, sans-serif';
      ctx.lineJoin = 'round';

      const currentSpine = spineRef.current;
      const selIdx = selectedRef.current;

      for (const g of layoutRef.current.groups) {
        const on = !activeFocus || activeFocus.i === g.i;
        const hotMain =
          Boolean(activeFocus) &&
          activeFocus?.i === g.i &&
          activeFocus?.j === undefined;
        g.dim += ((on ? 1 : 0.08) - g.dim) * 0.1;
        g.hot += ((hotMain ? 1.2 : 1) - g.hot) * 0.15;

        // Atmospheric radial nebula halo behind each main lens
        ctx.globalCompositeOperation = 'lighter';
        const aura = ctx.createRadialGradient(g.x, 0, 10, g.x, 0, 115);
        if (g.i === selIdx || hotMain) {
          aura.addColorStop(0, 'rgba(255, 154, 77, 0.15)');
          aura.addColorStop(1, 'rgba(255, 154, 77, 0)');
        } else {
          aura.addColorStop(0, 'rgba(91, 141, 239, 0.09)');
          aura.addColorStop(1, 'rgba(91, 141, 239, 0)');
        }
        ctx.globalAlpha = g.dim;
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(g.x, 0, 115, 0, 6.283);
        ctx.fill();

        drawParticles(g.parts, g.dim, 1.6);

        for (const o of g.orbs) {
          const curProg = o.b._prog ?? 1;
          if (curProg < 1) {
            o.b._prog = movingRef.current
              ? Math.min(1, curProg + dt / o.dur)
              : 1;
          }
          if (o.b._animateGrowth && (o.b._prog ?? 1) >= 1) {
            o.b._animateGrowth = false;
          }
          o.prog = o.b._prog ?? 1;
          o.reach = (1 - Math.pow(1 - o.prog, 3)) * o.maxD;

          if (o.b._animateGrowth) {
            const progress = Math.max(0, Math.min(1, o.prog));
            ctx.globalAlpha = g.dim * (1 - progress) * 0.34;
            ctx.strokeStyle = o.verticalDir < 0 ? '#ff9a4d' : '#4dafb8';
            ctx.lineWidth = 1.2;
            ctx.setLineDash([4, 7]);
            ctx.beginPath();
            ctx.arc(o.x, o.y, 11 + progress * 17, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
          }

          const hotOrb =
            Boolean(activeFocus) &&
            activeFocus?.i === g.i &&
            activeFocus?.j === o.j;
          o.hot += ((hotOrb ? 1 : 0) - o.hot) * 0.15;

          const sprite = glowMap[o.b.sourceType] ?? glowMap.news;

          if (o.prog < 1 && o.limb.length > 0) {
            let front = o.limb[0];
            for (const q of o.limb) {
              if (q[2] <= o.reach) front = q;
              else break;
            }
            ctx.globalAlpha = g.dim;
            ctx.drawImage(sprite, front[0] - 24, front[1] - 24, 48, 48);
          } else if (o.prog >= 1 && o.limb.length > 2) {
            // Subtle bioluminescent energy packet flowing out along each branch
            const flow = (T * 0.35 + o.pulsePhase) % 1;
            const idx = Math.min(
              o.limb.length - 1,
              Math.floor(flow * o.limb.length)
            );
            const pt = o.limb[idx];
            ctx.globalAlpha = g.dim * (1 - flow * 0.45) * 0.72;
            ctx.drawImage(sprite, pt[0] - 11, pt[1] - 11, 22, 22);
          }

          const born = Math.max(0, (o.prog - 0.85) / 0.15);
          const sz = (28 + o.hot * 28 + Math.sin(T * 2 + o.j) * 2.2) * born;
          if (sz > 0) {
            ctx.globalAlpha = g.dim;
            ctx.drawImage(sprite, o.x - sz / 2, o.y - sz / 2, sz, sz);
          }
        }

        // Main circular lens node along the spine
        ctx.globalCompositeOperation = 'source-over';
        ctx.save();
        ctx.translate(g.x, 0);
        ctx.scale(g.hot, g.hot);
        ctx.globalAlpha = g.dim;
        ctx.fillStyle = '#03060d';
        ctx.beginPath();
        ctx.arc(0, 0, 30, 0, 6.283);
        ctx.fill();

        ctx.strokeStyle = hotMain ? '#ffffff' : 'rgba(255,255,255,0.58)';
        ctx.lineWidth = hotMain ? 3 : 1.5;
        if (hotMain) {
          ctx.shadowColor = '#8fd0ff';
          ctx.shadowBlur = 16;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, 28, 0, 6.283);
        ctx.clip();
        const rot = T * (hotMain ? 0.5 : 0.12);
        const cr = Math.cos(rot);
        const sr = Math.sin(rot);
        for (const d of g.lensDots) {
          ctx.globalAlpha =
            g.dim * (0.55 + 0.45 * Math.sin(T * 1.5 + d.s * 3));
          ctx.fillStyle = d.c;
          ctx.beginPath();
          ctx.arc(d.x * cr - d.y * sr, d.x * sr + d.y * cr, d.r, 0, 6.283);
          ctx.fill();
        }
        ctx.restore();

        if (g.i === selIdx) {
          ctx.globalAlpha = g.dim;
          ctx.strokeStyle = '#ff9a4d';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([2, 5]);
          ctx.lineDashOffset = -T * 6;
          ctx.beginPath();
          ctx.arc(0, 0, 38, 0, 6.283);
          ctx.stroke();
          ctx.setLineDash([]);

          // Subtle polar ticks indicating upward canopy & downward root flow
          ctx.strokeStyle = 'rgba(255, 154, 77, 0.45)';
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.arc(0, 0, 44, -Math.PI * 0.65, -Math.PI * 0.35);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(63, 193, 201, 0.45)';
          ctx.beginPath();
          ctx.arc(0, 0, 44, Math.PI * 0.35, Math.PI * 0.65);
          ctx.stroke();
        }
        ctx.restore();

        // Main & branch labels with subtle dark halo for crisp contrast against stems
        const nodeData = currentSpine[g.i];
        if (nodeData) {
          ctx.globalAlpha = g.dim;
          ctx.textAlign = 'center';
          ctx.strokeStyle = 'rgba(2, 4, 10, 0.9)';
          ctx.lineWidth = 4.5;
          ctx.strokeText(nodeData.name, g.x, 54);
          ctx.fillStyle = hotMain ? '#ffffff' : '#dce4f4';
          ctx.fillText(nodeData.name, g.x, 54);
        }

        for (const o of g.orbs) {
          ctx.globalAlpha = g.dim * Math.max(0, (o.prog - 0.9) / 0.1);
          ctx.textAlign = o.lean > 0 ? 'left' : 'right';
          ctx.strokeStyle = 'rgba(2, 4, 10, 0.85)';
          ctx.lineWidth = 3.5;
          ctx.strokeText(o.b.name, o.tx, o.ty);
          ctx.fillStyle = o.hot > 0.5 ? '#ffffff' : '#cfd8ea';
          ctx.fillText(o.b.name, o.tx, o.ty);
        }
      }

      ctx.globalAlpha = 1;
    };

    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      data-testid="living-tree-canvas"
      aria-label="Animated 2D living tree map. Hover main nodes or branches to inspect live impact, drag to pan, scroll to zoom."
      className="absolute inset-0 block h-full w-full cursor-grab touch-none"
    />
  );
}
