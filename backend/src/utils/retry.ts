export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}

export const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/** Parse Retry-After header (seconds or HTTP date) into ms. */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseMs?: number; maxMs?: number } = {},
): Promise<T> {
  const { retries = 3, baseMs = 500, maxMs = 30_000 } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err instanceof HttpError && RETRYABLE_STATUS.has(err.status);
      if (!retryable || attempt >= retries) throw err;
      const backoff = err.retryAfterMs ?? Math.min(maxMs, baseMs * 2 ** attempt);
      await sleep(Math.min(maxMs, backoff));
    }
  }
}

/** Minimal promise queue capping concurrent tasks. */
export function createLimiter(concurrency: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const next = () => {
    if (active >= concurrency) return;
    const run = waiting.shift();
    if (run) run();
  };
  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        active++;
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}
