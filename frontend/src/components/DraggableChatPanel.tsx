import { useEffect, useRef, useState } from 'react';
import { Grip } from 'lucide-react';
import { clampWorkspacePosition, snapChatPosition } from '../utils/chatPanelGeometry';
import { positionFromPointer } from '../utils/cardGeometry';

interface Props { workspaceRef: React.RefObject<HTMLElement | null>; children: React.ReactNode }
interface Session { pointerId: number; start: { x: number; y: number }; origin: { x: number; y: number }; moved: boolean }
const THRESHOLD = 4;

/** Full research panel window; position is always Workspace-local CSS pixels. */
export function DraggableChatPanel({ workspaceRef, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Session | null>(null);
  const [position, setPosition] = useState({ x: 12, y: 12 });

  const clamp = (point: { x: number; y: number }) => {
    const panel = panelRef.current?.getBoundingClientRect();
    const workspace = workspaceRef.current?.getBoundingClientRect();
    if (!panel || !workspace) return point;
    return clampWorkspacePosition(point, { width: panel.width, height: panel.height }, { width: workspace.width, height: workspace.height });
  };

  useEffect(() => {
    const workspace = workspaceRef.current;
    const panel = panelRef.current;
    if (!workspace || !panel) return;
    const observer = new ResizeObserver(() => setPosition((point) => clamp(point)));
    observer.observe(workspace); observer.observe(panel);
    return () => observer.disconnect();
  }, [workspaceRef]);

  const finishDrag = (pointerId: number, clientX: number, clientY: number) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== pointerId) return;
    dragRef.current = null;
    if (handleRef.current?.hasPointerCapture(pointerId)) handleRef.current.releasePointerCapture(pointerId);
    if (!session.moved) return;
    const workspace = workspaceRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!workspace || !panel) return;
    const next = positionFromPointer(session.origin, session.start, { x: clientX, y: clientY });
    setPosition(snapChatPosition(next, { width: panel.width, height: panel.height }, { width: workspace.width, height: workspace.height }));
  };

  return <div ref={panelRef} className="gh-chat-window" style={{ left: position.x, top: position.y }}>
    <div ref={handleRef} className="gh-chat-window-handle" role="group" aria-label="Drag research chat panel" onPointerDown={(event) => {
      if (!event.isPrimary || event.button !== 0) return;
      const panel = panelRef.current?.getBoundingClientRect(), workspace = workspaceRef.current?.getBoundingClientRect();
      if (!panel || !workspace) return;
      event.stopPropagation();
      dragRef.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: { x: panel.left - workspace.left, y: panel.top - workspace.top }, moved: false };
      handleRef.current?.setPointerCapture(event.pointerId);
    }} onPointerMove={(event) => {
      const session = dragRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      const dx = event.clientX - session.start.x, dy = event.clientY - session.start.y;
      if (!session.moved && Math.hypot(dx, dy) < THRESHOLD) return;
      session.moved = true;
      setPosition(clamp(positionFromPointer(session.origin, session.start, { x: event.clientX, y: event.clientY })));
    }} onPointerUp={(event) => finishDrag(event.pointerId, event.clientX, event.clientY)} onPointerCancel={(event) => finishDrag(event.pointerId, event.clientX, event.clientY)} onLostPointerCapture={(event) => finishDrag(event.pointerId, event.clientX, event.clientY)}>
      <Grip size={14} aria-hidden="true" /><span>Research chat</span><span className="gh-chat-window-hint">Drag to dock at either edge</span>
    </div>
    <div className="gh-chat-window-body">{children}</div>
  </div>;
}
