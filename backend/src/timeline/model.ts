/**
 * Pure timeline logic: request validation and node/branch construction.
 * Defaults and normalisation are ported from frontend/src/server/timelineStore.ts so the real
 * backend behaves like the frontend's mock server.
 */
import { z } from 'zod';
import type { BranchGrowthSide, BranchNode, CreateBranchPayload, CreateNodePayload, SpineNode } from './types.js';

export class TimelineError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

// ---- request schemas ----------------------------------------------------------

const optStr = z.string().optional();

const StockImpactSchema = z.object({
  summary: z.string(),
  tickers: z.array(
    z.object({
      ticker: z.string(),
      company: z.string(),
      change: z.string(),
      direction: z.enum(['up', 'down', 'mixed']),
      note: z.string(),
    }),
  ),
});

const PublicAppealSchema = z.object({
  sentimentLabel: z.string(),
  positivePct: z.number(),
  neutralPct: z.number(),
  negativePct: z.number(),
  narrative: z.string(),
});

const SourceType = z.enum(['social', 'news', 'market', 'policy', 'manual']);
const GrowthSide = z.enum(['top', 'bottom']);

export const CreateBranchSchema = z.object({
  id: optStr,
  name: z.string(),
  info: optStr,
  sourceType: SourceType.optional(),
  growthSide: GrowthSide.optional(),
  sourceDomain: optStr,
  sourceUrl: optStr,
  publishedAt: optStr,
  impactAngle: optStr,
  seed: z.number().int().optional(),
});

const BranchInNodeSchema = CreateBranchSchema.extend({
  id: z.string().default(''),
  info: z.string().default(''),
  sourceType: SourceType.default('news'),
});

export const CreateNodeSchema = z.object({
  id: optStr,
  name: z.string(),
  declaration: optStr,
  info: optStr,
  platform: optStr,
  timestamp: optStr,
  sourceUrl: optStr,
  stockImpact: StockImpactSchema.optional(),
  publicAppeal: PublicAppealSchema.optional(),
  scrapeEngine: z.enum(['exa', 'context.dev', 'gemini-search', 'seed', 'manual']).optional(),
  branches: z.array(BranchInNodeSchema).optional(),
});

export const UpdateNodeSchema = CreateNodeSchema.omit({ id: true, branches: true }).partial();

/** Parse a request body or throw a 400 TimelineError with the first issue. */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new TimelineError(`Invalid ${issue?.path.join('.') || 'body'}: ${issue?.message ?? 'bad input'}`, 400);
  }
  return parsed.data;
}

// ---- helpers ----------------------------------------------------------------

/** FNV-1a; same as frontend scrapeNormalizer.hashSeed so seeds match. */
export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2147483647 || 1337;
}

export function normalizePercentages(pos: number, neu: number, neg: number) {
  const p = Math.max(0, Number.isFinite(pos) ? pos : 0);
  const u = Math.max(0, Number.isFinite(neu) ? neu : 0);
  const n = Math.max(0, Number.isFinite(neg) ? neg : 0);
  const sum = p + u + n;
  if (sum <= 0) return { positivePct: 34, neutralPct: 33, negativePct: 33 };
  const positivePct = Math.round((p / sum) * 100);
  const neutralPct = Math.round((u / sum) * 100);
  const negativePct = Math.max(0, 100 - positivePct - neutralPct);
  return { positivePct, neutralPct, negativePct };
}

// ---- builders ---------------------------------------------------------------

export function buildNode(input: CreateNodePayload, now = Date.now()): SpineNode {
  const cleanName = (input.name ?? '').trim();
  if (!cleanName) throw new TimelineError('Node name is required.', 400);
  const id = input.id?.trim() || `node-${hashSeed(`${cleanName}-${now}`)}`;

  const appeal = input.publicAppeal ?? {
    sentimentLabel: 'Live Signal',
    positivePct: 34,
    neutralPct: 33,
    negativePct: 33,
    narrative: 'Awaiting live social & web evidence branches.',
  };

  return {
    id,
    name: cleanName.slice(0, 60),
    declaration: (input.declaration ?? '').trim() || cleanName,
    info: (input.info ?? '').trim() || 'Live declaration node pushed to the timeline.',
    platform: (input.platform ?? '').trim() || 'Backend API',
    timestamp: (input.timestamp ?? '').trim() || 'Live update',
    ...(input.sourceUrl !== undefined && { sourceUrl: input.sourceUrl }),
    stockImpact: input.stockImpact ?? {
      summary: 'Attach support branches to detail equity & sector movements.',
      tickers: [],
    },
    publicAppeal: { ...appeal, ...normalizePercentages(appeal.positivePct, appeal.neutralPct, appeal.negativePct) },
    scrapeEngine: input.scrapeEngine ?? 'manual',
    branches: (input.branches ?? []).map((b, idx) => ({
      ...b,
      id: b.id || `br-${hashSeed(`${id}-${b.name}-${idx}`)}`,
      seed: b.seed ?? hashSeed(`${id}-${b.name}-${idx}`),
      _prog: 1,
    })),
  };
}

export function patchNode(current: SpineNode, patch: Partial<CreateNodePayload>): SpineNode {
  return {
    ...current,
    name: patch.name !== undefined ? patch.name.trim().slice(0, 60) || current.name : current.name,
    declaration: patch.declaration !== undefined ? patch.declaration.trim() || current.declaration : current.declaration,
    info: patch.info !== undefined ? patch.info.trim() : current.info,
    platform: patch.platform !== undefined ? patch.platform.trim() : current.platform,
    timestamp: patch.timestamp !== undefined ? patch.timestamp.trim() : current.timestamp,
    sourceUrl: patch.sourceUrl !== undefined ? patch.sourceUrl : current.sourceUrl,
    stockImpact: patch.stockImpact ?? current.stockImpact,
    publicAppeal: patch.publicAppeal
      ? {
          ...patch.publicAppeal,
          ...normalizePercentages(
            patch.publicAppeal.positivePct,
            patch.publicAppeal.neutralPct,
            patch.publicAppeal.negativePct,
          ),
        }
      : current.publicAppeal,
  };
}

export function buildBranch(node: SpineNode, input: CreateBranchPayload, now = Date.now()): BranchNode {
  const cleanName = (input.name ?? '').trim();
  if (!cleanName) throw new TimelineError('Branch name is required.', 400);
  const id = input.id?.trim() || `br-${hashSeed(`${node.id}-${cleanName}-${node.branches.length}-${now}`)}`;

  const growthSide: BranchGrowthSide =
    input.growthSide ??
    (input.sourceType === 'social' || input.sourceType === 'manual'
      ? 'bottom'
      : node.branches.length % 2 === 1
        ? 'bottom'
        : 'top');

  return {
    id,
    name: cleanName.slice(0, 48),
    info: (input.info ?? '').trim() || 'Supporting evidence.',
    sourceType: input.sourceType ?? (growthSide === 'bottom' ? 'social' : 'news'),
    growthSide,
    ...(input.sourceDomain !== undefined && { sourceDomain: input.sourceDomain }),
    ...(input.sourceUrl !== undefined && { sourceUrl: input.sourceUrl }),
    ...(input.publishedAt !== undefined && { publishedAt: input.publishedAt }),
    ...(input.impactAngle !== undefined && { impactAngle: input.impactAngle }),
    seed: input.seed ?? hashSeed(`${node.name}-${cleanName}-${node.branches.length}`),
    _prog: 1,
  };
}

/** Insert or replace (by id) a branch in a node's branch list. */
export function upsertBranch(branches: BranchNode[], branch: BranchNode): BranchNode[] {
  const idx = branches.findIndex((b) => b.id === branch.id);
  if (idx < 0) return [...branches, branch];
  const next = [...branches];
  next[idx] = branch;
  return next;
}
