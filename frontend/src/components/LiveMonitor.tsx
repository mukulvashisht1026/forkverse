import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ExternalLink, LoaderCircle, Radio, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { monitorRepository, newsFeedUrl, type LiveSource, type Monitor, type MonitorActivity } from '../services/investigations';
import type { CreateMonitorRequestDto, MonitorKindDto } from '../../../contracts/investigations';

const KIND_LABEL: Record<MonitorKindDto, string> = {
  news_feed: 'News feed for this topic',
  page: 'A specific page (e.g. a live blog)',
  sitemap: 'New pages on a site (sitemap)',
};

export function host(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function ago(iso?: string) {
  if (!iso) return 'never';
  return agoMinutes(Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000)));
}

function agoMinutes(mins: number) {
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
}

/** Link to a monitored website, always showing where it points. */
function SiteLink({ url, className }: { url: string; className?: string }) {
  return (
    <a className={className ?? 'tw-live-link'} href={url} target="_blank" rel="noopener noreferrer" title={url}>
      {host(url)}<span className="tw-live-path">{(() => { try { const u = new URL(url); return `${u.pathname}${u.search}`.slice(0, 60); } catch { return ''; } })()}</span>
      <ExternalLink size={11} aria-hidden="true" />
    </a>
  );
}

const LIVE_INSTRUCTIONS = (topic: string) => `New live updates or entries about ${topic}. Ignore ads, navigation, related links, comment counts and timestamps of unchanged entries.`;

/**
 * Live monitor control for one investigation: a "LIVE" toggle in the graph toolbar and a panel
 * to watch websites through Context.dev Monitors. "Find live sources" ranks pages that are
 * updating right now (live blogs etc.); every monitor shows the exact website it watches.
 * Detected changes grow the graph on their own (evidence, claims, highlight over /ws).
 */
export function LiveMonitor({ investigationId, topic, activity, disabled, onMonitorsChange }: {
  investigationId: string;
  topic: string;
  activity: MonitorActivity[];
  disabled?: boolean;
  onMonitorsChange?: (monitors: Monitor[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [kind, setKind] = useState<MonitorKindDto>('news_feed');
  const [url, setUrl] = useState('');
  const [instructions, setInstructions] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Monitor | null>(null);
  const [sources, setSources] = useState<LiveSource[] | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const list = await monitorRepository.list(investigationId);
      setMonitors(list);
      onMonitorsChange?.(list);
    } catch { /* panel shows the last known list */ }
  }, [investigationId, onMonitorsChange]);

  useEffect(() => { void load(); }, [load]);
  // Refresh "last checked" and the change counters whenever a monitor reports progress.
  useEffect(() => { if (activity.length) void load(); }, [activity.length, load]);
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 15_000);
    return () => window.clearInterval(t);
  }, [open]);

  /** The exact website the form would monitor (shown before creating). */
  const previewUrl = kind === 'news_feed' ? newsFeedUrl(topic) : /^https?:\/\/\S+$/i.test(url.trim()) ? url.trim() : '';

  const start = async (input: CreateMonitorRequestDto, key: string) => {
    setBusy(key);
    setError(null);
    setCreated(null);
    try {
      const monitor = await monitorRepository.create(investigationId, input);
      setCreated(monitor);
      setUrl('');
      setInstructions('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the monitor.');
    } finally {
      setBusy(null);
    }
  };

  const create = (event: FormEvent) => {
    event.preventDefault();
    void start({
      kind,
      ...(kind !== 'news_feed' ? { url: url.trim() } : {}),
      ...(kind === 'page' && instructions.trim() ? { instructions: instructions.trim() } : {}),
      intervalMinutes,
    }, 'create');
  };

  const findSources = async () => {
    setBusy('find');
    setError(null);
    try {
      setSources(await monitorRepository.suggest(investigationId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not search for live sources.');
    } finally {
      setBusy(null);
    }
  };

  const setFast = async (id: string, seconds: 0 | 5 | 10 | 30) => {
    setBusy(`fast:${id}`);
    setError(null);
    try {
      await monitorRepository.setFastCheck(investigationId, id, seconds);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the check speed.');
    } finally {
      setBusy(null);
    }
  };

  const act = async (id: string, what: 'check' | 'remove') => {
    setBusy(`${what}:${id}`);
    setError(null);
    try {
      if (what === 'check') await monitorRepository.checkNow(investigationId, id);
      else await monitorRepository.remove(investigationId, id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Monitor action failed.');
    } finally {
      setBusy(null);
    }
  };

  const live = monitors.some((m) => m.status === 'active');
  const recent = activity.slice(-6).reverse();
  const tracked = new Set(monitors.map((m) => m.url));
  const full = monitors.length >= 3;

  return (
    <span className="tw-live-wrap">
      <button type="button" className={live ? 'tw-live-toggle is-live' : 'tw-live-toggle'} onClick={() => setOpen((v) => !v)} disabled={disabled} aria-expanded={open} title="Watch websites and grow the graph automatically">
        {live ? <><i className="tw-live-dot" aria-hidden="true" />LIVE · {monitors.length}</> : <><Radio size={13} aria-hidden="true" /> Live monitor</>}
      </button>
      {open && <div className="tw-live-panel" role="dialog" aria-label="Live monitors">
        <div className="tw-live-head">
          <strong>Live monitors</strong>
          <button type="button" aria-label="Close live monitors" onClick={() => setOpen(false)}><X size={14} /></button>
        </div>
        <p className="tw-live-lede">Context.dev watches these websites. When one changes, new sources and claims are added to the graph automatically.</p>

        {monitors.length > 0 && <>
          <span className="tw-live-section">Tracking now</span>
          <ul className="tw-live-list">
            {monitors.map((m) => (
              <li key={m.id}>
                <div className="tw-live-row">
                  <span className={`tw-live-status s-${m.status}`} aria-label={m.status} />
                  <span className="tw-live-label">{m.label}</span>
                </div>
                <div className="tw-live-site"><SiteLink url={m.url} /></div>
                <div className="tw-live-meta">
                  {m.fastCheckSeconds ? `every ${m.fastCheckSeconds} s (fast)` : `every ${m.intervalMinutes} min`} · {m.webhook ? 'push' : 'polled'} · checked {ago(m.lastCheckedAt)} · {m.changesApplied} update{m.changesApplied === 1 ? '' : 's'}{m.lastChangeAt ? ` · last change ${ago(m.lastChangeAt)}` : ''}
                  {m.lastError && <span className="tw-live-error"> · {m.lastError}</span>}
                </div>
                <div className="tw-live-speed" role="group" aria-label={`Check speed for ${m.label}`}>
                  <span>Check every</span>
                  {([0, 30, 10, 5] as const).map((s) => {
                    const on = (m.fastCheckSeconds ?? 0) === s;
                    return (
                      <button key={s} type="button" className={on ? 'on' : ''} aria-pressed={on} disabled={busy !== null || m.status !== 'active'} onClick={() => void setFast(m.id, s)}
                        title={s ? `Check every ${s} seconds for 30 minutes (1 Context.dev credit per check)` : `Context.dev schedule: every ${m.intervalMinutes} min`}>
                        {busy === `fast:${m.id}` && on ? <LoaderCircle className="gh-spin" size={11} /> : null}{s ? `${s}s` : `${m.intervalMinutes}m`}
                      </button>
                    );
                  })}
                  {m.fastCheckSeconds && m.fastUntil ? <span className="tw-live-speed-note"><i className="tw-live-dot" aria-hidden="true" />fast until {new Date(m.fastUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> : null}
                </div>
                <div className="tw-live-actions">
                  <button type="button" onClick={() => void act(m.id, 'check')} disabled={busy !== null}>
                    {busy === `check:${m.id}` ? <LoaderCircle className="gh-spin" size={12} /> : <RefreshCw size={12} />} Check now
                  </button>
                  <button type="button" onClick={() => void act(m.id, 'remove')} disabled={busy !== null} aria-label={`Remove monitor ${m.label}`}>
                    <Trash2 size={12} /> Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>}

        {created && <p className="tw-live-created" role="status">Now monitoring <SiteLink url={created.url} /> every {created.intervalMinutes} min.</p>}

        {!full && <div className="tw-live-find">
          <button type="button" className="tw-live-find-btn" onClick={() => void findSources()} disabled={busy !== null}>
            {busy === 'find' ? <><LoaderCircle className="gh-spin" size={13} /> Reading the freshest pages…</> : <><Search size={13} /> Find live sources</>}
          </button>
          <span className="tw-live-hint">Ranks pages updating right now (live blogs, rolling coverage) by freshness and update frequency.</span>
          {sources && (sources.length ? <ol className="tw-live-sources">
            {sources.map((s, i) => (
              <li key={s.url} className={s.readable ? '' : 'is-unreadable'}>
                <div className="tw-live-row">
                  {i === 0 && s.readable && <span className="tw-live-best">Best</span>}
                  <a className="tw-live-source-title" href={s.url} target="_blank" rel="noopener noreferrer" title={s.url}>{s.title}</a>
                </div>
                <div className="tw-live-site"><SiteLink url={s.url} /></div>
                <div className="tw-live-meta">
                  {[s.publisher, s.minutesSinceUpdate !== undefined ? `updated ${agoMinutes(s.minutesSinceUpdate)}` : null, s.updateStamps ? `${s.updateStamps} timestamped updates` : null].filter(Boolean).join(' · ')}
                  {!s.readable && <span className="tw-live-error"> · could not be read{s.error ? ` (${s.error})` : ''}</span>}
                </div>
                <div className="tw-live-actions">
                  {tracked.has(s.url)
                    ? <span className="tw-live-tracked">Tracking</span>
                    : <button type="button" disabled={busy !== null || !s.readable} onClick={() => void start({ kind: 'page', url: s.url, instructions: LIVE_INSTRUCTIONS(topic), intervalMinutes: 10 }, `src:${s.url}`)}>
                      {busy === `src:${s.url}` ? <LoaderCircle className="gh-spin" size={12} /> : <Radio size={12} />} Monitor this page
                    </button>}
                </div>
              </li>
            ))}
          </ol> : <p className="tw-live-hint">No live pages found for this topic right now. Use the news feed instead.</p>)}
        </div>}

        {!full && <form className="tw-live-form" onSubmit={create}>
          <label>Watch
            <select value={kind} onChange={(e) => setKind(e.target.value as MonitorKindDto)}>
              {(Object.keys(KIND_LABEL) as MonitorKindDto[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </label>
          {kind !== 'news_feed' && <label>URL
            <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder={kind === 'sitemap' ? 'https://example.com/sitemap.xml' : 'https://example.com/live/...'} />
          </label>}
          {kind === 'page' && <label>What matters (optional)
            <input value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="New statements or announcements; ignore dates and navigation" maxLength={2000} />
          </label>}
          <label>Check every
            <select value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))}>
              {[10, 15, 30, 60, 360, 1440].map((n) => <option key={n} value={n}>{n < 60 ? `${n} min` : `${n / 60} h`}</option>)}
            </select>
          </label>
          <p className="tw-live-preview">Will monitor: {previewUrl ? <SiteLink url={previewUrl} /> : <em>enter a URL</em>}</p>
          <button type="submit" className="tw-live-start" disabled={busy !== null || !previewUrl}>
            {busy === 'create' ? <><LoaderCircle className="gh-spin" size={13} /> Starting…</> : <><Radio size={13} /> Start monitoring</>}
          </button>
        </form>}

        {error && <p className="tw-live-error" role="alert">{error}</p>}

        {recent.length > 0 && <div className="tw-live-feed" aria-live="polite">
          <span className="tw-live-section">Activity</span>
          <ul>{recent.map((a, i) => <li key={`${a.timestamp}-${i}`} className={`p-${a.phase}`}><time>{new Date(a.timestamp).toLocaleTimeString()}</time> {a.message}{a.url && <> · <SiteLink url={a.url} /></>}</li>)}</ul>
        </div>}
      </div>}
    </span>
  );
}
