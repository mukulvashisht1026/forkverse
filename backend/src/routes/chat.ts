
import { Router } from 'express';
import { runAgent, getThreadMessages } from '../agent/index.js';

export const chatRouter = Router();

chatRouter.get('/chat', async (req, res) => {
  const message = String(req.query.message ?? '').trim();
  const threadId = req.query.threadId
    ? String(req.query.threadId)
    : undefined;

  const entityId = req.query.entityId
    ? String(req.query.entityId)
    : undefined;

  if (!message) {
    res.status(400).json({
      error: 'message_required',
    });
    return;
  }

  const result = await runAgent({
    message,
    threadId,
    entityId,
  });

  res.json(result);
});

chatRouter.get('/chat/:threadId/messages', async (req, res) => {
  const messages = await getThreadMessages(req.params.threadId);

  if (!messages) {
    res.status(404).json({ error: 'thread_not_found' });
    return;
  }

  res.json({ messages });
});
