/**
 * Vetting for investigations.
 *
 * - withSourceRatings(store): every evidence item added (research, corroboration, live
 *   monitors) gets its domain listing attached at once, for free.
 * - VettingService.start(id, evidenceIds?): background content screening of an investigation's
 *   sources (scrape + rhetoric), CONCURRENCY at a time, at most MAX_PER_RUN per run, one run
 *   per investigation. Each result is stored on the evidence (revision bump ->
 *   `investigation:updated`) and narrated as `investigation:vetting`.
 * - Sources judged manipulative are pruned from claim building (claims/builder.ts) and drawn
 *   faded with their reason in the graph.
 */
import { InvestigationError } from '../investigations/service.js';
import type { InvestigationStore } from '../investigations/store.js';
import type {
  InvestigationEvidenceDto,
  InvestigationUpdatedEvent,
  InvestigationVettingEvent,
  ResearchRunDto,
  SourceVettingDto,
} from '../investigations/types.js';
import { MAX_ARTICLES, mapLimit, pickEvidence } from '../claims/builder.js';
import { logger } from '../utils/logger.js';
import { domainVetting, vetUrl, type VetDeps } from './vet.js';
import { indexInBackground, type SourceIndex } from './sourceIndex.js';

export const MAX_PER_RUN = 12;
const CONCURRENCY = 3;
/** Automatic screening before graph building: parallel page reads + LLM calls. */
const AUTO_CONCURRENCY = 5;
/** Re-pick rounds: a pruned source makes room for the next candidate, which is screened too. */
const AUTO_ROUNDS = 3;

/** Store decorator: attach the domain listing to new evidence (no network, no LLM). */
export function withSourceRatings<S extends InvestigationStore>(store: S): S {
  const wrapped = Object.create(store) as S;
  wrapped.addEvidence = (id: string, eventId: string, evidence: InvestigationEvidenceDto) => {
    const vetting = !evidence.vetting && evidence.sourceUrl ? domainVetting(evidence.sourceUrl) : undefined;
    return store.addEvidence(id, eventId, vetting ? { ...evidence, vetting } : evidence);
  };
  return wrapped;
}

export interface VettingServiceDeps extends VetDeps {
  store: InvestigationStore;
  publish: (frame: InvestigationVettingEvent | InvestigationUpdatedEvent) => void;
  /** Optional: rebuild claims after a run that marked sources manipulative (prunes them). */
  rebuildClaims?: (investigationId: string) => Promise<void>;
  vet?: (url: string, title: string) => Promise<SourceVettingDto>;
  /** Embeds every screened source into the `sources` vector index (optional). */
  index?: SourceIndex;
}

export class VettingService {
  private active = new Set<string>();
  readonly running = new Map<string, Promise<void>>();

  constructor(private deps: VettingServiceDeps) {}

  /** Screen one page and index the result (embedding) in the background. */
  private async vetOne(url: string, title: string, investigationId?: string): Promise<SourceVettingDto> {
    const vetting = await (this.deps.vet ? this.deps.vet(url, title) : vetUrl(url, this.deps, title));
    indexInBackground(this.deps.index, vetting, { title, ...(investigationId && { investigationId }) });
    return vetting;
  }

  /**
   * Automatic screening before the graph is built: every source the claim builder would use
   * (pickEvidence, incl. `prefer`) is screened at content depth first. Manipulative ones drop out
   * of the pick, the next candidates move up and are screened too (bounded rounds).
   */
  async vetForGraph(investigationId: string, opts: { prefer?: readonly string[]; maxArticles?: number; token?: (text: string) => void } = {}): Promise<{ checked: number; flagged: number }> {
    const { store, publish } = this.deps;
    let checked = 0;
    let flagged = 0;
    let announced = false;
    for (let round = 0; round < AUTO_ROUNDS; round++) {
      const record = await store.get(investigationId);
      if (!record) break;
      const pending = pickEvidence(record, opts.maxArticles ?? MAX_ARTICLES, opts.prefer).filter((ev) => ev.sourceUrl && ev.vetting?.depth !== 'content');
      if (!pending.length) break;
      if (!announced) {
        announced = true;
        opts.token?.(`- Screening ${pending.length} source${pending.length === 1 ? '' : 's'} for propaganda before building the graph…\n`);
        this.say(investigationId, { phase: 'started', message: `Screening ${pending.length} source${pending.length === 1 ? '' : 's'} for propaganda before building the graph…`, checked: 0, total: pending.length });
      }
      await mapLimit(pending, AUTO_CONCURRENCY, async (ev) => {
        const vetting = await this.vetOne(ev.sourceUrl!, ev.title, investigationId);
        const revision = await store.setEvidenceVetting(investigationId, ev.id, vetting);
        checked += 1;
        if (vetting.verdict === 'manipulative') flagged += 1;
        publish({ type: 'investigation:updated', payload: { investigationId, revision, run: { id: `vet-auto-${investigationId}`, investigationId, status: 'running', startedAt: new Date().toISOString() } }, timestamp: new Date().toISOString() });
        this.say(investigationId, { phase: 'checked', evidenceId: ev.id, verdict: vetting.verdict, checked, total: Math.max(checked, pending.length), message: `${ev.sourceName ?? ev.title}: ${vetting.verdict}${vetting.error ? ' (page unreadable)' : ''}` });
      });
    }
    if (announced) {
      const message = `Screened ${checked} source${checked === 1 ? '' : 's'}: ${flagged} manipulative (pruned from claims).`;
      opts.token?.(`- ${message}\n`);
      this.say(investigationId, { phase: 'done', checked, total: checked, message });
    }
    return { checked, flagged };
  }

  /** Screen candidate pages (e.g. corroborating articles) before they join the graph. */
  async vetUrls(investigationId: string, items: { url: string; title: string }[]): Promise<Map<string, SourceVettingDto>> {
    const out = new Map<string, SourceVettingDto>();
    if (!items.length) return out;
    let checked = 0;
    await mapLimit(items, AUTO_CONCURRENCY, async ({ url, title }) => {
      const vetting = await this.vetOne(url, title, investigationId);
      out.set(url, vetting);
      checked += 1;
      this.say(investigationId, { phase: 'checked', verdict: vetting.verdict, checked, total: items.length, message: `Corroborating source ${title.slice(0, 60)}: ${vetting.verdict}` });
    });
    return out;
  }

  /** Vet one URL on demand (any website). */
  vetUrl(url: string): Promise<SourceVettingDto> {
    if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new InvestigationError(400, 'invalid_url', 'A valid http(s) URL is required.');
    return this.vetOne(url, '');
  }

  /**
   * Queue content screening for the investigation's sources. Without evidenceIds: sources not yet
   * screened at content depth, newest first. Returns how many were queued.
   */
  async start(investigationId: string, evidenceIds?: string[]): Promise<{ queued: number; total: number }> {
    const record = await this.deps.store.get(investigationId);
    if (!record) throw new InvestigationError(404, 'investigation_not_found', `Investigation "${investigationId}" was not found.`);
    if (this.active.has(investigationId)) throw new InvestigationError(409, 'vetting_in_progress', 'Source vetting is already running for this investigation.');

    const seen = new Set<string>();
    const all = record.events
      .flatMap((e) => e.evidence)
      .filter((ev) => ev.sourceUrl && !seen.has(ev.id) && seen.add(ev.id));
    const wanted = evidenceIds?.length ? all.filter((ev) => evidenceIds.includes(ev.id)) : all.filter((ev) => ev.vetting?.depth !== 'content').reverse();
    const batch = wanted.slice(0, MAX_PER_RUN);
    if (!batch.length) return { queued: 0, total: all.length };

    this.active.add(investigationId);
    const p = this.run(investigationId, batch).finally(() => {
      this.active.delete(investigationId);
      this.running.delete(investigationId);
    });
    this.running.set(investigationId, p);
    return { queued: batch.length, total: all.length };
  }

  private say(investigationId: string, payload: Omit<InvestigationVettingEvent['payload'], 'investigationId'>) {
    this.deps.publish({ type: 'investigation:vetting', payload: { investigationId, ...payload }, timestamp: new Date().toISOString() });
  }

  private async run(investigationId: string, batch: InvestigationEvidenceDto[]): Promise<void> {
    const { store, publish } = this.deps;
    const run: ResearchRunDto = { id: `vet-${Date.now().toString(36)}`, investigationId, status: 'running', startedAt: new Date().toISOString() };
    let checked = 0;
    let flagged = 0;
    this.say(investigationId, { phase: 'started', message: `Screening ${batch.length} source${batch.length === 1 ? '' : 's'} for propaganda techniques…`, checked: 0, total: batch.length });
    try {
      await mapLimit(batch, CONCURRENCY, async (ev) => {
        const vetting = await this.vetOne(ev.sourceUrl!, ev.title, investigationId);
        const revision = await store.setEvidenceVetting(investigationId, ev.id, vetting);
        checked += 1;
        if (vetting.verdict === 'manipulative') flagged += 1;
        publish({ type: 'investigation:updated', payload: { investigationId, revision, run }, timestamp: new Date().toISOString() });
        this.say(investigationId, {
          phase: 'checked',
          evidenceId: ev.id,
          verdict: vetting.verdict,
          checked,
          total: batch.length,
          message: `${ev.sourceName ?? ev.title}: ${vetting.verdict}${vetting.error ? ' (page unreadable)' : ''}`,
        });
      });
      if (flagged && this.deps.rebuildClaims) {
        this.say(investigationId, { phase: 'checked', message: `${flagged} manipulative source${flagged === 1 ? '' : 's'} pruned; rebuilding claims…`, checked, total: batch.length });
        await this.deps.rebuildClaims(investigationId).catch((err) => logger.error({ err, investigationId }, 'claim rebuild after vetting failed'));
      }
      const latest = await store.get(investigationId);
      publish({ type: 'investigation:updated', payload: { investigationId, revision: latest?.revision ?? 0, run: { ...run, status: 'succeeded', completedAt: new Date().toISOString() } }, timestamp: new Date().toISOString() });
      this.say(investigationId, {
        phase: 'done',
        checked,
        total: batch.length,
        message: `Vetting done: ${checked} source${checked === 1 ? '' : 's'} screened, ${flagged} flagged as manipulative.`,
      });
    } catch (err) {
      logger.error({ err, investigationId }, 'source vetting failed');
      this.say(investigationId, { phase: 'error', checked, total: batch.length, message: `Vetting stopped: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
}
