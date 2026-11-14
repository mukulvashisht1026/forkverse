import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ExternalLink, GripVertical } from 'lucide-react';
import type { SpineNode, BranchNode } from '../types/tree';
import { clampPosition, positionFromPointer, worldToViewport } from '../utils/cardGeometry';

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
  const clickGuardRef = useRef(false);
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
      clickGuardRef.current = true;
      const finalPos = session.current;
      const anchor = nodeScreenPosition();
      onDragEnd?.(node.id, { x: finalPos.x - anchor.x, y: finalPos.y - anchor.y });
      window.setTimeout(() => { clickGuardRef.current = false; }, 0);
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

  const branchNode = isBranch ? node as BranchNode : undefined;
  const spineNode = !isBranch ? node as SpineNode : undefined;
  const sourceLabel = branchNode
    ? branchNode.sourceType.charAt(0).toUpperCase() + branchNode.sourceType.slice(1)
    : spineNode?.scrapeEngine === 'exa' ? 'Exa AI Search'
      : spineNode?.scrapeEngine === 'context.dev' ? 'Context.dev live'
        : spineNode?.scrapeEngine === 'gemini-search' ? 'Live search grounding' : 'Source';
  const sourceDomain = branchNode?.sourceDomain;
  const sourceUrl = branchNode?.sourceUrl ?? spineNode?.sourceUrl;
  const publishedAt = branchNode?.publishedAt ?? spineNode?.timestamp;
  const parsedDate = publishedAt && publishedAt !== 'Live update' && publishedAt !== 'Live scrape' ? new Date(publishedAt) : null;
  const displayDate = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toLocaleDateString() : null;
  if (!screenPos) return null;

  return createPortal(
    <div ref={cardRef} className="node-card node-card-workspace" style={{ left: screenPos.x, top: screenPos.y, zIndex: 100 }}>
      <div ref={handleRef} className="node-card-header" aria-label="Drag evidence card" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={(event) => finishDrag(event.pointerId)} onPointerCancel={(event) => finishDrag(event.pointerId)} onLostPointerCapture={(event) => finishDrag(event.pointerId)}>
        <div className="node-card-title-row">
          <span className="node-card-source-type">{sourceLabel}</span>
          {sourceDomain && <span className="node-card-source-domain">{sourceDomain}</span>}
        </div>
        <button className="node-card-close" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); if (!clickGuardRef.current) onClose(); }} aria-label="Close card"><X size={14} /></button>
      </div>
      <div className="node-card-content">
        <h3 className="node-card-title">{node.name}</h3>
        {displayDate && <p className="node-card-date">{displayDate}</p>}
        {node.info && <p className="node-card-description">{node.info}</p>}
        {sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="node-card-source-link"><ExternalLink size={12} />Open original source</a>}
      </div>
      <div className="node-card-drag-handle" aria-hidden="true"><GripVertical size={14} /></div>
    </div>, document.body,
  );
}
