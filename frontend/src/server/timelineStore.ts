import type {
  BranchGrowthSide,
  BranchNode,
  SpineNode,
  TimelineSnapshot,
} from '../types/tree.ts';
import { hashSeed, normalizePercentages } from '../utils/scrapeNormalizer.ts';

export class TimelineStoreError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
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
  publicAppeal?: SpineNode['publicAppeal'];
  scrapeEngine?: SpineNode['scrapeEngine'];
  branches?: BranchNode[];
}

export interface CreateBranchPayload {
  id?: string;
  name: string;
  info?: string;
  sourceType?: BranchNode['sourceType'];
  growthSide?: BranchGrowthSide;
  sourceDomain?: string;
  sourceUrl?: string;
  publishedAt?: string;
  impactAngle?: string;
  seed?: number;
}

class TimelineStore {
  private nodes: SpineNode[];
  private version: number;
  private updatedAt: string;

  constructor(initial: SpineNode[]) {
    this.nodes = structuredClone(initial);
    this.version = 1;
    this.updatedAt = new Date().toISOString();
  }

  private bump(): number {
    this.version += 1;
    this.updatedAt = new Date().toISOString();
    return this.version;
  }

  getSnapshot(): TimelineSnapshot {
    return {
      nodes: structuredClone(this.nodes),
      version: this.version,
      updatedAt: this.updatedAt,
    };
  }

  replaceTimeline(nodes: SpineNode[]): TimelineSnapshot {
    this.nodes = structuredClone(nodes);
    this.bump();
    return this.getSnapshot();
  }

  addNode(input: CreateNodePayload): { node: SpineNode; version: number } {
    const cleanName = (input.name ?? '').trim();
    if (!cleanName) {
      throw new TimelineStoreError('Node name is required.', 400);
    }

    const id = input.id?.trim() || `node-${hashSeed(`${cleanName}-${Date.now()}`)}`;
    const existingIdx = this.nodes.findIndex((n) => n.id === id);

    const appeal = input.publicAppeal ?? {
      sentimentLabel: 'Live Signal',
      positivePct: 34,
      neutralPct: 33,
      negativePct: 33,
      narrative: 'Awaiting live social & web evidence branches.',
    };
    const split = normalizePercentages(
      appeal.positivePct,
      appeal.neutralPct,
      appeal.negativePct
    );

    const node: SpineNode = {
      id,
      name: cleanName.slice(0, 60),
      declaration: (input.declaration ?? '').trim() || cleanName,
      info:
        (input.info ?? '').trim() ||
        'Live declaration node pushed to the timeline.',
      platform: (input.platform ?? '').trim() || 'Backend API',
      timestamp: (input.timestamp ?? '').trim() || 'Live update',
      sourceUrl: input.sourceUrl,
      stockImpact: input.stockImpact ?? {
        summary: 'Attach support branches to detail equity & sector movements.',
        tickers: [],
      },
      publicAppeal: {
        ...appeal,
        ...split,
      },
      scrapeEngine: input.scrapeEngine ?? 'manual',
      branches: (input.branches ?? []).map((b, idx) => ({
        ...b,
        id: b.id || `br-${hashSeed(`${id}-${b.name}-${idx}`)}`,
        seed: b.seed ?? hashSeed(`${id}-${b.name}-${idx}`),
        _prog: 1,
      })),
    };

    if (existingIdx >= 0) {
      this.nodes[existingIdx] = node;
    } else {
      this.nodes.push(node);
    }
    const version = this.bump();
    return { node: structuredClone(node), version };
  }

  updateNode(
    nodeId: string,
    patch: Partial<CreateNodePayload>
  ): { node: SpineNode; version: number } {
    const idx = this.nodes.findIndex((n) => n.id === nodeId);
    if (idx < 0) {
      throw new TimelineStoreError(`Node "${nodeId}" not found.`, 404);
    }
    const current = this.nodes[idx];
    const next: SpineNode = {
      ...current,
      name: patch.name !== undefined ? patch.name.trim() || current.name : current.name,
      declaration:
        patch.declaration !== undefined
          ? patch.declaration.trim() || current.declaration
          : current.declaration,
      info: patch.info !== undefined ? patch.info.trim() : current.info,
      platform:
        patch.platform !== undefined ? patch.platform.trim() : current.platform,
      timestamp:
        patch.timestamp !== undefined ? patch.timestamp.trim() : current.timestamp,
      sourceUrl:
        patch.sourceUrl !== undefined ? patch.sourceUrl : current.sourceUrl,
      stockImpact: patch.stockImpact ?? current.stockImpact,
      publicAppeal: patch.publicAppeal
        ? {
            ...patch.publicAppeal,
            ...normalizePercentages(
              patch.publicAppeal.positivePct,
              patch.publicAppeal.neutralPct,
              patch.publicAppeal.negativePct
            ),
          }
        : current.publicAppeal,
    };

    this.nodes[idx] = next;
    const version = this.bump();
    return { node: structuredClone(next), version };
  }

  deleteNode(nodeId: string): { nodeId: string; version: number } {
    const idx = this.nodes.findIndex((n) => n.id === nodeId);
    if (idx < 0) {
      throw new TimelineStoreError(`Node "${nodeId}" not found.`, 404);
    }
    this.nodes.splice(idx, 1);
    const version = this.bump();
    return { nodeId, version };
  }

  addBranch(
    nodeId: string,
    input: CreateBranchPayload
  ): { node: SpineNode; branch: BranchNode; version: number } {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) {
      throw new TimelineStoreError(`Node "${nodeId}" not found.`, 404);
    }
    const cleanName = (input.name ?? '').trim();
    if (!cleanName) {
      throw new TimelineStoreError('Branch name is required.', 400);
    }

    const id =
      input.id?.trim() ||
      `br-${hashSeed(`${node.id}-${cleanName}-${node.branches.length}-${Date.now()}`)}`;

    const growthSide: BranchGrowthSide =
      input.growthSide ??
      (input.sourceType === 'social' || input.sourceType === 'manual'
        ? 'bottom'
        : node.branches.length % 2 === 1
          ? 'bottom'
          : 'top');

    const branch: BranchNode = {
      id,
      name: cleanName.slice(0, 48),
      info: (input.info ?? '').trim() || 'Supporting evidence.',
      sourceType:
        input.sourceType ?? (growthSide === 'bottom' ? 'social' : 'news'),
      growthSide,
      sourceDomain: input.sourceDomain,
      sourceUrl: input.sourceUrl,
      publishedAt: input.publishedAt,
      impactAngle: input.impactAngle,
      seed:
        input.seed ??
        hashSeed(`${node.name}-${cleanName}-${node.branches.length}`),
      _prog: 1,
    };

    const existingIdx = node.branches.findIndex((b) => b.id === branch.id);
    if (existingIdx >= 0) {
      node.branches[existingIdx] = branch;
    } else {
      node.branches.push(branch);
    }

    const version = this.bump();
    return {
      node: structuredClone(node),
      branch: structuredClone(branch),
      version,
    };
  }

  deleteBranch(
    nodeId: string,
    branchId: string
  ): { nodeId: string; branchId: string; version: number } {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) {
      throw new TimelineStoreError(`Node "${nodeId}" not found.`, 404);
    }
    const bIdx = node.branches.findIndex((b) => b.id === branchId);
    if (bIdx < 0) {
      throw new TimelineStoreError(`Branch "${branchId}" not found.`, 404);
    }
    node.branches.splice(bIdx, 1);
    const version = this.bump();
    return { nodeId, branchId, version };
  }
}

export const timelineStore = new TimelineStore([]);
