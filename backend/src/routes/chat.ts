/**
 * Chat API.
 *
 * POST /chat              { message, thread_id?, entity_id? } -> { thread_id, reply, messages }
 *   Omit thread_id to start a new conversation; send the returned thread_id to continue it.
 * GET  /chat/:threadId    -> { thread_id, messages }   (404 if the thread does not exist)
 *
 * TODO:
 *   - POST /chat/stream (SSE) backed by streamAgent().
 *   - Rate limiting per IP / thread, since each turn costs LLM calls.
 */
import { Router } from 'express';
import { z } from 'zod';
import { getThreadMessages, runAgent } from '../agent/index.js';

export const chatRouter = Router();

const threadId = z.string().uuid();

const ChatBody = z.object({
  message: z.string().trim().min(1).max(4000),
  thread_id: threadId.optional(),
  entity_id: z.string().min(1).optional(),
});

chatRouter.post('/chat', async (req, res) => {
  const parsed = ChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const { message, thread_id, entity_id } = parsed.data;
  const result = await runAgent({ message, threadId: thread_id, entityId: entity_id });
  res.json({ thread_id: result.threadId, reply: result.reply, messages: result.messages });
});

chatRouter.get('/chat/:threadId', async (req, res) => {
  const parsed = threadId.safeParse(req.params.threadId);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_thread_id' });
    return;
  }
  const messages = await getThreadMessages(parsed.data);
  if (!messages) {
    res.status(404).json({ error: 'thread_not_found' });
    return;
  }
  res.json({ thread_id: parsed.data, messages });
});
