export interface RectLike { left: number; top: number; right: number; bottom: number; width: number; height: number }
export interface Point { x: number; y: number }

/** Viewport CSS pixel coordinates; SVG world transform is applied exactly once. */
export function worldToViewport(rect: Pick<RectLike, 'left' | 'top'>, world: Point, view: { x: number; y: number; k: number }): Point {
  return { x: rect.left + world.x * view.k + view.x, y: rect.top + world.y * view.k + view.y };
}

export function clampPosition(point: Point, size: Pick<RectLike, 'width' | 'height'>, bounds: RectLike): Point {
  const maxX = Math.max(bounds.left, bounds.right - size.width);
  const maxY = Math.max(bounds.top, bounds.bottom - size.height);
  return {
    x: Math.min(maxX, Math.max(bounds.left, point.x)),
    y: Math.min(maxY, Math.max(bounds.top, point.y)),
  };
}

/** Pointer displacement is in viewport CSS pixels and is added to the original window position. */
export function positionFromPointer(origin: Point, startPointer: Point, pointer: Point): Point {
  return { x: origin.x + pointer.x - startPointer.x, y: origin.y + pointer.y - startPointer.y };
}
