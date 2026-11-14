import { useEffect, useRef, useState } from 'react';
import { X, ExternalLink, GripVertical } from 'lucide-react';
import type { SpineNode, BranchNode } from '../types/tree';
import { VettingCard } from './SourceVetting';

export interface NodeCardProps {
  /** The node data (spine node or branch) */
  node: SpineNode | BranchNode;
  /** Whether this is a branch (evidence) or spine node (event) */
  isBranch: boolean;
  /** World position of the node (center of spine node or branch tip) */
  worldPos: { x: number; y: number };
  /** Current view transform (zoom/pan) */
  view: { k: number; x: number; y: number };
  /** SVG container element to get screen bounds */
  svgRef: React.RefObject<SVGSVGElement | null>;
  /** Callback when card requests to close */
  onClose: () => void;
  /** Saved user position offset from its node */
  offset?: { x: number; y: number };
  /** Rerender when parent updates drag offset */
  revision: number;
  /** Callback when card is dragged to new position */
  onDragEnd?: (nodeId: string, offset: { x: number; y: number }) => void;
  /** Unique key for this card instance */
  cardKey: string;
  /** Evidence cards: screen this source for propaganda now. */
  onScreen?: () => void;
  screening?: boolean;
}

/**
 * Floating card that appears next to a node in the graph.
 * - Positioned relative to zoom level
 * - Draggable like a window
 * - Reopens near the node when closed/click outside
 * - Shows source and title as separate elements
 */
export function NodeCard({
  node,
  isBranch,
  worldPos,
  view,
  svgRef,
  onClose,
  onDragEnd,
  offset,
  revision,
  cardKey,
  onScreen,
  screening,
}: NodeCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(true);
  const reopenTimer = useRef<number | undefined>(undefined);
  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
  }>({ isDragging: false, startX: 0, startY: 0, offsetX: 0, offsetY: 0 });
  const [screenPos, setScreenPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const currentPosRef = useRef(screenPos);
  currentPosRef.current = screenPos;
  const dragOriginRef = useRef({ x: 0, y: 0 });
  void revision;
  void cardKey;

  // Convert world coordinates to screen coordinates
  const worldToScreen = (wx: number, wy: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: rect.left + (wx * view.k + view.x),
      y: rect.top + (wy * view.k + view.y),
    };
  };
  const reopenNearNode = () => {
    setIsOpen(false);
    window.clearTimeout(reopenTimer.current);
    reopenTimer.current = window.setTimeout(() => {
      const pos = worldToScreen(worldPos.x, worldPos.y);
      setScreenPos({ x: pos.x + 54 * view.k, y: pos.y - 82 * view.k });
      setIsOpen(true);
    }, 450);
  };
  useEffect(() => () => window.clearTimeout(reopenTimer.current), []);

  // Update screen position when view or worldPos changes
  useEffect(() => {
    const pos = worldToScreen(worldPos.x, worldPos.y);
    setScreenPos({ x: pos.x + (offset?.x ?? 54) * view.k, y: pos.y + (offset?.y ?? -82) * view.k });
  }, [worldPos.x, worldPos.y, view.k, view.x, view.y, offset?.x, offset?.y]);

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        reopenNearNode();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [worldPos.x, worldPos.y, view.k, view.x, view.y]);

  // Handle drag
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.node-card-header')) {
      e.preventDefault();
      const rect = cardRef.current?.getBoundingClientRect();
      if (!rect) return;
      dragOriginRef.current = { x: screenPos.x, y: screenPos.y };
      setDragState({
        isDragging: true,
        startX: e.clientX,
        startY: e.clientY,
        offsetX: rect.left - screenPos.x,
        offsetY: rect.top - screenPos.y,
      });
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragState.isDragging) return;
      const newX = e.clientX - dragState.startX + dragState.offsetX;
      const newY = e.clientY - dragState.startY + dragState.offsetY;
      currentPosRef.current = { x: newX, y: newY };
      setScreenPos({ x: newX, y: newY });
    };
    const handleMouseUp = () => {
      if (dragState.isDragging) {
        setDragState((prev) => ({ ...prev, isDragging: false }));
        const nodeScreen = worldToScreen(worldPos.x, worldPos.y);
        const finalPos = currentPosRef.current;
        onDragEnd?.(node.id, {
          x: (finalPos.x - nodeScreen.x) / view.k,
          y: (finalPos.y - nodeScreen.y) / view.k,
        });
      }
    };
    if (dragState.isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState.isDragging, dragState.startX, dragState.startY, dragState.offsetX, dragState.offsetY, node.id, onDragEnd, screenPos]);

  const branchNode = isBranch ? node as BranchNode : undefined;
  const spineNode = !isBranch ? node as SpineNode : undefined;
  const sourceLabel = branchNode
    ? branchNode.sourceType.charAt(0).toUpperCase() + branchNode.sourceType.slice(1)
    : spineNode?.scrapeEngine === 'exa'
      ? 'Exa AI Search'
      : spineNode?.scrapeEngine === 'context.dev'
        ? 'Context.dev live'
        : spineNode?.scrapeEngine === 'gemini-search'
          ? 'Live search grounding'
          : 'Source';

  const sourceDomain = branchNode?.sourceDomain;
  const sourceUrl = branchNode?.sourceUrl ?? spineNode?.sourceUrl;

  // Format date
  const formatDate = (dateStr?: string) => {
    if (!dateStr || dateStr === 'Live update' || dateStr === 'Live scrape') return null;
    const date = new Date(dateStr);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
  };

  const publishedAt = branchNode?.publishedAt ?? spineNode?.timestamp;
  const displayDate = formatDate(publishedAt);

  if (!isOpen) return null;

  // Calculate card position - offset from node position
  const cardX = screenPos.x;
  const cardY = screenPos.y;

  return (
    <div
      ref={cardRef}
      className="node-card"
      style={{
        left: cardX,
        top: cardY,
        zIndex: 100,
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="node-card-header">
        <div className="node-card-title-row">
          <span className="node-card-source-type">{sourceLabel}</span>
          {sourceDomain && <span className="node-card-source-domain">{sourceDomain}</span>}
        </div>
        <button
          className="node-card-close"
          onClick={(e) => {
            e.stopPropagation();
            reopenNearNode();
            onClose();
          }}
          aria-label="Close card"
        >
          <X size={14} />
        </button>
      </div>
      <div className="node-card-content">
        <h3 className="node-card-title">{node.name}</h3>
        {displayDate && <p className="node-card-date">{displayDate}</p>}
        {node.info && <p className="node-card-description">{node.info}</p>}
        {isBranch && branchNode?.sourceUrl && <VettingCard vetting={branchNode.vetting} onScreen={onScreen} screening={screening} />}
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="node-card-source-link"
          >
            <ExternalLink size={12} />
            Open original source
          </a>
        )}
      </div>
      <div className="node-card-drag-handle" aria-label="Drag to move">
        <GripVertical size={14} />
      </div>
    </div>
  );
}