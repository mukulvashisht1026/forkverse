import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import {
  getScrapeStatus,
  scrapeEventLive,
  scrapeSupportBranches,
  ScrapeServiceError,
} from './src/server/contextDev.ts';
import {
  timelineStore,
  TimelineStoreError,
  type CreateBranchPayload,
  type CreateNodePayload,
} from './src/server/timelineStore.ts';
import type {
  PromptRequest,
  WebSocketServerEvent,
} from './src/types/tree.ts';
import {
  validatePromptInput,
  validateScrapeRequest,
} from './src/utils/scrapeNormalizer.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  const broadcast = (event: WebSocketServerEvent) => {
    const encoded = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(encoded);
      }
    }
  };

  httpServer.on('upgrade', (req, socket, head) => {
    const reqUrl = req.url ?? '';
    if (reqUrl === '/ws' || reqUrl.startsWith('/ws?')) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
  });

  wss.on('connection', (ws) => {
    const snapshot = timelineStore.getSnapshot();
    const initFrame: WebSocketServerEvent = {
      type: 'timeline:init',
      payload: snapshot,
      timestamp: new Date().toISOString(),
    };
    ws.send(JSON.stringify(initFrame));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { type?: string };
        if (msg.type === 'ping') {
          ws.send(
            JSON.stringify({
              type: 'pong',
              timestamp: new Date().toISOString(),
            })
          );
        } else if (msg.type === 'timeline:sync') {
          const latest = timelineStore.getSnapshot();
          ws.send(
            JSON.stringify({
              type: 'timeline:init',
              payload: latest,
              timestamp: new Date().toISOString(),
            })
          );
        }
      } catch {
        // Ignore invalid incoming WS frames
      }
    });
  });

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/status', (_req: Request, res: Response) => {
    res.json({
      ...getScrapeStatus(),
      wsClients: wss.clients.size,
      timelineVersion: timelineStore.getSnapshot().version,
    });
  });

  // Authoritative Timeline REST API
  app.get('/api/timeline', (_req: Request, res: Response) => {
    res.json(timelineStore.getSnapshot());
  });

  app.post('/api/timeline/nodes', (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as CreateNodePayload & { message?: string };
      const result = timelineStore.addNode(body);
      const message =
        body.message?.trim() || `New node added to timeline: ${result.node.name}`;
      broadcast({
        type: 'node:created',
        payload: result,
        message,
        timestamp: new Date().toISOString(),
      });
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof TimelineStoreError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Failed to create timeline node.' });
    }
  });

  app.patch('/api/timeline/nodes/:nodeId', (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Partial<CreateNodePayload> & {
        message?: string;
      };
      const nodeId = String(req.params.nodeId);
      const result = timelineStore.updateNode(nodeId, body);
      const message =
        body.message?.trim() || `Timeline node updated: ${result.node.name}`;
      broadcast({
        type: 'node:updated',
        payload: result,
        message,
        timestamp: new Date().toISOString(),
      });
      res.json(result);
    } catch (err) {
      if (err instanceof TimelineStoreError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Failed to update timeline node.' });
    }
  });

  app.delete('/api/timeline/nodes/:nodeId', (req: Request, res: Response) => {
    try {
      const nodeId = String(req.params.nodeId);
      const result = timelineStore.deleteNode(nodeId);
      broadcast({
        type: 'node:deleted',
        payload: result,
        message: 'Main node removed from timeline.',
        timestamp: new Date().toISOString(),
      });
      res.json(result);
    } catch (err) {
      if (err instanceof TimelineStoreError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Failed to delete timeline node.' });
    }
  });

  app.post(
    '/api/timeline/nodes/:nodeId/branches',
    (req: Request, res: Response) => {
      try {
        const body = (req.body ?? {}) as CreateBranchPayload & {
          message?: string;
        };
        const nodeId = String(req.params.nodeId);
        const result = timelineStore.addBranch(nodeId, body);
        const message =
          body.message?.trim() ||
          `New branch "${result.branch.name}" attached to ${result.node.name}`;
        broadcast({
          type: 'branch:created',
          payload: {
            nodeId: result.node.id,
            branch: result.branch,
            version: result.version,
          },
          message,
          timestamp: new Date().toISOString(),
        });
        res.status(201).json({
          branch: result.branch,
          version: result.version,
        });
      } catch (err) {
        if (err instanceof TimelineStoreError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        res.status(500).json({ error: 'Failed to attach branch.' });
      }
    }
  );

  app.delete(
    '/api/timeline/nodes/:nodeId/branches/:branchId',
    (req: Request, res: Response) => {
      try {
        const nodeId = String(req.params.nodeId);
        const branchId = String(req.params.branchId);
        const result = timelineStore.deleteBranch(nodeId, branchId);
        broadcast({
          type: 'branch:deleted',
          payload: result,
          message: 'Support branch removed from timeline.',
          timestamp: new Date().toISOString(),
        });
        res.json(result);
      } catch (err) {
        if (err instanceof TimelineStoreError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        res.status(500).json({ error: 'Failed to remove branch.' });
      }
    }
  );

  // External backend webhook / event ingestion endpoint
  app.post('/api/timeline/events', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      type?: string;
      message?: string;
      node?: CreateNodePayload;
      nodeId?: string;
      branch?: CreateBranchPayload;
      nodes?: CreateNodePayload[];
    };

    try {
      const now = new Date().toISOString();
      if (body.type === 'node:created' && body.node) {
        const result = timelineStore.addNode(body.node);
        broadcast({
          type: 'node:created',
          payload: result,
          message:
            body.message?.trim() || `Live update: ${result.node.name}`,
          timestamp: now,
        });
        res.status(201).json({ ok: true, ...result });
        return;
      }

      if (body.type === 'node:updated' && body.nodeId && body.node) {
        const result = timelineStore.updateNode(body.nodeId, body.node);
        broadcast({
          type: 'node:updated',
          payload: result,
          message:
            body.message?.trim() || `Updated: ${result.node.name}`,
          timestamp: now,
        });
        res.json({ ok: true, ...result });
        return;
      }

      if (body.type === 'branch:created' && body.nodeId && body.branch) {
        const result = timelineStore.addBranch(body.nodeId, body.branch);
        broadcast({
          type: 'branch:created',
          payload: {
            nodeId: result.node.id,
            branch: result.branch,
            version: result.version,
          },
          message:
            body.message?.trim() ||
            `New evidence "${result.branch.name}" on ${result.node.name}`,
          timestamp: now,
        });
        res.status(201).json({ ok: true, version: result.version });
        return;
      }

      if (body.type === 'system:message' && body.message?.trim()) {
        broadcast({
          type: 'system:message',
          message: body.message.trim(),
          timestamp: now,
        });
        res.json({ ok: true });
        return;
      }

      res.status(400).json({
        error:
          'Unsupported event payload. Expected type: node:created | node:updated | branch:created | system:message.',
      });
    } catch (err) {
      if (err instanceof TimelineStoreError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Failed to process timeline event.' });
    }
  });

  // Live Web & Social Scrape endpoints (persist into TimelineStore + broadcast via WS)
  app.post('/api/scrape-event', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      query?: string;
      url?: string;
      provider?: 'auto' | 'exa' | 'context.dev';
    };
    const check = validateScrapeRequest({ query: body.query, url: body.url });
    if (!check.valid) {
      res.status(400).json({ error: check.error });
      return;
    }

    try {
      const scraped = await scrapeEventLive({
        query: check.query,
        targetUrl: check.targetUrl,
        provider: body.provider,
      });
      const stored = timelineStore.addNode(scraped.node);
      const message = `Live scrape (${scraped.engine}) added: ${stored.node.name}`;
      broadcast({
        type: 'node:created',
        payload: stored,
        message,
        timestamp: new Date().toISOString(),
      });
      res.status(201).json({
        node: stored.node,
        version: stored.version,
        engine: scraped.engine,
        notice: scraped.notice,
      });
    } catch (err) {
      if (err instanceof ScrapeServiceError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      const message =
        err instanceof Error ? err.message : 'Failed to scrape live web data.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/scrape-branch', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      nodeId?: string;
      topic?: string;
      query?: string;
      existingCount?: number;
      provider?: 'auto' | 'exa' | 'context.dev';
    };
    const topic = (body.topic ?? '').trim();
    const query = (body.query ?? '').trim();
    if (!topic || !query) {
      res
        .status(400)
        .json({ error: 'Both parent topic and support query are required.' });
      return;
    }

    try {
      const scraped = await scrapeSupportBranches({
        topic,
        query,
        existingCount: Number(body.existingCount ?? 0),
        provider: body.provider,
      });

      const snapshot = timelineStore.getSnapshot();
      const targetNode =
        (body.nodeId
          ? snapshot.nodes.find((n) => n.id === body.nodeId)
          : undefined) ??
        snapshot.nodes.find((n) => n.name === topic);

      let latestVersion = snapshot.version;
      const savedBranches = [];

      if (targetNode) {
        for (const br of scraped.branches) {
          const added = timelineStore.addBranch(targetNode.id, br);
          latestVersion = added.version;
          savedBranches.push(added.branch);
          broadcast({
            type: 'branch:created',
            payload: {
              nodeId: targetNode.id,
              branch: added.branch,
              version: added.version,
            },
            message: `Live scrape (${scraped.engine}) attached "${added.branch.name}" to ${targetNode.name}`,
            timestamp: new Date().toISOString(),
          });
        }
      }

      res.status(201).json({
        branches: savedBranches.length > 0 ? savedBranches : scraped.branches,
        version: latestVersion,
        engine: scraped.engine,
        notice: scraped.notice,
      });
    } catch (err) {
      if (err instanceof ScrapeServiceError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      const message =
        err instanceof Error ? err.message : 'Failed to scrape support branch.';
      res.status(500).json({ error: message });
    }
  });

  // ChatGPT-style natural-language prompt endpoint
  app.post('/api/prompt', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Partial<PromptRequest>;
    const check = validatePromptInput(body.prompt);
    if (!check.valid) {
      res.status(400).json({ error: check.error });
      return;
    }

    try {
      const snapshot = timelineStore.getSnapshot();
      const targetNode =
        (body.selectedNodeId
          ? snapshot.nodes.find((n) => n.id === body.selectedNodeId)
          : undefined) ??
        (body.selectedNodeName
          ? snapshot.nodes.find((n) => n.name === body.selectedNodeName)
          : undefined);

      const useBranchMode = body.mode === 'branch' && Boolean(targetNode);

      if (useBranchMode && targetNode) {
        const scraped = await scrapeSupportBranches({
          topic: targetNode.name,
          query: check.prompt,
          existingCount: targetNode.branches.length,
          provider: body.provider,
        });

        let latestVersion = snapshot.version;
        const savedBranches = [];
        for (const br of scraped.branches) {
          const added = timelineStore.addBranch(targetNode.id, br);
          latestVersion = added.version;
          savedBranches.push(added.branch);
          broadcast({
            type: 'branch:created',
            payload: {
              nodeId: targetNode.id,
              branch: added.branch,
              version: added.version,
            },
            message: `Prompt (${scraped.engine}) attached "${added.branch.name}" to ${targetNode.name}`,
            timestamp: new Date().toISOString(),
          });
        }

        res.status(201).json({
          ok: true,
          mode: 'branch',
          nodeId: targetNode.id,
          branches: savedBranches,
          version: latestVersion,
          engine: scraped.engine,
          message: `Attached ${savedBranches.length} branch(es) to ${targetNode.name}`,
          notice: scraped.notice,
        });
        return;
      }

      const queryWithoutUrl = check.extractedUrl
        ? check.prompt.replace(check.extractedUrl, '').trim() || check.prompt
        : check.prompt;

      const scraped = await scrapeEventLive({
        query: queryWithoutUrl,
        targetUrl: check.extractedUrl,
        provider: body.provider,
      });

      const stored = timelineStore.addNode(scraped.node);
      const message = `Prompt (${scraped.engine}) added: ${stored.node.name}`;
      broadcast({
        type: 'node:created',
        payload: stored,
        message,
        timestamp: new Date().toISOString(),
      });

      res.status(201).json({
        ok: true,
        mode: 'new-node',
        node: stored.node,
        version: stored.version,
        engine: scraped.engine,
        message,
        notice: scraped.notice,
      });
    } catch (err) {
      if (err instanceof ScrapeServiceError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      const message =
        err instanceof Error ? err.message : 'Failed to process prompt.';
      res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(
      `Signal Spine HTTP + WebSocket server listening on http://localhost:${port}`
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
