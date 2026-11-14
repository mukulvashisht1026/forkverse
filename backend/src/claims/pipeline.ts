/**
 * Claim graph pipeline, shared by research runs, live monitors and the chat "Build claims" action:
 *
 *   1. screen   every source the builder will use (domain lists + page text, vetting/), so
 *               manipulative ones are pruned BEFORE claims are extracted;
 *   2. build    claims from the remaining evidence (claims/builder.ts);
 *   3. corroborate each claim with independent outlets (claims/corroborate.ts);
 *   4. screen   the new corroborating pages too; manipulative ones are stored (faded, with the
 *               reason) but removed from the claims, whose status is recomputed;
 *   5. store    corroborating evidence + claims.
 * Without a VettingService (tests, disabled) steps 1 and 4 are skipped.
 */
import type { InvestigationStore } from '../investigations/store.js';
import type { ClaimDto, InvestigationRecord, SourceVettingDto } from '../investigations/types.js';
import type { JsonLlm } from '../proof/agents.js';
import type { Scraper } from '../proof/articles.js';
import { articleBranchId } from '../research/articles.js';
import type { VettingService } from '../vetting/service.js';
import { buildClaims, decideStatus, type BuildResult } from './builder.js';
import { corroborateClaims, outcomeOf, storeCorroboration, type NewsSearch } from './corroborate.js';

export interface ClaimPipelineDeps {
  store: InvestigationStore;
  vetting?: VettingService;
  scrape?: Scraper;
  json?: JsonLlm;
  search?: NewsSearch;
  token?: (text: string) => void;
  /** Evidence ids that must be included (e.g. just added by a live monitor). */
  prefer?: readonly string[];
}

export interface ClaimPipelineResult {
  built: BuildResult;
  claims: ClaimDto[];
  corroborationAdded: number;
  screened: number;
  pruned: number;
}

/** Remove evidence from manipulative sources and recompute each claim's status. */
export function pruneClaims(record: Pick<InvestigationRecord, 'mode'>, claims: ClaimDto[], manipulative: ReadonlySet<string>): ClaimDto[] {
  if (!manipulative.size) return claims;
  const politician = record.mode === 'politician';
  return claims.flatMap((c) => {
    const evidence = c.evidence.filter((e) => !manipulative.has(e.evidenceId));
    if (evidence.length === c.evidence.length) return [c];
    if (!evidence.length) return []; // nothing independent left to show
    const sourceEvidence = politician ? evidence.filter((e) => e.role !== 'outcome') : evidence;
    return [{ ...c, evidence, ...decideStatus(sourceEvidence.length ? sourceEvidence : evidence), ...(politician && { outcome: outcomeOf(c, evidence) }) }];
  });
}

export async function buildClaimGraph(investigationId: string, deps: ClaimPipelineDeps): Promise<ClaimPipelineResult> {
  const { store, vetting, token } = deps;
  const load = async () => {
    const r = await store.get(investigationId);
    if (!r) throw new Error(`Investigation "${investigationId}" was not found.`);
    return r;
  };

  // 1. Screen the sources the builder will read (pruned ones make room for the next candidates).
  const first = vetting ? await vetting.vetForGraph(investigationId, { ...(deps.prefer && { prefer: deps.prefer }), ...(token && { token }) }) : { checked: 0, flagged: 0 };

  // 2. Build from the screened evidence (pickEvidence drops manipulative sources).
  const record = await load();
  const built = await buildClaims(record, { ...(deps.scrape && { scrape: deps.scrape }), ...(deps.json && { json: deps.json }), ...(token && { token }), ...(deps.prefer && { prefer: deps.prefer }) });

  // 3. Corroborate with independent outlets.
  token?.('- Looking for more independent sources per claim…\n');
  const corroborated = await corroborateClaims(record, built.claims, { ...(deps.json && { json: deps.json }), ...(deps.search && { search: deps.search }) });

  // 4. Screen the new corroborating pages before they count.
  let screenedAdded = new Map<string, SourceVettingDto>();
  if (vetting && corroborated.added.length) {
    token?.(`- Screening ${corroborated.added.length} corroborating source${corroborated.added.length === 1 ? '' : 's'} for propaganda…\n`);
    screenedAdded = await vetting.vetUrls(investigationId, corroborated.added.map((a) => ({ url: a.url, title: a.title })));
  }
  const manipulative = new Set(corroborated.added.filter((a) => screenedAdded.get(a.url)?.verdict === 'manipulative').map((a) => articleBranchId(a.url)));
  const claims = pruneClaims(record, corroborated.claims, manipulative);

  // 5. Store: every corroborating page is kept as evidence (with its screening), claims without the pruned ones.
  await storeCorroboration(store, investigationId, corroborated.added, screenedAdded);
  await store.setClaims(investigationId, { claims, links: built.links.filter((l) => claims.some((c) => c.id === l.from) && claims.some((c) => c.id === l.to)), entity: built.entity ?? record.entity });
  if (manipulative.size) token?.(`- ${manipulative.size} corroborating source${manipulative.size === 1 ? '' : 's'} flagged as manipulative and left out of the claims.\n`);

  return { built: { ...built, claims }, claims, corroborationAdded: corroborated.added.length, screened: first.checked + screenedAdded.size, pruned: first.flagged + manipulative.size };
}
