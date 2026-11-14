import { describe, expect, it } from 'vitest';
import type { Article } from '../src/research/articles.js';
import { countUpdateStamps, findLiveSources } from '../src/monitors/liveSources.js';

const NOW = new Date('2026-11-14T12:00:00Z');
const art = (url: string, title: string, publishedAt: string | null): Article => ({ url, title, description: null, domain: new URL(url).hostname, sourceName: null, publishedAt, tool: 'context_get-news-search' });

describe('countUpdateStamps', () => {
  it('counts distinct clock times and "ago" stamps', () => {
    expect(countUpdateStamps('11:42 GMT Talks resume\n11:30 GMT Envoy arrives\n11:30 GMT dup\nUpdated 5 min ago')).toBe(3);
    expect(countUpdateStamps('A normal article with no times.')).toBe(0);
  });
});

describe('findLiveSources', () => {
  it('ranks a fresh, frequently updated live page first and verifies by reading it', async () => {
    const search = async (q: string) =>
      q.endsWith('live updates')
        ? [
            art('https://news.example/world/live/ceasefire-talks', 'Ceasefire talks: live updates', '2026-11-14T11:55:00Z'),
            art('https://paper.example/analysis/why-talks-matter', 'Why the talks matter', '2026-11-13T08:00:00Z'),
          ]
        : [art('https://wire.example/world/talks-latest', 'Talks latest', '2026-11-14T10:00:00Z')];
    const pages: Record<string, string> = {
      'https://news.example/world/live/ceasefire-talks': Array.from({ length: 20 }, (_, i) => `11:${String(i * 2).padStart(2, '0')} GMT entry ${i}`).join('\n'),
      'https://wire.example/world/talks-latest': 'Story text, updated 30 min ago.',
    };
    const scraped: string[] = [];
    const items = await findLiveSources('ceasefire talks', {
      search,
      scrape: async (url) => {
        scraped.push(url);
        return pages[url] ? { ok: true, markdown: pages[url]! } : { ok: false, error: 'WEBSITE_BLOCKED' };
      },
      now: () => NOW,
    });
    expect(items[0]).toMatchObject({ url: 'https://news.example/world/live/ceasefire-talks', minutesSinceUpdate: 5, updateStamps: 20, readable: true });
    expect(items[0]!.signals).toEqual(expect.arrayContaining(['live page', 'published 5 min ago', '20 timestamped updates on the page']));
    const blocked = items.find((i) => i.url.includes('analysis'));
    expect(blocked).toMatchObject({ readable: false, error: 'WEBSITE_BLOCKED' });
    expect(scraped).toHaveLength(3);
  });
});
