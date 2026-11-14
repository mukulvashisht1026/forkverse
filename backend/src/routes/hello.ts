import { Router } from 'express';

export const helloRouter = Router();

helloRouter.get('/hello', (_req, res) => {
  res.json({ message: 'hello' });
});
