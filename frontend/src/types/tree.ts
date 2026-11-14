export type StockDirection = 'up' | 'down' | 'mixed';

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

export type BranchSourceType = 'social' | 'news' | 'market' | 'policy' | 'manual';

export type BranchGrowthSide = 'top' | 'bottom';

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
  _prog?: number;
  /** Set to true only for new live events; renderer clears after growth finishes. */
  _animateGrowth?: boolean;
  /** Claim view: how this article relates to its claim. */
  stance?: 'supports' | 'contradicts' | 'context';
  /** Politician view: this article reports an outcome (fulfilled / not / in progress). */
  outcomeReport?: boolean;
  /** Politician view: this article reports the claim itself (neutral colour). */
  sourceReport?: boolean;
  /** Claim view: short relation label, e.g. "Supports", "Reports the claim", "Not fulfilled". */
  relation?: string;
}

export type ScrapeEngine =
  | 'exa'
  | 'context.dev'
  | 'gemini-search'
  | 'seed'
  | 'manual';

export type ScrapeProviderPreference = 'auto' | 'exa' | 'context.dev';

export interface SpineNode {
  id: string;
  name: string;
  declaration: string;
  info: string;
  platform: string;
  timestamp?: string;
  sourceUrl?: string;
  stockImpact: {
    summary: string;
    tickers: StockImpactItem[];
  };
  publicAppeal: PublicAppealMetrics;
  scrapeEngine: ScrapeEngine;
  branches: BranchNode[];
  /** Claim view: established claims sit on the main timeline, pending ones on the unverified lane. */
  claimStatus?: 'established' | 'pending';
  /** Claim view: contradicting evidence exists. */
  disputed?: boolean;
  /** Politician view: what later reports say happened to the claim. */
  outcome?: 'fulfilled' | 'not_fulfilled' | 'in_progress' | 'no_update';
}

export interface FocusTarget {
  i: number;
  j?: number;
}

export interface TimelineSnapshot {
  nodes: SpineNode[];
  version: number;
  updatedAt: string;
}

export interface LiveBackendMessage {
  id: string;
  text: string;
  eventType: WebSocketEventType;
  timestamp: string;
}

export type WebSocketEventType =
  | 'timeline:init'
  | 'node:created'
  | 'node:updated'
  | 'node:deleted'
  | 'branch:created'
  | 'branch:deleted'
  | 'system:message'
  | 'pong';

export type WebSocketServerEvent =
  | {
      type: 'timeline:init';
      payload: TimelineSnapshot;
      message?: string;
      timestamp: string;
    }
  | {
      type: 'node:created';
      payload: { node: SpineNode; version: number };
      message?: string;
      timestamp: string;
    }
  | {
      type: 'node:updated';
      payload: { node: SpineNode; version: number };
      message?: string;
      timestamp: string;
    }
  | {
      type: 'node:deleted';
      payload: { nodeId: string; version: number };
      message?: string;
      timestamp: string;
    }
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
  | {
      type: 'system:message';
      payload?: Record<string, unknown>;
      message: string;
      timestamp: string;
    }
  | {
      type: 'pong';
      timestamp: string;
    };

export type PromptTargetMode = 'auto' | 'new-node' | 'branch';

export interface PromptRequest {
  prompt: string;
  mode?: PromptTargetMode;
  selectedNodeId?: string;
  selectedNodeName?: string;
  provider?: ScrapeProviderPreference;
}

export interface PromptResponse {
  ok?: boolean;
  mode?: 'new-node' | 'branch';
  node?: SpineNode;
  nodeId?: string;
  branches?: BranchNode[];
  version?: number;
  engine?: ScrapeEngine;
  message?: string;
  notice?: string;
}

