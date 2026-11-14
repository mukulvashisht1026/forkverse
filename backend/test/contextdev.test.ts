import { describe, expect, it } from 'vitest';
import { normalizeScrape, normalizeSearchResults } from '../src/clients/contextdev.js';

describe('normalizeSearchResults', () => {
  it('handles nested arrays, alt keys and dedupes by url', () => {
    const raw = {
      data: {
        articles: [
          { link: 'https://www.example.com/a', headline: 'A', date: '2026-01-01' },
          { link: 'https://www.example.com/a', headline: 'dup' },
          { url: 'https://news.test/b', title: 'B', source: { domain: 'news.test' } },
          { title: 'no url' },
        ],
      },
    };
    const out = normalizeSearchResults(raw);
    expect(out.map((r) => r.url)).toEqual(['https://www.example.com/a', 'https://news.test/b']);
    expect(out[0]).toMatchObject({ title: 'A', publishedAt: '2026-01-01', domain: 'example.com' });
  });
  it('returns [] for unknown shapes', () => {
    expect(normalizeSearchResults(null)).toEqual([]);
    expect(normalizeSearchResults({ foo: 1 })).toEqual([]);
  });
});

describe('normalizeScrape', () => {
  it('treats success:false output in a 200 as failure', () => {
    const r = normalizeScrape('u', { outputs: [{ success: false, error: 'blocked' }] });
    expect(r).toEqual({ success: false, url: 'u', error: 'blocked' });
  });
  it('extracts markdown and metadata', () => {
    const r = normalizeScrape('u', { success: true, data: { markdown: '# Hi', metadata: { title: 'T' } } });
    expect(r).toMatchObject({ success: true, markdown: '# Hi', title: 'T' });
  });
});
