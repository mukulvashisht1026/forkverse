import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Article } from '../src/research/articles.js';
import { articleBranchId } from '../src/research/articles.js';
import { MemoryInvestigationStore } from '../src/investigations/store.js';
import type { ClaimDto, InvestigationRecord, SourceVettingDto } from '../src/investigations/types.js';

const calls: string[] = [];
const corroborating: Article = { url: 'https://spoof.example/x', title: 'Spoof story', description: null, domain: 'spoof.example', sourceName: 'Spoof', publishedAt: null, tool: 'news' };

vi.mock('../src/claims/builder.js', async (orig) => {
  const real = await orig<typeof import('../src/claims/builder.js')>();
  return {
    ...real,
    buildClaims: vi.fn(async (record: InvestigationRecord) => {
      calls.push(`build:${real.pickEvidence(record).map((e) => e.id).join(',')}`);
      const claim: ClaimDto = { id: 'c1', statement: 'S', kind: 'development', status: 'pending', statusReason: '', disputed: false, evidence: [{ evidenceId: 'b', stance: 'supports', quote: 'q', title: 'B', publisher: 'B', url: 'https://b.example/2' }] };
      return { claims: [claim], links: [], stats: { articles: 1, fullText: 1, claims: 1, established: 0, pending: 1, quotesVerified: 1, quotesRejected: 0 } };
    }),
  };
});
vi.mock('../src/claims/corroborate.js', async (orig) => {
  const real = await orig<typeof import('../src/claims/corroborate.js')>();
  return {
    ...real,
    corroborateClaims: vi.fn(async (_r: InvestigationRecord, claims: ClaimDto[]) => {
      calls.push('corroborate');
      const id = articleBranchId(corroborating.url);
      return { claims: claims.map((c) => ({ ...c, evidence: [...c.evidence, { evidenceId: id, stance: 'supports' as const, quote: 'q', title: 'Spoof', publisher: 'Spoof', url: corroborating.url }] })), added: [corroborating] };
    }),
  };
});

const { buildClaimGraph, pruneClaims } = await import('../src/claims/pipeline.js');
const { VettingService } = await import('../src/vetting/service.js');

const v = (url: string, verdict: SourceVettingDto['verdict']): SourceVettingDto => ({ url, verdict, coverage: 1, reasons: [], depth: 'content', checkedAt: '' });

async function setup(verdicts: Record<string, SourceVettingDto['verdict']>) {
  const store = new MemoryInvestigationStore();
  const now = '2026-11-14T00:00:00Z';
  await store.create({ id: 'inv', title: 't', topic: 't', visibility: 'public', status: 'active', createdAt: now, updatedAt: now, revision: 1, events: [{ id: 'e1', title: 'E', evidence: [] }] });
  await store.addEvidence('inv', 'e1', { id: 'a', title: 'A', sourceUrl: 'https://a.example/1', sourceName: 'A' });
  await store.addEvidence('inv', 'e1', { id: 'b', title: 'B', sourceUrl: 'https://b.example/2', sourceName: 'B' });
  const vetted: string[] = [];
  const frames: { type: string; payload: Record<string, unknown> }[] = [];
  const vetting = new VettingService({
    store,
    publish: (f) => frames.push(f as never),
    scrape: vi.fn() as never,
    json: vi.fn() as never,
    vet: async (url) => {
      vetted.push(url);
      calls.push(`vet:${url}`);
      return v(url, verdicts[url] ?? 'credible');
    },
  });
  return { store, vetting, vetted, frames };
}

beforeEach(() => {
  calls.length = 0;
});

describe('buildClaimGraph (automatic screening)', () => {
  it('screens every source before building, prunes manipulative ones, screens corroborating sources too', async () => {
    const { store, vetting, frames } = await setup({ 'https://a.example/1': 'manipulative', 'https://spoof.example/x': 'manipulative' });
    const tokens: string[] = [];
    const r = await buildClaimGraph('inv', { store, vetting, token: (t) => tokens.push(t) });

    // Screening happens first; the builder never sees the manipulative source.
    expect(calls.slice(0, 2).sort()).toEqual(['vet:https://a.example/1', 'vet:https://b.example/2']);
    expect(calls[2]).toBe('build:b');
    expect(calls.slice(3)).toEqual(['corroborate', 'vet:https://spoof.example/x']);

    // The manipulative corroborating source is stored (with its screening) but not in the claim.
    const rec = (await store.get('inv'))!;
    const spoof = rec.events.flatMap((e) => e.evidence).find((e) => e.sourceUrl === corroborating.url);
    expect(spoof?.vetting?.verdict).toBe('manipulative');
    expect(rec.claims![0]!.evidence.map((e) => e.evidenceId)).toEqual(['b']);
    // ...but kept on the claim as a red-flagged, non-counting source.
    expect(rec.claims![0]!.prunedEvidence?.map((e) => e.url)).toEqual([corroborating.url]);
    expect(r).toMatchObject({ screened: 3, pruned: 2, corroborationAdded: 1 });
    expect(rec.events[0]!.evidence.map((e) => e.vetting?.verdict)).toEqual(['manipulative', 'credible']);
    expect(frames.some((f) => f.type === 'investigation:vetting' && f.payload.phase === 'done')).toBe(true);
    expect(tokens.join('')).toContain('Screening 2 sources for propaganda');
  });

  it('already screened sources are not screened again', async () => {
    const { store, vetting, vetted } = await setup({});
    await buildClaimGraph('inv', { store, vetting });
    vetted.length = 0;
    await buildClaimGraph('inv', { store, vetting });
    expect(vetted).toEqual(['https://spoof.example/x']); // only the freshly found corroborating page
  });

  it('without a vetting service the pipeline still builds (domain lists only)', async () => {
    const { store } = await setup({});
    await buildClaimGraph('inv', { store });
    expect(calls).toEqual(['build:a,b', 'corroborate']);
  });
});

describe('pruneClaims', () => {
  it('drops manipulative evidence, recomputes status, removes claims left without evidence', () => {
    const ev = (id: string, publisher: string) => ({ evidenceId: id, stance: 'supports' as const, quote: 'q', title: id, publisher, url: `https://${publisher}/x` });
    const claims: ClaimDto[] = [
      { id: 'c1', statement: 's', kind: 'development', status: 'established', statusReason: '', disputed: false, evidence: [ev('a', 'one.example'), ev('b', 'two.example')] },
      { id: 'c2', statement: 's2', kind: 'development', status: 'pending', statusReason: '', disputed: false, evidence: [ev('b', 'two.example')] },
    ];
    const out = pruneClaims({ mode: 'news' }, claims, new Set(['a', 'x']));
    expect(out[0]).toMatchObject({ status: 'pending' });
    expect(out[0]!.evidence.map((e) => e.evidenceId)).toEqual(['b']);
    expect(pruneClaims({}, claims, new Set(['b'])).map((c) => c.id)).toEqual(['c1']);
  });
});
