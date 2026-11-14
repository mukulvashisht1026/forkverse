import type { Point, RectLike } from './cardGeometry';

export type ChatDock = 'left' | 'right' | 'top' | 'bottom';
export interface ChatPanelLayout { position: Point; size: Pick<RectLike, 'width' | 'height'> }

/** Panel positions are Workspace-local CSS pixels; side docks use a 2px safe inset. */
export function clampWorkspacePosition(point: Point, size: Pick<RectLike, 'width' | 'height'>, workspace: Pick<RectLike, 'width' | 'height'>): Point {
  return {
    x: Math.min(Math.max(0, workspace.width - size.width), Math.max(0, point.x)),
    y: Math.min(Math.max(0, workspace.height - size.height), Math.max(0, point.y)),
  };
}

export function snapChatPosition(point: Point, size: Pick<RectLike, 'width' | 'height'>, workspace: Pick<RectLike, 'width' | 'height'>, threshold = 72): Point {
  const clamped = clampWorkspacePosition(point, size, workspace);
  if (point.x <= threshold) return { x: Math.min(2, Math.max(0, workspace.width - size.width)), y: Math.min(2, clamped.y) };
  const right = workspace.width - size.width - point.x;
  if (right <= threshold) return { x: Math.max(0, workspace.width - size.width - 2), y: Math.min(2, clamped.y) };
  return clamped;
}

export function chatDockAt(point: Point, size: Pick<RectLike, 'width' | 'height'>, workspace: Pick<RectLike, 'width' | 'height'>, threshold = 48, sideThreshold = 72): ChatDock | null {
  if (point.y <= threshold) return 'top';
  if (workspace.height - size.height - point.y <= threshold) return 'bottom';
  if (point.x <= sideThreshold) return 'left';
  if (workspace.width - size.width - point.x <= sideThreshold) return 'right';
  return null;
}

export function getChatPanelSize(workspace: Pick<RectLike, 'width' | 'height'>, dock: ChatDock | null): Pick<RectLike, 'width' | 'height'> {
  const availableWidth = Math.max(0, workspace.width - 24);
  const availableHeight = Math.max(0, workspace.height - 24);
  const free = { width: Math.min(352, availableWidth), height: Math.min(680, availableHeight) };
  if (dock === 'left' || dock === 'right') return { width: free.width, height: Math.max(0, workspace.height - 4) };
  if (dock === 'top' || dock === 'bottom') {
    return { width: Math.min(availableWidth, workspace.width * 0.6), height: Math.min(100, availableHeight) };
  }
  return free;
}

export function getChatDockLayout(dock: ChatDock, workspace: Pick<RectLike, 'width' | 'height'>): ChatPanelLayout {
  const size = getChatPanelSize(workspace, dock);
  const position = dock === 'left' ? { x: 2, y: 2 }
    : dock === 'right' ? { x: workspace.width - size.width - 2, y: 2 }
      : dock === 'top' ? { x: (workspace.width - size.width) / 2, y: 12 }
        : { x: (workspace.width - size.width) / 2, y: workspace.height - size.height - 12 };
  return { position, size };
}
