/**
 * Investigation API (contract: contracts/investigations.ts, docs/investigation-contract.md).
 * Served at `/investigations/*` and `/api/investigations/*`.
 *
 * GET  /investigations?visibility=public&limit=20&cursor=…  -> PublicInvestigationsResponseDto
 * POST /investigations                {topic, context?}     -> 202 CreateInvestigationResponseDto
 * GET  /investigations/:id                                   -> InvestigationDto
 * GET  /investigations/:id/graph                             -> InvestigationGraphDto
 * POST /investigations/:id/runs       {topic, context?}     -> 202 ExtendInvestigationResponseDto (409 if a run is active)
 * GET  /investigations/:id/runs                              -> { items: ResearchRunDto[] }
 * GET  /investigations/:id/runs/:runId                       -> ResearchRunDto
 * GET  /investigations/:id/messages?cursor=…                 -> ChatPageDto (newest page, oldest-first)
 * POST /investigations/:id/research   ResearchRequestDto    -> text/event-stream of ResearchStreamEventDto
 *      action answer_question: RAG answer over the investigation graph, cited [[source:Sn]];
 *      action extend_graph: research run + graph_updated;
 *      action verify_sources (+eventId): proof engine (Corroborator + Skeptic) over one event's
 *      articles, emits `proof` with roles per article;
 *      action build_claims: claim timeline (claims/claimLinks/entity on the graph) + graph_updated.
 *      Cited/added/compared evidence is highlighted
 *      on /ws via `investigation:highlight`.
 * GET    /investigations/:id/monitors                       -> { items: MonitorDto[] }
 * POST   /investigations/:id/monitors   CreateMonitorRequestDto -> 201 MonitorDto (Context.dev monitor)
 * GET    /investigations/:id/monitors/suggestions            -> { items: LiveSourceDto[] } (pages updating now, best first)
 * DELETE /investigations/:id/monitors/:monitorId            -> 204
 * POST   /investigations/:id/monitors/:monitorId/check      -> 202 { runId } (result arrives on /ws)
 * POST   /investigations/:id/vet   {evidenceIds?}           -> 202 {queued,total} (propaganda screening of sources)
 * POST   /vet                      {url}                    -> SourceVettingDto (screen any website now)
 * GET    /investigations/:id/newspaper                      -> NewspaperEditionDto (front page from the claim graph)
 * GET    /investigations/:id/newspaper.html                 -> the edition as a standalone broadsheet page
 * POST   /webhook/monitor   Context.dev `change.detected` (signed) -> applied to the graph
 *
 * Runs execute in the background. Progress arrives on /ws as `investigation:updated`
 * frames {investigationId, revision, run, evidence?}; clients can also poll the run.
 * Errors are ApiErrorDto: { code, message, requestId?, details? }.
 *
 * TODO: authentication/ownership; until then every investigation is public.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { ResearchChatService } from '../investigations/chat.js';
import type { MonitorService } from '../monitors/service.js';
import type { VettingService } from '../vetting/service.js';
import type { NewspaperService } from '../newspaper/service.js';
import { InvestigationError, toGraphDto, toInvestigationDto, type InvestigationService } from '../investigations/service.js';
import type { ResearchStreamEventDto } from '../investigations/types.js';
import { logger } from '../utils/logger.js';

const RunBody = z.object({
  topic: z.string(),
  context: z.string().optional(),
});

const ResearchBody = z.object({
  investigationId: z.string(),
  action: z.enum(['answer_question', 'extend_graph', 'verify_sources', 'build_claims']),
  message: z.string(),
  conversationId: z.string().optional(),
  eventId: z.string().optional(),
});

const MonitorBody = z.object({
  kind: z.enum(['news_feed', 'page', 'sitemap']),
  url: z.string().max(2000).optional(),
  instructions: z.string().max(2000).optional(),
  intervalMinutes: z.coerce.number().int().min(10).max(1440).optional(),
});

const VetBody = z.object({ evidenceIds: z.array(z.string()).max(50).optional() });
const VetUrlBody = z.object({ url: z.string().max(2000) });

const SSE_KEEPALIVE_MS = 15_000;

const ListQuery = z.object({
  visibility: z.literal('public').optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().optional(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value ?? {});
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new InvestigationError(400, 'invalid_request', `Invalid ${issue?.path.join('.') || 'request'}: ${issue?.message}`);
  }
  return r.data;
}

export function investigationsRouter(service: InvestigationService, chat?: ResearchChatService, monitors?: MonitorService, vetting?: VettingService, newspaper?: NewspaperService): Router {
  const r = Router();

  if (newspaper) {
    // Front page of the investigation, written from the claim graph (JSON or a standalone page).
    r.get('/investigations/:id/newspaper', async (req, res) => {
      res.json(await newspaper.edition(String(req.params.id)));
    });
    r.get('/investigations/:id/newspaper.html', async (req, res) => {
      const html = await newspaper.html(String(req.params.id));
      res
        .status(200)
        .set({
          'Content-Type': 'text/html; charset=utf-8',
          // Inline style/script of the page only; article images from any https host.
          'Content-Security-Policy': "default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
          'Cache-Control': 'no-cache',
        })
        .send(html);
    });
  }

  if (vetting) {
    // Screen an investigation's sources (background; progress on /ws investigation:vetting).
    r.post('/investigations/:id/vet', async (req, res) => {
      res.status(202).json(await vetting.start(String(req.params.id), parse(VetBody, req.body).evidenceIds));
    });
    // Screen any single website / article URL now.
    r.post('/vet', async (req, res) => {
      res.json(await vetting.vetUrl(parse(VetUrlBody, req.body).url.trim()));
    });
  }

  if (monitors) {
    r.get('/investigations/:id/monitors', async (req, res) => {
      res.json({ items: await monitors.list(String(req.params.id)) });
    });
    r.get('/investigations/:id/monitors/suggestions', async (req, res) => {
      res.json({ items: await monitors.suggest(String(req.params.id)) });
    });
    r.post('/investigations/:id/monitors', async (req, res) => {
      res.status(201).json(await monitors.create(String(req.params.id), parse(MonitorBody, req.body)));
    });
    r.delete('/investigations/:id/monitors/:monitorId', async (req, res) => {
      await monitors.remove(String(req.params.id), String(req.params.monitorId));
      res.status(204).end();
    });
    r.post('/investigations/:id/monitors/:monitorId/check', async (req, res) => {
      res.status(202).json(await monitors.checkNow(String(req.params.id), String(req.params.monitorId)));
    });
    // Context.dev webhook: verified against the raw body (captured by express.json in server.ts).
    r.post('/webhook/monitor', async (req, res) => {
      const raw = (req as Request & { rawBody?: Buffer }).rawBody;
      if (!raw) {
        res.status(400).end();
        return;
      }
      const status = await monitors.handleWebhook(raw, {
        signature: req.get('x-context-signature'),
        event: req.get('x-context-event'),
      });
      res.status(status).end();
    });
  }

  r.get('/investigations', async (req, res) => {
    const q = parse(ListQuery, req.query);
    res.json(await service.listPublic(q.limit, q.cursor));
  });

  r.post('/investigations', async (req, res) => {
    res.status(202).json(await service.create(parse(RunBody, req.body)));
  });

  r.get('/investigations/:id', async (req, res) => {
    res.json(toInvestigationDto(await service.get(String(req.params.id))));
  });

  r.get('/investigations/:id/graph', async (req, res) => {
    res.json(toGraphDto(await service.get(String(req.params.id))));
  });

  r.post('/investigations/:id/runs', async (req, res) => {
    res.status(202).json(await service.extend(String(req.params.id), parse(RunBody, req.body)));
  });

  r.get('/investigations/:id/runs', async (req, res) => {
    res.json({ items: await service.listRuns(String(req.params.id)) });
  });

  r.get('/investigations/:id/runs/:runId', async (req, res) => {
    res.json(await service.getRun(String(req.params.id), String(req.params.runId)));
  });

  if (chat) {
    r.get('/investigations/:id/messages', async (req, res) => {
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      res.json(await chat.history(String(req.params.id), cursor));
    });

    r.post('/investigations/:id/research', async (req, res) => {
      const id = String(req.params.id);
      const body = parse(ResearchBody, req.body);
      if (body.investigationId !== id) {
        throw new InvestigationError(400, 'investigation_mismatch', 'Body investigationId does not match the URL.');
      }
      // Validate before streaming so failures are ordinary JSON errors with a status code.
      const { record, message, event } = await chat.prepare(id, body.action, body.message, body.eventId);

      res.status(200).set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      const abort = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) abort.abort(); // client went away: stop generating
      });
      const send = (event: ResearchStreamEventDto) => {
        if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      const keepalive = setInterval(() => {
        if (!res.writableEnded) res.write(': keepalive\n\n');
      }, SSE_KEEPALIVE_MS);
      try {
        await chat.run(record, body.action, message, send, abort.signal, event);
      } catch (err) {
        if (!abort.signal.aborted) {
          logger.error({ err, investigationId: id, action: body.action }, 'research chat failed');
          const requestId = req.id === undefined ? undefined : String(req.id);
          send({
            type: 'error',
            error:
              err instanceof InvestigationError
                ? err.toDto(requestId)
                : { code: 'research_failed', message: 'The research assistant failed to answer. Please try again.', ...(requestId && { requestId }) },
          });
        }
      } finally {
        clearInterval(keepalive);
        res.end();
      }
    });
  }

  r.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof InvestigationError) {
      res.status(err.status).json(err.toDto(req.id === undefined ? undefined : String(req.id)));
      return;
    }
    next(err);
  });

  return r;
}
