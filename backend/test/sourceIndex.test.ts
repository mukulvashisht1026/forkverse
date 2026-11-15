import { describe, expect, it, vi } from 'vitest';
import type { SourceVettingDto } from '../src/investigations/types.js';
import { SourceIndex, isFlagged, sourceDocId, vettingEmbeddingText } from '../src/vetting/sourceIndex.js';

const vetting: SourceVettingDto = {
  url: 'https://www.spoof.example/news/1?utm_source=x',
  verdict: 'manipulative',
  coverage: 1,
  propagandaScore: 78,
  reasons: ['The page\'s own text uses propaganda techniques (name calling).'],
  depth: 'content',
  checkedAt: '2026-11-14T10:00:00Z',
  rhetoric: {
    verdict: 'likely_propaganda', modelVerdict: 'likely_propaganda', genre: 'opinion', language: 'en', rationale: 'Repeated smears.',
    techniques: [{ technique: 'name_calling', quote: 'these parasites', explanation: '', voice: 'author' }], counterevidence: [], score: 78, warnings: [],
  },
};

describe('source index (embeddings)', () => {
  it('embeds verdict, score, reasons and verified quotes; red flag above 60', () => {
    const text = vettingEmbeddingText(vetting, 'Spoof story');
    expect(text).toContain('propaganda score 78/100 (red flag)');
    expect(text).toContain('Technique name calling (author): "these parasites"');
    expect(isFlagged(vetting)).toBe(true);
    expect(isFlagged({ propagandaScore: 60 })).toBe(false);
  });

  it('upserts one document per URL with embedding and accumulates investigations', async () => {
    const updateOne = vi.fn(async () => ({}));
    const embed = vi.fn(async () => [0.1, 0.2]);
    const index = new SourceIndex({ updateOne } as never, embed);
    await index.upsert(vetting, { title: 'Spoof story', investigationId: 'inv1' });
    const [filter, update] = updateOne.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, Record<string, unknown>>];
    expect(filter).toEqual({ _id: sourceDocId('https://spoof.example/news/1?utm_source=x') });
    expect(update.$set).toMatchObject({ domain: 'spoof.example', vet_verdict: 'manipulative', vet_risk: 0.78, vet_flagged: true, embedding: [0.1, 0.2], readable: true });
    expect(update.$addToSet).toEqual({ investigation_ids: 'inv1' });
    expect(embed).toHaveBeenCalledWith(expect.stringContaining('Spoof story'));
  });
});
