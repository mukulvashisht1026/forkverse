import { describe, expect, it } from 'vitest';
import { corroborateClaims } from '../src/claims/corroborate.js';
import type { ClaimDto, InvestigationRecord } from '../src/investigations/types.js';
import type { JsonLlm } from '../src/proof/agents.js';

const rec = { id: 'i', title: 'Modi', topic: 'Modi', mode: 'politician', entity: 'Narendra Modi', visibility: 'public', status: 'active', createdAt: 'x', updatedAt: 'x', revision: 1, events: [] } as unknown as InvestigationRecord;
const claim: ClaimDto = {
  id: 'c1', statement: 'Modi promised 20 million jobs a year.', kind: 'statement', status: 'pending', statusReason: '', disputed: false, outcome: 'no_update',
  evidence: [{ evidenceId: 'e1', stance: 'supports', quote: 'q', title: 't', publisher: 'A', url: 'https://a.test/1', role: 'source' }],
};

describe('corroborateClaims', () => {
  it('adds independent sources with verified quotes and recomputes status/outcome', async () => {
    const search = async () => [
      { url: 'https://a.test/2', title: 'Same outlet again', description: null, domain: 'a.test', sourceName: 'A', publishedAt: null, tool: 'n' },
      { url: 'https://b.test/1', title: 'Modi promised 20 million jobs every year', description: 'Campaign pledge', domain: 'b.test', sourceName: 'B', publishedAt: '2014-04-02', tool: 'n' },
      { url: 'https://c.test/1', title: 'Jobs data falls short of promise', description: 'Job creation fell short of the 20 million target', domain: 'c.test', sourceName: 'C', publishedAt: '2019-01-01', tool: 'n' },
      { url: 'https://d.test/1', title: 'Cricket news', description: null, domain: 'd.test', sourceName: 'D', publishedAt: null, tool: 'n' },
    ];
    const json: JsonLlm = async (schema, messages) => {
      const user = String(messages[1]!.content);
      expect(user).not.toContain('Same outlet again'); // outlet A already backs the claim
      return schema.parse({ matches: [
        { ref: 'A1', stance: 'supports', role: 'source', quote: 'Modi promised 20 million jobs every year', summary: 'Reports the pledge.' },
        { ref: 'A2', stance: 'contradicts', role: 'outcome', quote: 'Job creation fell short of the 20 million target', summary: 'Data shows a shortfall.' },
        { ref: 'A3', stance: 'supports', role: 'source', quote: 'invented words not in the article', summary: '' },
      ] });
    };
    const out = await corroborateClaims(rec, [claim], { search, json });
    const c = out.claims[0]!;
    expect(c.evidence.map((e) => [e.publisher, e.role, e.stance])).toEqual([['A', 'source', 'supports'], ['B', 'source', 'supports'], ['C', 'outcome', 'contradicts']]);
    expect(c.status).toBe('established');
    expect(c.outcome).toBe('not_fulfilled');
    expect(out.added.map((a) => a.sourceName)).toEqual(['B', 'C']);
  });

  it('leaves claims alone when search finds nothing', async () => {
    const out = await corroborateClaims(rec, [claim], { search: async () => [], json: async () => { throw new Error('no call'); } });
    expect(out.claims[0]).toBe(claim);
    expect(out.added).toEqual([]);
  });
});
