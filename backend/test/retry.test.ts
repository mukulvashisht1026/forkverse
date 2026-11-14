import { describe, expect, it } from 'vitest';
import { HttpError, createLimiter, parseRetryAfter, withRetry } from '../src/utils/retry.js';
import { registrableDomain } from '../src/clients/rdap.js';
import { renderMigration } from '../src/db/migrate.js';

describe('retry utils', () => {
  it('parses Retry-After seconds', () => {
    expect(parseRetryAfter('2')).toBe(2000);
    expect(parseRetryAfter(null)).toBeUndefined();
  });
  it('retries 429 then succeeds; does not retry 402', async () => {
    let n = 0;
    const ok = await withRetry(async () => {
      if (n++ === 0) throw new HttpError(429, 'slow', 1);
      return 'ok';
    });
    expect(ok).toBe('ok');
    let m = 0;
    await expect(withRetry(async () => { m++; throw new HttpError(402, 'pay'); })).rejects.toThrow('pay');
    expect(m).toBe(1);
  });
  it('limiter caps concurrency', async () => {
    const limit = createLimiter(2);
    let active = 0, peak = 0;
    await Promise.all(Array.from({ length: 6 }, () => limit(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    })));
    expect(peak).toBe(2);
  });
});

describe('misc', () => {
  it('registrableDomain', () => {
    expect(registrableDomain('www.news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(registrableDomain('edition.cnn.com')).toBe('cnn.com');
  });
  it('renderMigration substitutes dim', () => {
    expect(renderMigration('vector(${EMBEDDING_DIM})', 768)).toBe('vector(768)');
  });
});
