import { describe, expect, it, vi } from 'vitest';
import type { ClaimDto } from '../src/investigations/types.js';
import { groundedWhen, happenedAtOf } from '../src/claims/builder.js';
import { buildPeriods, chooseGranularity, groupClaims, periodLabel } from '../src/claims/periods.js';

const ev = (id: string, publisher: string) => ({ evidenceId: id, stance: 'supports' as const, quote: 'q', title: `T ${id}`, publisher, url: `https://${publisher}/${id}` });
const claim = (id: string, dates: { happenedAt?: string; occurredAt?: string }, status: ClaimDto['status'] = 'established', evidence = [ev(`${id}a`, 'one.example'), ev(`${id}b`, 'two.example')]): ClaimDto => ({
  id, statement: `Statement ${id}.`, kind: 'development', status, statusReason: '', disputed: false, ...dates, evidence,
});

describe('claim dates', () => {
  it('keeps a stated date only if well-formed and its year appears in the article', () => {
    expect(groundedWhen('2010-06', 'In June 2010 she released...')).toBe('2010-06');
    expect(groundedWhen('2010', 'No year here')).toBeUndefined();
    expect(groundedWhen('June 2010', 'June 2010')).toBeUndefined();
    expect(groundedWhen('2010-13', '2010')).toBeUndefined();
    expect(groundedWhen(null, '2010')).toBeUndefined();
  });

  it('takes the earliest stated date, most precise within that year', () => {
    expect(happenedAtOf(['2012', '2010', '2010-06-12', undefined])).toBe('2010-06-12');
    expect(happenedAtOf([undefined])).toBeUndefined();
  });
});

describe('timeline periods', () => {
  it('uses years for multi-year stories, ordered by when it happened (not when it was reported)', () => {
    const claims = [
      claim('late', { happenedAt: '2016-07', occurredAt: '2024-01-01T00:00:00Z' }),
      claim('early', { happenedAt: '2010', occurredAt: '2024-02-01T00:00:00Z' }),
      claim('mid', { happenedAt: '2012-11-02' }),
      claim('mid2', { happenedAt: '2012-03' }),
      claim('nodate', {}),
    ];
    expect(chooseGranularity(claims)).toBe('year');
    expect(groupClaims(claims).map((g) => [g.key, g.claims.map((c) => c.id)])).toEqual([
      ['2010', ['early']], ['2012', ['mid', 'mid2']], ['2016', ['late']], ['undated', ['nodate']],
    ]);
  });

  it('uses months within a year and days within a few weeks', () => {
    expect(chooseGranularity([claim('a', { happenedAt: '2024-01-05' }), claim('b', { happenedAt: '2024-04-01' }), claim('c', { happenedAt: '2024-09' })])).toBe('month');
    expect(chooseGranularity([claim('a', { occurredAt: '2024-05-01T10:00:00Z' }), claim('b', { occurredAt: '2024-05-03T10:00:00Z' })])).toBe('day');
    expect(periodLabel('2010')).toBe('2010');
    expect(periodLabel('2010-06')).toBe('June 2010');
    expect(periodLabel('2010-06-12')).toBe('12 Jun 2010');
  });

  it('writes summaries citing only claims of that period; falls back to claim statements', async () => {
    const claims = [
      claim('a', { happenedAt: '2010' }),
      claim('b', { happenedAt: '2012' }, 'pending', [ev('b1', 'solo.example')]),
      claim('c', { happenedAt: '2014' }),
    ];
    const json = vi.fn(async () => ({
      periods: [
        { key: 'P1', headline: 'First event.', summary: [{ text: 'It happened', claims: ['C1'] }, { text: 'Borrowed from another period.', claims: ['C2'] }, { text: 'Uncited.', claims: [] }] },
        { key: 'P2', headline: 'Second', summary: ['Reportedly so [C2]'] },
        { key: 'P3', headline: 'Third', summary: [{ text: 'Invented.', claims: ['C9'] }] },
      ],
    }));
    const periods = await buildPeriods(claims, { topic: 't', json: json as never });
    expect(periods.map((p) => [p.label, p.headline, p.summary, p.writer])).toEqual([
      ['2010', 'First event', 'It happened.', 'llm'],
      ['2012', 'Second', 'Reportedly so.', 'llm'],
      ['2014', 'Statement c', 'Statement c.', 'fallback'],
    ]);
    expect(periods[0]).toMatchObject({ granularity: 'year', start: '2010-01-01', claimIds: ['a'], established: 1, unverified: 0 });
    expect(periods[1]).toMatchObject({ unverified: 1, sources: [{ title: 'T b1', url: 'https://solo.example/b1', publisher: 'solo.example' }] });

    const failed = await buildPeriods(claims, { topic: 't', json: vi.fn(async () => { throw new Error('down'); }) as never });
    expect(failed[1]).toMatchObject({ writer: 'fallback', headline: 'Statement b', summary: 'Unverified so far: Statement b.' });
  });
});

describe('off-topic articles', () => {
  it('needs a key term or entity name part; politicians and unknown subjects are not filtered', async () => {
    const { mentionsSubject } = await import('../src/claims/builder.js');
    const btc = { plan: { queries: [], keyTerms: ['bitcoin', 'btc'] }, entity: 'Bitcoin' };
    expect(mentionsSubject(btc, 'Bitcoin trades around $78,000')).toBe(true);
    expect(mentionsSubject(btc, 'NS1 has added 43 new customers')).toBe(false);
    expect(mentionsSubject({ entity: 'Narendra Modi' }, 'Modi pledged 100 smart cities')).toBe(true);
    expect(mentionsSubject({ entity: 'Narendra Modi', mode: 'politician' }, 'Official data shows job creation fell short')).toBe(true);
    expect(mentionsSubject({}, 'anything')).toBe(true);
  });
});

describe('result limits', () => {
  it('every Context.dev search asks for at most 5 links, whatever the model requested', async () => {
    const { capResults } = await import('../src/research/run.js');
    const seen: unknown[] = [];
    const fake = (name: string) => ({ name, invoke: async (x: unknown) => { seen.push(x); return 'ok'; } }) as never;
    await capResults(fake('context_get-news-search')).invoke({ type: 'tool_call', name: 'n', id: '1', args: { query: 'q', limit: 25 } } as never);
    await capResults(fake('context_web-search')).invoke({ query: 'q', numResults: 50 } as never);
    await capResults(fake('context_web-search')).invoke({ query: 'q' } as never);
    expect(seen).toEqual([
      { type: 'tool_call', name: 'n', id: '1', args: { query: 'q', limit: 5 } },
      { query: 'q', numResults: 5 },
      { query: 'q', numResults: 5 },
    ]);
  });
});
