import { describe, expect, it } from 'vitest';
import { buildClaims, decideStatus, pickEvidence } from '../src/claims/builder.js';
import type { ClaimEvidenceDto, InvestigationRecord } from '../src/investigations/types.js';
import type { JsonLlm } from '../src/proof/agents.js';

const ev = (publisher: string, stance: ClaimEvidenceDto['stance'], quote = 'Trump promised to cut taxes for families', url = `https://${publisher.toLowerCase().replace(/\s/g, '')}.test/a`): ClaimEvidenceDto =>
  ({ evidenceId: `${publisher}-${stance}`, stance, quote, title: 't', publisher, url });

describe('claim status is decided by evidence, not a fixed count', () => {
  it('two independent outlets -> established', () => {
    const s = decideStatus([ev('Reuters', 'supports'), ev('BBC', 'supports')]);
    expect(s.status).toBe('established');
    expect(s.statusReason).toMatch(/2 independent outlets \(Reuters, BBC\)/);
  });
  it('one outlet -> pending with what is missing', () => {
    const s = decideStatus([ev('Reuters', 'supports'), ev('Reuters', 'supports')]);
    expect(s.status).toBe('pending');
    expect(s.statusReason).toMatch(/Only one outlet \(Reuters\).*awaiting independent corroboration/);
  });
  it('hedged wording does not count (rumours never become facts)', () => {
    const s = decideStatus([ev('Daily A', 'supports', 'He reportedly plans to cut taxes'), ev('Daily B', 'supports', 'Sources say a tax cut is coming')]);
    expect(s.status).toBe('pending');
    expect(s.statusReason).toMatch(/hedged wording/);
  });
  it('a primary/official source can establish a claim alone', () => {
    const s = decideStatus([ev('IRS', 'supports', 'The new brackets apply from 2026', 'https://www.irs.gov/newsroom/x')]);
    expect(s.status).toBe('established');
    expect(s.statusReason).toMatch(/primary\/official source/);
  });
  it('contradicting outlets mark the claim disputed and are named', () => {
    const s = decideStatus([ev('Reuters', 'supports'), ev('BBC', 'supports'), ev('Fox', 'contradicts')]);
    expect(s).toMatchObject({ status: 'established', disputed: true });
    expect(s.statusReason).toMatch(/Disputed by Fox/);
  });
});

const TEXT: Record<string, string> = {
  'https://r.test/1': 'During the 2024 campaign Trump promised to cut taxes for middle-class families. ' + 'filler text about the campaign trail and voters. '.repeat(12),
  'https://b.test/1': 'Trump promised to cut taxes for middle-class families, the campaign said on Monday. ' + 'more filler about rallies and polls. '.repeat(12),
  'https://g.test/1': 'In 2026 the administration proposed raising tariffs that economists say act as a tax on consumers. ' + 'filler about trade data. '.repeat(16),
};
const rec = (): InvestigationRecord => ({
  id: 'inv', title: 'Trump on taxes', topic: 'Trump on taxes', visibility: 'public', status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1,
  events: [{ id: 'e1', title: 'Taxes', evidence: [
    { id: 'r1', title: 'Reuters piece', sourceName: 'Reuters', sourceUrl: 'https://r.test/1', publishedAt: '2024-09-01T00:00:00Z' },
    { id: 'r2', title: 'Reuters again', sourceName: 'Reuters', sourceUrl: 'https://r.test/2', publishedAt: '2024-09-02T00:00:00Z' },
    { id: 'b1', title: 'BBC piece', sourceName: 'BBC', sourceUrl: 'https://b.test/1', publishedAt: '2024-09-03T00:00:00Z' },
    { id: 'g1', title: 'Guardian piece', sourceName: 'Guardian', sourceUrl: 'https://g.test/1', excerpt: 'Tariffs rise', publishedAt: '2026-02-01T00:00:00Z' },
  ] }],
});

describe('buildClaims', () => {
  it('samples round-robin across outlets', () => {
    expect(pickEvidence(rec(), 3).map((e) => e.id)).toEqual(['r1', 'b1', 'g1']);
  });

  it('merges the same claim across outlets, keeps single-outlet claims pending, orients links', async () => {
    const json: JsonLlm = async (schema, messages) => {
      const system = String(messages[0]!.content);
      const user = String(messages[1]!.content);
      if (system.startsWith('Extract the specific claims')) {
        if (user.includes('Reuters piece') || user.includes('BBC piece')) {
          return schema.parse({ claims: [{ statement: 'Trump promised tax cuts for families.', kind: 'statement', quote: 'Trump promised to cut taxes for middle-class families' }] });
        }
        if (user.includes('Guardian piece')) {
          return schema.parse({ claims: [{ statement: 'Tariffs were proposed in 2026.', kind: 'development', quote: 'In 2026 the administration proposed raising tariffs' }] });
        }
        return schema.parse({ claims: [{ statement: 'Made up', kind: 'statement', quote: 'words that are not in this article' }] }); // Reuters #2: unreadable -> fallback text
      }
      // merge step: K1 (Reuters) + K2 (BBC) are the same claim; K3 (Guardian) left unassigned on purpose
      return schema.parse({
        entity: 'Donald Trump',
        claims: [{ key: 'C1', statement: 'Trump promised to cut taxes for middle-class families.', kind: 'statement', members: [{ candidate: 'K1', stance: 'supports' }, { candidate: 'K2', stance: 'supports' }, { candidate: 'K99', stance: 'supports' }] }],
        links: [{ from: 'K3', to: 'C1', type: 'potential_inconsistency', basis: 'inferred', description: 'A later tariff proposal may conflict with the earlier tax-cut promise.' }],
      });
    };
    const scrape = async (url: string) => (TEXT[url] ? { ok: true as const, markdown: TEXT[url]! } : { ok: false as const, error: 'blocked' });
    const out = await buildClaims(rec(), { json, scrape });

    expect(out.entity).toBe('Donald Trump');
    expect(out.claims.map((c) => c.statement)).toEqual([
      'Trump promised to cut taxes for middle-class families.', // 2024 -> first
      'Tariffs were proposed in 2026.', // unassigned candidate kept as its own claim
    ]);
    expect(out.claims[0]).toMatchObject({ status: 'established', occurredAt: '2024-09-01T00:00:00Z' });
    expect(out.claims[0]!.evidence.map((e) => e.publisher)).toEqual(['Reuters', 'BBC']);
    expect(out.claims[1]).toMatchObject({ status: 'pending' }); // one outlet only
    expect(out.links).toHaveLength(1);
    expect(out.links[0]).toMatchObject({ from: out.claims[0]!.id, to: out.claims[1]!.id, type: 'potential_inconsistency', basis: 'inferred' });
    expect(out.stats).toMatchObject({ claims: 2, established: 1, pending: 1, quotesVerified: 3, quotesRejected: 1 });

    const again = await buildClaims(rec(), { json, scrape });
    expect(again.claims.map((c) => c.id)).toEqual(out.claims.map((c) => c.id)); // stable ids across rebuilds
  });
});

import { similarity } from '../src/claims/builder.js';
describe('deterministic claim matching (merge fallback)', () => {
  it('matches the same fact worded differently, not different facts', () => {
    expect(similarity('Fines can reach 35 million euros or 7% of global turnover.', 'Companies face fines up to 35 million euros or 7% of turnover.')).toBeGreaterThanOrEqual(0.34);
    expect(similarity('Fines can reach 35 million euros or 7% of global turnover.', 'The AI Office opened its first investigation.')).toBeLessThan(0.34);
  });
});
