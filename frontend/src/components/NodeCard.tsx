import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ExternalLink, GripVertical } from 'lucide-react';
import type { SpineNode, BranchNode } from '../types/tree';
import { clampPosition, positionFromPointer, worldToViewport } from '../utils/cardGeometry';
import { formatCardDate, getNodeCardPresentation, hasCardSourceMetadata } from '../utils/nodeCardPresentation';

export interface NodeCardProps {
  node: SpineNode | BranchNode;
  isBranch: boolean;
  /** SVG/world coordinates, transformed once to viewport CSS pixels for fixed placement. */
  worldPos: { x: number; y: number };
  view: { k: number; x: number; y: number };
  svgRef: React.RefObject<SVGSVGElement | null>;
  workspaceRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Saved offset from the transformed graph anchor, in viewport CSS pixels (not world units). */
  offset?: { x: number; y: number };
  revision: number;
  onDragEnd?: (nodeId: string, offset: { x: number; y: number }) => void;
  cardKey: string;
}

interface DragSession { pointerId: number; start: { x: number; y: number }; origin: { x: number; y: number }; current: { x: number; y: number }; moved: boolean }
const DRAG_THRESHOLD = 4;
const DEFAULT_OFFSET = { x: 54, y: -82 };

/** Floating evidence card. Position/offset contract: viewport CSS pixels, anchored to SVG world point. */
export function NodeCard({ node, isBranch, worldPos, view, svgRef, workspaceRef, onClose, onDragEnd, offset, revision, cardKey }: NodeCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragSession | null>(null);
  const draggingRef = useRef(false);
  const [screenPos, setScreenPos] = useState<{ x: number; y: number } | null>(null);
  void revision; void cardKey;

  const nodeScreenPosition = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return worldToViewport(rect, worldPos, view);
  }, [svgRef, worldPos.x, worldPos.y, view.k, view.x, view.y]);

  const clampToWorkspace = useCallback((point: { x: number; y: number }) => {
    const card = cardRef.current?.getBoundingClientRect();
    const workspace = workspaceRef.current?.getBoundingClientRect();
    if (!card || !workspace) return point;
    return clampPosition(point, { width: card.width, height: card.height }, workspace);
  }, [workspaceRef]);

  useLayoutEffect(() => {
    if (draggingRef.current) return;
    const anchor = nodeScreenPosition();
    const saved = offset ?? DEFAULT_OFFSET;
    setScreenPos(clampToWorkspace({ x: anchor.x + saved.x, y: anchor.y + saved.y }));
  }, [nodeScreenPosition, offset?.x, offset?.y, clampToWorkspace]);

  // The first placement runs before the portal node exists; clamp again once its real size is measurable.
  useLayoutEffect(() => {
    if (!screenPos || draggingRef.current) return;
    const bounded = clampToWorkspace(screenPos);
    if (bounded.x !== screenPos.x || bounded.y !== screenPos.y) setScreenPos(bounded);
  }, [screenPos, clampToWorkspace]);

  useEffect(() => {
    const handleResize = () => {
      if (draggingRef.current || !screenPos) return;
      setScreenPos(clampToWorkspace(screenPos));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [screenPos, clampToWorkspace]);

  const finishDrag = useCallback((pointerId: number) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== pointerId) return;
    dragRef.current = null;
    draggingRef.current = false;
    if (handleRef.current?.hasPointerCapture(pointerId)) handleRef.current.releasePointerCapture(pointerId);
    if (session.moved) {
      const finalPos = session.current;
      const anchor = nodeScreenPosition();
      onDragEnd?.(node.id, { x: finalPos.x - anchor.x, y: finalPos.y - anchor.y });
    }
  }, [node.id, nodeScreenPosition, onDragEnd]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest('button,a,input,select,textarea')) return;
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.stopPropagation();
    dragRef.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: { x: rect.left, y: rect.top }, current: { x: rect.left, y: rect.top }, moved: false };
    handleRef.current?.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const dx = event.clientX - session.start.x, dy = event.clientY - session.start.y;
    if (!session.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    session.moved = true; draggingRef.current = true;
    session.current = clampToWorkspace(positionFromPointer(session.origin, session.start, { x: event.clientX, y: event.clientY }));
    setScreenPos(session.current);
  };

  const presentation = getNodeCardPresentation(node, isBranch);
  const displayDate = formatCardDate(presentation.publishedAt);
  const showSourceName = presentation.sourceName && presentation.sourceName.toLocaleLowerCase() !== presentation.sourceDomain?.toLocaleLowerCase();
  const hasSourceMetadata = hasCardSourceMetadata(presentation);
  const dragHandleProps = {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => finishDrag(event.pointerId),
    onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => finishDrag(event.pointerId),
    onLostPointerCapture: (event: React.PointerEvent<HTMLDivElement>) => finishDrag(event.pointerId),
  };
  if (!screenPos) return null;

  return createPortal(
    <div ref={cardRef} className="node-card node-card-workspace" style={{ left: screenPos.x, top: screenPos.y, zIndex: 100 }}>
      {hasSourceMetadata ? <div ref={handleRef} className="node-card-header" aria-label="Drag evidence card" {...dragHandleProps}>
        <div className="node-card-metadata">
          {presentation.sourceType && <span className="node-card-source-type">{presentation.sourceType}</span>}
          {showSourceName && <span className="node-card-source-name">{presentation.sourceName}</span>}
          {presentation.sourceDomain && <span className="node-card-source-domain">{presentation.sourceDomain}</span>}
        </div>
        <button className="node-card-close" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onClose(); }} aria-label="Close card"><X size={14} /></button>
      </div> : <>
        <div ref={handleRef} className="node-card-compact-handle" aria-label="Drag evidence card" {...dragHandleProps}><GripVertical size={13} aria-hidden="true" /></div>
        <button className="node-card-close node-card-close-compact" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onClose(); }} aria-label="Close card"><X size={14} /></button>
      </>}
      <div className={`node-card-content${hasSourceMetadata ? '' : ' has-compact-handle'}`}>
        <h3 className="node-card-title">{node.name}</h3>
        {(displayDate || presentation.relationship) && <div className="node-card-details">{displayDate && <time className="node-card-date" dateTime={presentation.publishedAt}>{displayDate}</time>}{presentation.relationship && <span className="node-card-relationship">{presentation.relationship}</span>}</div>}
        {presentation.description && <p className="node-card-description">{presentation.description}</p>}
        {presentation.sourceUrl && <a href={presentation.sourceUrl} target="_blank" rel="noopener noreferrer" className="node-card-source-link"><ExternalLink size={12} />Open original source</a>}
      </div>
    </div>, document.body,
  );
}
