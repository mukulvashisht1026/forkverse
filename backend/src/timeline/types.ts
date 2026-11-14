/**
 * Timeline (Signal Spine) wire types. Mirrors frontend/src/types/tree.ts and the contract in
 * frontend/README.md: keep both in sync when either changes.
 */
import type { InvestigationHighlightEvent, InvestigationUpdatedEvent } from '../investigations/types.js';

export type StockDirection = 'up' | 'down' | 'mixed';
export type BranchSourceType = 'social' | 'news' | 'market' | 'policy' | 'manual';
export type BranchGrowthSide = 'top' | 'bottom';
export type ScrapeEngine = 'exa' | 'context.dev' | 'gemini-search' | 'seed' | 'manual';

export interface StockImpactItem {
  ticker: string;
  company: string;
  change: string;
  direction: StockDirection;
  note: string;
}

export interface PublicAppealMetrics {
  sentimentLabel: string;
  positivePct: number;
  neutralPct: number;
  negativePct: number;
  narrative: string;
}

export interface BranchNode {
  id: string;
  name: string;
  info: string;
  sourceType: BranchSourceType;
  growthSide?: BranchGrowthSide;
  sourceDomain?: string;
  sourceUrl?: string;
  publishedAt?: string;
  impactAngle?: string;
  seed: number;
  /** Client animation progress; the frontend's own store always sends 1. */
  _prog?: number;
}

export interface SpineNode {
  id: string;
  name: string;
  declaration: string;
  info: string;
  platform: string;
  timestamp?: string;
  sourceUrl?: string;
  stockImpact: { summary: string; tickers: StockImpactItem[] };
  publicAppeal: PublicAppealMetrics;
  scrapeEngine: ScrapeEngine;
  branches: BranchNode[];
}

export interface TimelineSnapshot {
  nodes: SpineNode[];
  version: number;
  updatedAt: string;
}

export interface CreateNodePayload {
  id?: string;
  name: string;
  declaration?: string;
  info?: string;
  platform?: string;
  timestamp?: string;
  sourceUrl?: string;
  stockImpact?: SpineNode['stockImpact'];
  publicAppeal?: PublicAppealMetrics;
  scrapeEngine?: ScrapeEngine;
  /** id and seed are generated when missing. */
  branches?: Array<Omit<BranchNode, 'id' | 'seed'> & { id?: string; seed?: number }>;
}

export interface CreateBranchPayload {
  id?: string;
  name: string;
  info?: string;
  sourceType?: BranchSourceType;
  growthSide?: BranchGrowthSide;
  sourceDomain?: string;
  sourceUrl?: string;
  publishedAt?: string;
  impactAngle?: string;
  seed?: number;
}

export type WebSocketServerEvent =
  | { type: 'timeline:init'; payload: TimelineSnapshot; message?: string; timestamp: string }
  | { type: 'node:created'; payload: { node: SpineNode; version: number }; message?: string; timestamp: string }
  | { type: 'node:updated'; payload: { node: SpineNode; version: number }; message?: string; timestamp: string }
  | { type: 'node:deleted'; payload: { nodeId: string; version: number }; message?: string; timestamp: string }
  | {
      type: 'branch:created';
      payload: { nodeId: string; branch: BranchNode; version: number };
      message?: string;
      timestamp: string;
    }
  | {
      type: 'branch:deleted';
      payload: { nodeId: string; branchId: string; version: number };
      message?: string;
      timestamp: string;
    }
  | { type: 'system:message'; payload?: Record<string, unknown>; message: string; timestamp: string }
  | { type: 'pong'; timestamp: string }
  | InvestigationUpdatedEvent
  | InvestigationHighlightEvent;
