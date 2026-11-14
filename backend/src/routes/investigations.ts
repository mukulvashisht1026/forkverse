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
 *      action extend_graph: research run + graph_updated. Cited/added evidence is highlighted
 *      on /ws via `investigation:highlight`.
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
import { InvestigationError, toGraphDto, toInvestigationDto, type InvestigationService } from '../investigations/service.js';
import type { ResearchStreamEventDto } from '../investigations/types.js';
import { logger } from '../utils/logger.js';

const RunBody = z.object({
  topic: z.string(),
  context: z.string().optional(),
});

const ResearchBody = z.object({
  investigationId: z.string(),
  action: z.enum(['answer_question', 'extend_graph']),
  message: z.string(),
  conversationId: z.string().optional(),
});

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

export function investigationsRouter(service: InvestigationService, chat?: ResearchChatService): Router {
  const r = Router();

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
      const { record, message } = await chat.prepare(id, body.action, body.message);

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
        await chat.run(record, body.action, message, send, abort.signal);
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
