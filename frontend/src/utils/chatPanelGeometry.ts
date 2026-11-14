import type { Point, RectLike } from './cardGeometry';

/** Panel positions are Workspace-local CSS pixels; snaps preserve the default 12px inset. */
export function clampWorkspacePosition(point: Point, size: Pick<RectLike, 'width' | 'height'>, workspace: Pick<RectLike, 'width' | 'height'>): Point {
  return {
    x: Math.min(Math.max(0, workspace.width - size.width), Math.max(0, point.x)),
    y: Math.min(Math.max(0, workspace.height - size.height), Math.max(0, point.y)),
  };
}

export function snapChatPosition(point: Point, size: Pick<RectLike, 'width' | 'height'>, workspace: Pick<RectLike, 'width' | 'height'>, threshold = 48): Point {
  const clamped = clampWorkspacePosition(point, size, workspace);
  if (point.x <= threshold) return { x: Math.min(12, Math.max(0, workspace.width - size.width)), y: clamped.y };
  const right = workspace.width - size.width - point.x;
  if (right <= threshold) return { x: Math.max(0, workspace.width - size.width - 12), y: clamped.y };
  return clamped;
}
