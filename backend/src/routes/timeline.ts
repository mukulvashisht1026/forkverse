/**
 * Timeline REST API for the frontend (contract: frontend/README.md §3). Every mutation is
 * persisted through the TimelineStore and broadcast to WebSocket clients via the RealtimeHub.
 *
 * GET    /status
 * GET    /timeline
 * POST   /timeline/nodes
 * PATCH  /timeline/nodes/:nodeId
 * DELETE /timeline/nodes/:nodeId
 * POST   /timeline/nodes/:nodeId/branches
 * DELETE /timeline/nodes/:nodeId/branches/:branchId
 * POST   /timeline/events            (ingestion webhook for workers / cron)
 * POST   /prompt                     (prompt bar -> research agent; articles stream over /ws)
 * POST   /scrape-event, /scrape-branch  -> 501 until the ingest pipeline exists
 *
 * TODO:
 *   - /scrape-*: call ingest/ (Context.dev discover -> scrape -> vet -> extract).
 *   - Protect mutation + /timeline/events routes (shared secret) before going public.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import type { RealtimeHub } from '../realtime/hub.js';
import { runResearch } from '../research/run.js';
import { logger } from '../utils/logger.js';
import {
  CreateBranchSchema,
  CreateNodeSchema,
  parseBody,
  TimelineError,
  UpdateNodeSchema,
} from '../timeline/model.js';
import type { TimelineStore } from '../timeline/store.js';
import type { WebSocketServerEvent } from '../timeline/types.js';

const now = () => new Date().toISOString();
const messageOf = (body: unknown) => {
  const m = (body as { message?: unknown } | undefined)?.message;
  return typeof m === 'string' && m.trim() ? m.trim() : undefined;
};

const PromptSchema = z.object({
  prompt: z.string().trim().min(1, 'Prompt is required.').max(4000),
  mode: z.enum(['auto', 'new-node', 'branch']).optional(),
  selectedNodeId: z.string().optional(),
  selectedNodeName: z.string().optional(),
  provider: z.enum(['auto', 'exa', 'context.dev']).optional(),
});

const EventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('node:created'), message: z.string().optional(), node: CreateNodeSchema }),
  z.object({
    type: z.literal('node:updated'),
    message: z.string().optional(),
    nodeId: z.string(),
    node: UpdateNodeSchema,
  }),
  z.object({
    type: z.literal('branch:created'),
    message: z.string().optional(),
    nodeId: z.string(),
    branch: CreateBranchSchema,
  }),
  z.object({ type: z.literal('system:message'), message: z.string().trim().min(1) }),
]);

export function timelineRouter({ store, hub }: { store: TimelineStore; hub: RealtimeHub }): Router {
  const r = Router();
  const emit = (event: WebSocketServerEvent) => hub.broadcast(event);

  r.get('/status', async (_req, res) => {
    const snapshot = await store.getSnapshot().catch(() => null);
    res.json({
      exaConfigured: false,
      contextDevConfigured: Boolean(config.CONTEXT_DEV_API_KEY),
      geminiFallbackAvailable: false,
      wsClients: hub.clientCount,
      timelineVersion: snapshot?.version ?? null,
    });
  });

  r.get('/timeline', async (_req, res) => {
    res.json(await store.getSnapshot());
  });

  r.post('/timeline/nodes', async (req, res) => {
    const result = await store.addNode(parseBody(CreateNodeSchema, req.body));
    emit({
      type: 'node:created',
      payload: result,
      message: messageOf(req.body) ?? `New node added to timeline: ${result.node.name}`,
      timestamp: now(),
    });
    res.status(201).json(result);
  });

  r.patch('/timeline/nodes/:nodeId', async (req, res) => {
    const result = await store.updateNode(String(req.params.nodeId), parseBody(UpdateNodeSchema, req.body));
    emit({
      type: 'node:updated',
      payload: result,
      message: messageOf(req.body) ?? `Timeline node updated: ${result.node.name}`,
      timestamp: now(),
    });
    res.json(result);
  });

  r.delete('/timeline/nodes/:nodeId', async (req, res) => {
    const result = await store.deleteNode(String(req.params.nodeId));
    emit({ type: 'node:deleted', payload: result, message: 'Main node removed from timeline.', timestamp: now() });
    res.json(result);
  });

  r.post('/timeline/nodes/:nodeId/branches', async (req, res) => {
    const result = await store.addBranch(String(req.params.nodeId), parseBody(CreateBranchSchema, req.body));
    emit({
      type: 'branch:created',
      payload: { nodeId: result.node.id, branch: result.branch, version: result.version },
      message: messageOf(req.body) ?? `New branch "${result.branch.name}" attached to ${result.node.name}`,
      timestamp: now(),
    });
    res.status(201).json({ branch: result.branch, version: result.version });
  });

  r.delete('/timeline/nodes/:nodeId/branches/:branchId', async (req, res) => {
    const result = await store.deleteBranch(String(req.params.nodeId), String(req.params.branchId));
    emit({ type: 'branch:deleted', payload: result, message: 'Support branch removed from timeline.', timestamp: now() });
    res.json(result);
  });

  r.post('/timeline/events', async (req, res) => {
    const parsed = EventSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new TimelineError(
        'Unsupported event payload. Expected type: node:created | node:updated | branch:created | system:message.',
        400,
      );
    }
    const ev = parsed.data;
    switch (ev.type) {
      case 'node:created': {
        const result = await store.addNode(ev.node);
        emit({ type: 'node:created', payload: result, message: ev.message?.trim() || `Live update: ${result.node.name}`, timestamp: now() });
        res.status(201).json({ ok: true, ...result });
        return;
      }
      case 'node:updated': {
        const result = await store.updateNode(ev.nodeId, ev.node);
        emit({ type: 'node:updated', payload: result, message: ev.message?.trim() || `Updated: ${result.node.name}`, timestamp: now() });
        res.json({ ok: true, ...result });
        return;
      }
      case 'branch:created': {
        const result = await store.addBranch(ev.nodeId, ev.branch);
        emit({
          type: 'branch:created',
          payload: { nodeId: result.node.id, branch: result.branch, version: result.version },
          message: ev.message?.trim() || `New evidence "${result.branch.name}" on ${result.node.name}`,
          timestamp: now(),
        });
        res.status(201).json({ ok: true, version: result.version });
        return;
      }
      case 'system:message': {
        emit({ type: 'system:message', message: ev.message, timestamp: now() });
        res.json({ ok: true });
        return;
      }
    }
  });

  // Prompt bar: research the topic with the agent and stream articles onto the graph over /ws.
  // Returns 202 at once; node:created / branch:created / node:updated frames follow live.
  r.post('/prompt', async (req, res) => {
    const body = parseBody(PromptSchema, req.body);
    const nodeId = body.mode === 'branch' ? body.selectedNodeId : undefined;
    res.status(202).json({ ok: true, message: `Researching "${body.prompt}"… articles will stream in live.` });

    runResearch({ query: body.prompt, nodeId }, { store, hub }).catch((err: unknown) => {
      logger.error({ err, query: body.prompt }, 'research run failed');
      emit({
        type: 'system:message',
        message: `Research failed for "${body.prompt}": ${err instanceof Error ? err.message : 'unknown error'}`,
        timestamp: now(),
      });
    });
  });

  const notBuilt = (_req: Request, res: Response) => {
    res.status(501).json({ error: 'Live scraping is not implemented in the backend yet.' });
  };
  r.post('/scrape-event', notBuilt);
  r.post('/scrape-branch', notBuilt);

  // Return contract-style `{ error }` bodies for store/validation errors.
  r.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof TimelineError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  });

  return r;
}
