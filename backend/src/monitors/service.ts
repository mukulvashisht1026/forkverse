/**
 * Live monitors: an investigation watches a source through the Context.dev Monitors API, and
 * every detected change grows the graph on its own.
 *
 *   create  -> Context.dev monitor (page / sitemap target, interval schedule, webhook if public)
 *   change  -> arrives by signed webhook (`change.detected`), by the poller (GET …/changes), or
 *              by "Check now" (POST …/run, then wait for the run). All three meet in `apply`,
 *              which is idempotent per change id.
 *   apply   -> new event "Live update · <title>" + evidence (monitors/ingest.ts), each step
 *              broadcast as `investigation:updated`; then the claim graph is rebuilt with the new
 *              evidence preferred, and claims that did not exist before are highlighted
 *              (`investigation:highlight`). Progress is narrated as `investigation:monitor`.
 *
 * Principles: evidence comes only from the change record (URLs, headlines, verbatim text);
 * failures are recorded on the monitor (`lastError`) and broadcast, never hidden.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MonitorChange, MonitorsClient, MonitorTarget } from '../clients/contextdev.js';
import { InvestigationError } from '../investigations/service.js';
import type { InvestigationStore } from '../investigations/store.js';
import type {
  CreateMonitorRequestDto,
  InvestigationHighlightEvent,
  InvestigationMonitorEvent,
  InvestigationRecord,
  InvestigationUpdatedEvent,
  LiveSourceDto,
  MonitorDto,
  MonitorPhaseDto,
  MonitorRecord,
  ResearchRunDto,
} from '../investigations/types.js';
import { logger } from '../utils/logger.js';
import { changeToEvidence, newsFeedUrl } from './ingest.js';

export const MAX_MONITORS_PER_INVESTIGATION = 3;
/** Fast-check gaps offered in the UI (seconds) and how long fast checking stays on. */
export const FAST_CHECK_SECONDS = [5, 10, 30] as const;
export const FAST_CHECK_MAX_MS = 30 * 60_000;
const DEFAULT_INTERVAL = 15;
const RUN_WAIT_MS = 3 * 60_000;
const RUN_POLL_MS = 4000;
const SIGNATURE_TOLERANCE_S = 300;
const SEEN_CAP = 200;

type Frame = InvestigationUpdatedEvent | InvestigationHighlightEvent | InvestigationMonitorEvent;

export interface MonitorServiceDeps {
  store: InvestigationStore;
  client: MonitorsClient;
  publish: (frame: Frame) => void;
  /** Rebuild the claim graph, preferring the given evidence ids. */
  rebuildClaims?: (investigationId: string, preferEvidenceIds: string[]) => Promise<void>;
  /** Finds pages updating right now about a topic (monitors/liveSources.ts). */
  liveSources?: (topic: string) => Promise<LiveSourceDto[]>;
  /** Public HTTPS URL of POST /webhook/monitor; undefined = no webhook (polling only). */
  webhookUrl?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export function toMonitorDto({ secret: _s, seenChangeIds: _c, ...dto }: MonitorRecord): MonitorDto {
  return dto;
}

/** Verify `X-Context-Signature: t=<unix>,v1=<hex>` = HMAC-SHA256(secret, `${t}.${rawBody}`). */
export function verifySignature(header: string | undefined, rawBody: Buffer | string, secret: string, nowS = Date.now() / 1000): boolean {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
  if (!t || !/^\d+$/.test(t) || !sigs.length) return false;
  if (Math.abs(nowS - Number(t)) > SIGNATURE_TOLERANCE_S) return false;
  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  return sigs.some((s) => {
    if (!/^[0-9a-f]+$/i.test(s)) return false;
    const got = Buffer.from(s, 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export class MonitorService {
  /** Per-investigation queue: changes are applied one at a time, in arrival order. */
  private queues = new Map<string, Promise<void>>();
  /** Change ids being applied right now (webhook and poller can race). */
  private inFlight = new Set<string>();
  private pollTimer?: NodeJS.Timeout;
  /** Fast-check loops by monitor id (one at a time per monitor). */
  private fast = new Map<string, NodeJS.Timeout>();
  private polling = false;
  private sleep: (ms: number) => Promise<void>;
  private now: () => Date;

  constructor(private deps: MonitorServiceDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = deps.now ?? (() => new Date());
  }

  private iso() {
    return this.now().toISOString();
  }

  private async record(investigationId: string): Promise<InvestigationRecord> {
    const r = await this.deps.store.get(investigationId);
    if (!r) throw new InvestigationError(404, 'investigation_not_found', `Investigation "${investigationId}" was not found.`);
    return r;
  }

  private async monitor(investigationId: string, monitorId: string): Promise<MonitorRecord> {
    const m = (await this.record(investigationId)).monitors?.find((x) => x.id === monitorId);
    if (!m) throw new InvestigationError(404, 'monitor_not_found', `Monitor "${monitorId}" was not found.`);
    return m;
  }

  private say(m: Pick<MonitorRecord, 'investigationId' | 'id'> & { url?: string }, phase: MonitorPhaseDto, message: string, extra: Partial<InvestigationMonitorEvent['payload']> = {}) {
    this.deps.publish({
      type: 'investigation:monitor',
      payload: { investigationId: m.investigationId, monitorId: m.id, phase, message, ...('url' in m && m.url ? { url: m.url } : {}), ...extra },
      timestamp: this.iso(),
    });
  }

  /** Pages updating right now about the investigation's topic, best first. */
  async suggest(investigationId: string): Promise<LiveSourceDto[]> {
    const record = await this.record(investigationId);
    if (!this.deps.liveSources) throw new InvestigationError(501, 'not_available', 'Live source search is not configured.');
    return this.deps.liveSources(record.topic);
  }

  async list(investigationId: string): Promise<MonitorDto[]> {
    return ((await this.record(investigationId)).monitors ?? []).map(toMonitorDto);
  }

  async create(investigationId: string, req: CreateMonitorRequestDto): Promise<MonitorDto> {
    const record = await this.record(investigationId);
    if ((record.monitors?.length ?? 0) >= MAX_MONITORS_PER_INVESTIGATION) {
      throw new InvestigationError(409, 'monitor_limit', `An investigation can have at most ${MAX_MONITORS_PER_INVESTIGATION} live monitors.`);
    }
    const interval = Math.round(req.intervalMinutes ?? DEFAULT_INTERVAL);
    if (!Number.isFinite(interval) || interval < 10 || interval > 1440) {
      throw new InvestigationError(400, 'invalid_interval', 'intervalMinutes must be between 10 and 1440.');
    }
    const url = req.kind === 'news_feed' && !req.url?.trim() ? newsFeedUrl(record.topic) : (req.url ?? '').trim();
    if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new InvestigationError(400, 'invalid_url', 'A valid http(s) URL is required.');
    const instructions = req.kind === 'page' ? req.instructions?.trim().slice(0, 2000) || undefined : undefined;
    const target: MonitorTarget = req.kind === 'sitemap' ? { type: 'sitemap', url } : { type: 'page', url, ...(instructions && { instructions }) };
    const label = req.kind === 'news_feed' ? `News feed · ${record.title}` : req.kind === 'sitemap' ? `New pages on ${hostOf(url)}` : `Page · ${hostOf(url)}`;

    let created;
    try {
      created = await this.deps.client.create({
        name: `${label}`.slice(0, 200),
        target,
        changeDetection: instructions ? 'semantic' : 'exact',
        intervalMinutes: interval,
        ...(this.deps.webhookUrl && { webhookUrl: this.deps.webhookUrl }),
        tags: ['tracewire', `inv-${investigationId}`.slice(0, 50)],
      });
    } catch (err) {
      logger.error({ err, investigationId }, 'context.dev monitor create failed');
      throw new InvestigationError(502, 'monitor_create_failed', `Context.dev could not create the monitor: ${err instanceof Error ? err.message : String(err)}`);
    }
    const now = this.iso();
    const monitor: MonitorRecord = {
      id: created.id,
      investigationId,
      kind: req.kind,
      url,
      label,
      ...(instructions && { instructions }),
      intervalMinutes: interval,
      status: 'active',
      webhook: Boolean(this.deps.webhookUrl),
      createdAt: now,
      // Changes before this moment belong to the baseline, not to the live feed.
      lastCheckedAt: now,
      changesApplied: 0,
      ...(created.secret && { secret: created.secret }),
      seenChangeIds: [],
    };
    await this.deps.store.saveMonitor(investigationId, monitor);
    this.say(monitor, 'checking', `Now monitoring ${hostOf(url)} every ${interval} min. Capturing the baseline…`);
    return toMonitorDto(monitor);
  }

  async remove(investigationId: string, monitorId: string): Promise<void> {
    const m = await this.monitor(investigationId, monitorId);
    this.stopFast(monitorId);
    await this.deps.client.remove(m.id).catch((err) => logger.warn({ err, monitorId }, 'context.dev monitor delete failed; removing locally'));
    await this.deps.store.removeMonitor(investigationId, monitorId);
  }

  /** Trigger a run now; the result is applied in the background (progress on /ws). */
  /**
   * Fast checking for live demos: Context.dev schedules no faster than every 10 minutes, so the
   * backend triggers a run itself every N seconds (the next only after the previous finished, so
   * runs never overlap). 1 Context.dev credit per run; switches itself off after FAST_CHECK_MAX_MS.
   */
  async setFastCheck(investigationId: string, monitorId: string, seconds: number): Promise<MonitorDto> {
    if (seconds !== 0 && !(FAST_CHECK_SECONDS as readonly number[]).includes(seconds)) {
      throw new InvestigationError(400, 'invalid_fast_check', `fastCheckSeconds must be 0 or one of ${FAST_CHECK_SECONDS.join(', ')}.`);
    }
    const m = await this.monitor(investigationId, monitorId);
    if (seconds && m.status !== 'active') throw new InvestigationError(409, 'monitor_inactive', 'The monitor is not active.');
    this.stopFast(monitorId);
    const until = seconds ? new Date(this.now().getTime() + FAST_CHECK_MAX_MS).toISOString() : undefined;
    const next = (await this.touch(investigationId, monitorId, { fastCheckSeconds: seconds || undefined, fastUntil: until })) ?? m;
    if (seconds) {
      this.say(m, 'checking', `Checking ${hostOf(m.url)} every ${seconds} s for the next ${FAST_CHECK_MAX_MS / 60_000} min.`);
      this.scheduleFast(next, 0);
    } else {
      this.say(m, 'no_change', `Fast checking of ${hostOf(m.url)} stopped; back to every ${m.intervalMinutes} min.`);
    }
    return toMonitorDto(next);
  }

  private stopFast(monitorId: string) {
    const t = this.fast.get(monitorId);
    if (t) clearTimeout(t);
    this.fast.delete(monitorId);
  }

  private scheduleFast(m: Pick<MonitorRecord, 'investigationId' | 'id'>, delayMs: number) {
    const t = setTimeout(() => void this.fastTick(m.investigationId, m.id), delayMs);
    t.unref();
    this.fast.set(m.id, t);
  }

  private async fastTick(investigationId: string, monitorId: string): Promise<void> {
    const m = (await this.deps.store.get(investigationId).catch(() => null))?.monitors?.find((x) => x.id === monitorId);
    if (!m || !m.fastCheckSeconds || m.status !== 'active') {
      this.fast.delete(monitorId);
      return;
    }
    if (!m.fastUntil || Date.parse(m.fastUntil) <= this.now().getTime()) {
      this.fast.delete(monitorId);
      await this.touch(investigationId, monitorId, { fastCheckSeconds: undefined, fastUntil: undefined }).catch(() => {});
      this.say(m, 'no_change', `Fast checking of ${hostOf(m.url)} ended after ${FAST_CHECK_MAX_MS / 60_000} min; back to every ${m.intervalMinutes} min.`);
      return;
    }
    try {
      const { runId } = await this.deps.client.runNow(m.id);
      await this.awaitRun(m, runId, { quiet: true });
      await this.touch(investigationId, monitorId, { lastCheckedAt: this.iso() });
    } catch (err) {
      logger.warn({ err, monitorId }, 'fast check failed');
    }
    if (this.fast.has(monitorId)) this.scheduleFast(m, m.fastCheckSeconds * 1000);
  }

  /** After a restart: resume fast checking that has not expired yet. */
  private async resumeFast(): Promise<void> {
    for (const m of await this.deps.store.listAllMonitors()) {
      if (m.fastCheckSeconds && m.fastUntil && Date.parse(m.fastUntil) > this.now().getTime() && !this.fast.has(m.id)) this.scheduleFast(m, 0);
    }
  }

  async checkNow(investigationId: string, monitorId: string): Promise<{ runId: string }> {
    const m = await this.monitor(investigationId, monitorId);
    let runId: string;
    try {
      ({ runId } = await this.deps.client.runNow(m.id));
    } catch (err) {
      throw new InvestigationError(502, 'monitor_run_failed', `Context.dev could not start a check: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.say(m, 'checking', `Checking ${hostOf(m.url)} now…`);
    void this.awaitRun(m, runId);
    return { runId };
  }

  /** quiet: fast-check loop (no "no change" / "already running" messages every few seconds). */
  private async awaitRun(m: MonitorRecord, runId: string, opts: { quiet?: boolean } = {}): Promise<void> {
    const deadline = this.now().getTime() + RUN_WAIT_MS;
    try {
      for (;;) {
        const run = await this.deps.client.getRun(m.id, runId);
        if (run.status === 'failed') throw new Error(run.error?.message || 'The check failed.');
        if (run.status === 'skipped') {
          if (run.skip_reason === 'superseded') {
            if (opts.quiet) return; // the loop simply tries again
            // Another run (e.g. the baseline) is in progress: its changes reach us via the poller.
            this.say(m, 'checking', `A check of ${hostOf(m.url)} is already running; any change will appear automatically.`);
            setTimeout(() => void this.pollOnce().catch(() => {}), 30_000).unref();
            return;
          }
          throw new Error(`Context.dev skipped the check (${run.skip_reason ?? 'unknown reason'}).`);
        }
        if (run.status === 'completed' || run.status === 'succeeded') {
          if (run.change_id) {
            await this.apply(m.investigationId, m.id, await this.deps.client.getChange(run.change_id));
          } else {
            await this.touch(m.investigationId, m.id, { lastError: undefined });
            if (!opts.quiet) this.say(m, 'no_change', `No change on ${hostOf(m.url)} since the last check.`);
          }
          return;
        }
        if (this.now().getTime() > deadline) throw new Error('The check is taking longer than expected; the poller will pick up any change.');
        await this.sleep(RUN_POLL_MS);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err, monitorId: m.id }, 'monitor check failed');
      await this.touch(m.investigationId, m.id, { lastError: message }).catch(() => {});
      if (!opts.quiet) this.say(m, 'error', message);
    }
  }

  /** Pull changes for every monitor (covers missed webhooks and local dev without a public URL). */
  async pollOnce(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const m of await this.deps.store.listAllMonitors()) {
        if (m.status !== 'active') continue;
        const since = m.lastCheckedAt;
        const checkedAt = this.iso();
        try {
          const changes = await this.deps.client.listChanges(m.id, since);
          for (const change of changes.sort((a, b) => (a.detected_at ?? '').localeCompare(b.detected_at ?? ''))) {
            await this.apply(m.investigationId, m.id, change);
          }
          await this.touch(m.investigationId, m.id, { lastCheckedAt: checkedAt });
        } catch (err) {
          logger.warn({ err, monitorId: m.id }, 'monitor poll failed');
        }
      }
    } finally {
      this.polling = false;
    }
  }

  startPolling(intervalMs: number): void {
    void this.resumeFast().catch((err) => logger.warn({ err }, 'could not resume fast checks'));
    if (intervalMs <= 0 || this.pollTimer) return;
    this.pollTimer = setInterval(() => void this.pollOnce().catch((err) => logger.error({ err }, 'monitor poller failed')), intervalMs);
    this.pollTimer.unref();
  }

  stopPolling(): void {
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    for (const id of [...this.fast.keys()]) this.stopFast(id);
  }

  /**
   * Context.dev webhook. Returns the HTTP status to answer with. Only `change.detected` with a
   * valid signature for a monitor we own is applied.
   */
  async handleWebhook(rawBody: Buffer, headers: { signature?: string; event?: string }): Promise<number> {
    let body: { event?: string; data?: { change?: MonitorChange; run?: { monitor_id?: string } } };
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return 400;
    }
    const monitorId = body.data?.change?.monitor_id ?? body.data?.run?.monitor_id;
    if (!monitorId) return 400;
    const m = (await this.deps.store.listAllMonitors()).find((x) => x.id === monitorId);
    if (!m) return 404;
    if (!m.secret || !verifySignature(headers.signature, rawBody, m.secret, this.now().getTime() / 1000)) {
      logger.warn({ monitorId }, 'monitor webhook rejected: bad signature');
      return 401;
    }
    if ((body.event ?? headers.event) === 'change.detected' && body.data?.change) {
      // Ack within Context.dev's 15 s window; apply in the background.
      void this.apply(m.investigationId, m.id, body.data.change).catch((err) => logger.error({ err, monitorId }, 'monitor webhook apply failed'));
    }
    return 204;
  }

  private async touch(investigationId: string, monitorId: string, patch: Partial<MonitorRecord>): Promise<MonitorRecord | null> {
    const current = (await this.deps.store.get(investigationId))?.monitors?.find((x) => x.id === monitorId);
    if (!current) return null; // removed meanwhile
    const next: MonitorRecord = { ...current, ...patch };
    for (const k of Object.keys(patch) as (keyof MonitorRecord)[]) if (patch[k] === undefined) delete next[k];
    await this.deps.store.saveMonitor(investigationId, next);
    return next;
  }

  /** Apply one change to the graph (queued per investigation; idempotent per change id). */
  apply(investigationId: string, monitorId: string, change: MonitorChange): Promise<void> {
    const prev = this.queues.get(investigationId) ?? Promise.resolve();
    const next = prev.then(() => this.applyNow(investigationId, monitorId, change)).catch((err) => logger.error({ err, monitorId, changeId: change.id }, 'monitor change apply failed'));
    this.queues.set(investigationId, next);
    void next.finally(() => {
      if (this.queues.get(investigationId) === next) this.queues.delete(investigationId);
    });
    return next;
  }

  private async applyNow(investigationId: string, monitorId: string, change: MonitorChange): Promise<void> {
    const record = await this.deps.store.get(investigationId);
    const m = record?.monitors?.find((x) => x.id === monitorId);
    if (!record || !m || m.seenChangeIds.includes(change.id) || this.inFlight.has(change.id)) return;
    this.inFlight.add(change.id);
    try {
      await this.ingest(record, m, change);
    } finally {
      this.inFlight.delete(change.id);
    }
  }

  private async ingest(record: InvestigationRecord, m: MonitorRecord, change: MonitorChange): Promise<void> {
    const { store, publish } = this.deps;
    const id = record.id;
    const changeTitle = (change.title || `${hostOf(m.url)} changed`).slice(0, 200);
    this.say(m, 'change_detected', `Change detected on ${hostOf(m.url)}${m.kind === 'page' ? `: ${changeTitle}` : ''}. Reading it…`, { title: changeTitle });

    const eventId = `evt-mon-${change.id}`;
    const existing = new Set(record.events.flatMap((e) => e.evidence.map((ev) => ev.id)));
    const evidence = changeToEvidence(m.kind, m.url, change, eventId, existing);
    // Feeds/sitemaps: name the update after its first new headline, not "<url> changed".
    const title = m.kind === 'page' || !evidence.length
      ? changeTitle
      : `${evidence[0]!.title}${evidence.length > 1 ? ` (+${evidence.length - 1} more)` : ''}`.slice(0, 200);
    const seenChangeIds = [...m.seenChangeIds, change.id].slice(-SEEN_CAP);
    if (!evidence.length) {
      await this.touch(id, m.id, { seenChangeIds, lastError: undefined });
      this.say(m, 'no_change', `${hostOf(m.url)} changed, but nothing new for the graph (no new articles).`, { title });
      return;
    }

    // Monitor activity shows as a short "run" so clients refresh exactly like during research.
    let run: ResearchRunDto = { id: `mon-${change.id}`, investigationId: id, status: 'running', startedAt: this.iso() };
    const frame = (revision: number, ev?: (typeof evidence)[number]) =>
      publish({ type: 'investigation:updated', payload: { investigationId: id, revision, run, ...(ev && { evidence: ev }) }, timestamp: this.iso() });

    let revision = await store.addEvent(id, {
      id: eventId,
      title: `Live update · ${title}`.slice(0, 120),
      occurredAt: change.detected_at ?? this.iso(),
      ...(change.summary && { summary: change.summary.slice(0, 1000) }),
      evidence: [],
    });
    frame(revision);
    for (const ev of evidence) {
      revision = await store.addEvidence(id, eventId, ev);
      frame(revision, ev);
    }
    await this.touch(id, m.id, { seenChangeIds, lastChangeAt: this.iso(), changesApplied: m.changesApplied + 1, lastError: undefined });
    const from = [...new Set(evidence.map((e) => e.sourceName).filter(Boolean))].slice(0, 3).join(', ') || hostOf(m.url);
    this.say(m, 'evidence_added', `New: “${title}” (${from}). Updating claims…`, { title, added: evidence.length });

    let newClaimIds: string[] = [];
    if (this.deps.rebuildClaims && !(await store.activeRun(id))) {
      const before = new Set((record.claims ?? []).map((c) => c.id));
      try {
        await this.deps.rebuildClaims(id, evidence.map((e) => e.id));
        const after = await store.get(id);
        revision = after?.revision ?? revision;
        newClaimIds = (after?.claims ?? []).filter((c) => !before.has(c.id)).map((c) => c.id);
      } catch (err) {
        logger.error({ err, investigationId: id }, 'claim rebuild after monitor change failed');
        this.say(m, 'error', `New sources were added, but the claims could not be rebuilt: ${err instanceof Error ? err.message : String(err)}`, { title, added: evidence.length });
      }
    }
    run = { ...run, status: 'succeeded', completedAt: this.iso() };
    frame(revision);

    // Light up what is new: new claims (or the new event when no claim changed) + new sources.
    publish({
      type: 'investigation:highlight',
      payload: {
        investigationId: id,
        messageId: `monitor-${change.id}`,
        evidenceIds: evidence.map((e) => e.id),
        eventIds: newClaimIds.length ? newClaimIds : [eventId],
        final: true,
      },
      timestamp: this.iso(),
    });
    this.say(
      m,
      'claims_updated',
      newClaimIds.length
        ? `Graph updated live: ${newClaimIds.length} new claim${newClaimIds.length === 1 ? '' : 's'} from ${evidence.length} new source${evidence.length === 1 ? '' : 's'}.`
        : `Graph updated live with ${evidence.length} new source${evidence.length === 1 ? '' : 's'}.`,
      { title, added: evidence.length, newClaimIds },
    );
  }
}
