import type { ViewTransform } from '../types/tree';

export function zoomViewAtWheel(
  view: ViewTransform,
  deltaY: number,
  pointer: { x: number; y: number },
  bounds: { left: number; top: number },
): ViewTransform {
  const px = pointer.x - bounds.left;
  const py = pointer.y - bounds.top;
  const k = Math.max(0.14, Math.min(3, view.k * Math.exp(-deltaY * 0.0015)));
  const scale = k / view.k;
  return { x: px - (px - view.x) * scale, y: py - (py - view.y) * scale, k };
}
