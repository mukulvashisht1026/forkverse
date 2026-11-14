import { useEffect, useRef, useState } from 'react';
import { Grip } from 'lucide-react';
import { chatDockAt, clampWorkspacePosition, getChatDockLayout, getChatPanelSize, type ChatDock } from '../utils/chatPanelGeometry';
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
  const [dock, setDockState] = useState<ChatDock | null>(null);
  const dockRef = useRef<ChatDock | null>(null);
  const [previewDock, setPreviewDock] = useState<ChatDock | null>(null);
  const [dragging, setDragging] = useState(false);
  const setDock = (next: ChatDock | null) => { dockRef.current = next; setDockState(next); };

  const workspaceSize = () => {
    const workspace = workspaceRef.current?.getBoundingClientRect();
    return workspace ? { width: workspace.width, height: workspace.height } : null;
  };

  useEffect(() => {
    const workspace = workspaceRef.current;
    const panel = panelRef.current;
    if (!workspace || !panel) return;
    const resize = () => {
      const bounds = { width: workspace.clientWidth, height: workspace.clientHeight };
      const currentDock = dockRef.current;
      if (currentDock) setPosition(getChatDockLayout(currentDock, bounds).position);
      else setPosition((point) => clampWorkspacePosition(point, getChatPanelSize(bounds, null), bounds));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(workspace); observer.observe(panel);
    return () => observer.disconnect();
  }, [workspaceRef]);

  const finishDrag = (pointerId: number, clientX: number, clientY: number) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== pointerId) return;
    dragRef.current = null;
    if (handleRef.current?.hasPointerCapture(pointerId)) handleRef.current.releasePointerCapture(pointerId);
    if (!session.moved) return;
    const bounds = workspaceSize();
    if (!bounds) return;
    const freeSize = getChatPanelSize(bounds, null);
    const next = clampWorkspacePosition(positionFromPointer(session.origin, session.start, { x: clientX, y: clientY }), freeSize, bounds);
    const target = chatDockAt(next, freeSize, bounds);
    setPreviewDock(null);
    setDragging(false);
    if (target) {
      setDock(target);
      setPosition(getChatDockLayout(target, bounds).position);
    } else {
      setDock(null);
      setPosition(next);
    }
  };

  const bounds = workspaceSize() ?? { width: 352, height: 680 };
  const panelSize = getChatPanelSize(bounds, dock);
  const preview = previewDock === 'top' || previewDock === 'bottom' ? getChatDockLayout(previewDock, bounds) : null;

  return <>
    {preview && <div className={`gh-chat-dock-preview is-${previewDock}`} aria-hidden="true" style={{ left: preview.position.x, top: preview.position.y, width: preview.size.width, height: preview.size.height }}><span /></div>}
    <div ref={panelRef} className={`gh-chat-window${dock ? ` is-docked is-docked-${dock}` : ''}${dock === 'top' || dock === 'bottom' ? ' is-horizontal-docked' : ''}${dragging ? ' is-dragging' : ''}`} style={{ left: position.x, top: position.y, width: panelSize.width, height: panelSize.height }}>
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
      const bounds = workspaceSize();
      if (!bounds) return;
      const freeSize = getChatPanelSize(bounds, null);
      if (dockRef.current) {
        const panel = panelRef.current?.getBoundingClientRect();
        const workspace = workspaceRef.current?.getBoundingClientRect();
        if (!panel || !workspace) return;
        const grabX = Math.max(0, Math.min(1, (event.clientX - panel.left) / panel.width));
        const grabY = Math.max(0, Math.min(1, (event.clientY - panel.top) / panel.height));
        const restored = clampWorkspacePosition({ x: event.clientX - workspace.left - freeSize.width * grabX, y: event.clientY - workspace.top - freeSize.height * grabY }, freeSize, bounds);
        setDock(null);
        setPosition(restored);
        session.origin = restored;
        session.start = { x: event.clientX, y: event.clientY };
      } else {
        setPosition(clampWorkspacePosition(positionFromPointer(session.origin, session.start, { x: event.clientX, y: event.clientY }), freeSize, bounds));
      }
      setDragging(true);
      const current = positionFromPointer(session.origin, session.start, { x: event.clientX, y: event.clientY });
      const target = chatDockAt(current, freeSize, bounds);
      setPreviewDock(target === 'top' || target === 'bottom' ? target : null);
    }} onPointerUp={(event) => finishDrag(event.pointerId, event.clientX, event.clientY)} onPointerCancel={(event) => finishDrag(event.pointerId, event.clientX, event.clientY)} onLostPointerCapture={(event) => finishDrag(event.pointerId, event.clientX, event.clientY)}>
      <Grip size={14} aria-hidden="true" /><span>Research chat</span><span className="gh-chat-window-hint">Drag to dock at any edge</span>
    </div>
    <div className="gh-chat-window-body">{children}</div>
    </div>
  </>;
}
