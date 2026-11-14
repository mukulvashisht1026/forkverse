import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { LoaderCircle, ShieldAlert, ShieldCheck, ShieldQuestion, X } from 'lucide-react';
import type { BranchNode } from '../types/tree';
import { vettingRepository, type SourceVetting, type VettingActivity } from '../services/investigations';

const TECHNIQUE: Record<string, string> = {
  loaded_language: 'Loaded language', fear_or_prejudice: 'Fear / prejudice', name_calling: 'Name calling',
  false_dilemma: 'False dilemma', causal_oversimplification: 'Causal oversimplification', whataboutism: 'Whataboutism',
  straw_man: 'Straw man', repetition: 'Repetition', exaggeration_or_minimisation: 'Exaggeration / minimisation',
  appeal_to_popularity: 'Appeal to popularity', appeal_to_authority: 'Appeal to authority', flag_waving: 'Flag waving',
  slogans: 'Slogans', doubt: 'Casting doubt', dehumanization: 'Dehumanisation', smears: 'Smears', other: 'Other',
};

const VERDICT_LABEL = { credible: 'Credible', uncertain: 'Uncertain', manipulative: 'Manipulative' } as const;

function VerdictIcon({ verdict, size = 14 }: { verdict: SourceVetting['verdict']; size?: number }) {
  if (verdict === 'manipulative') return <ShieldAlert size={size} aria-hidden="true" />;
  if (verdict === 'credible') return <ShieldCheck size={size} aria-hidden="true" />;
  return <ShieldQuestion size={size} aria-hidden="true" />;
}

/** One source's screening result: verdict, attributed reasons, verified technique quotes. */
export function VettingCard({ vetting, onScreen, screening }: { vetting?: SourceVetting; onScreen?: () => void; screening?: boolean }) {
  if (!vetting) {
    return (
      <div className="tw-vet-card is-none">
        <div className="tw-vet-head"><ShieldQuestion size={14} aria-hidden="true" /><strong>Not screened</strong></div>
        <p className="tw-vet-note">This source's domain is not on any list used here and its text has not been screened yet.</p>
        {onScreen && <button type="button" className="tw-vet-btn" onClick={onScreen} disabled={screening}>{screening ? <><LoaderCircle className="gh-spin" size={12} /> Screening…</> : 'Screen this source'}</button>}
      </div>
    );
  }
  const r = vetting.rhetoric;
  return (
    <div className={`tw-vet-card v-${vetting.verdict}`}>
      <div className="tw-vet-head">
        <VerdictIcon verdict={vetting.verdict} />
        <strong>{VERDICT_LABEL[vetting.verdict]}</strong>
        <span className="tw-vet-meta">{vetting.depth === 'content' ? 'domain + text' : 'domain lists only'} · coverage {Math.round(vetting.coverage * 100)}%</span>
      </div>
      <ul className="tw-vet-reasons">{vetting.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
      {r && r.techniques.length > 0 && <div className="tw-vet-techniques">
        <span className="tw-vet-sub">Verified passages{r.verdict !== 'likely_propaganda' ? ' (not enough for a finding)' : ''}</span>
        <ul>{r.techniques.slice(0, 6).map((t, i) => (
          <li key={i}><span className={`tw-vet-tech voice-${t.voice}`}>{TECHNIQUE[t.technique] ?? t.technique}{t.voice !== 'author' ? ' · quoted' : ''}</span> “{t.quote}”{t.explanation && <em> {t.explanation}</em>}</li>
        ))}</ul>
      </div>}
      {r && r.counterevidence.length > 0 && <p className="tw-vet-note">Against a propaganda reading: {r.counterevidence.slice(0, 3).join('; ')}</p>}
      {r && r.warnings.length > 0 && <p className="tw-vet-note">{r.warnings.join(' ')}</p>}
      {vetting.verdict === 'manipulative' && <p className="tw-vet-note">Pruned: this source is shown faded and is never used to establish a claim.</p>}
      <p className="tw-vet-disclaimer">A screening aid, not proof of intent, coordination or falsity.</p>
      {onScreen && vetting.depth !== 'content' && <button type="button" className="tw-vet-btn" onClick={onScreen} disabled={screening}>{screening ? <><LoaderCircle className="gh-spin" size={12} /> Screening…</> : 'Screen the page text too'}</button>}
    </div>
  );
}

/**
 * Toolbar panel: screen the investigation's sources for propaganda (domain lists + verified
 * rhetoric analysis), and check any website on demand.
 */
export function SourceVettingPanel({ investigationId, sources, activity, disabled }: {
  investigationId: string;
  /** All evidence branches of the investigation (research-runs view). */
  sources: BranchNode[];
  activity: VettingActivity[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<SourceVetting | null>(null);

  const counts = useMemo(() => {
    const seen = new Set<string>();
    const c = { manipulative: 0, uncertain: 0, credible: 0, unchecked: 0, content: 0, total: 0 };
    for (const b of sources) {
      if (seen.has(b.id) || !b.sourceUrl) continue;
      seen.add(b.id);
      c.total += 1;
      if (!b.vetting) c.unchecked += 1;
      else {
        c[b.vetting.verdict] += 1;
        if (b.vetting.depth === 'content') c.content += 1;
      }
    }
    return c;
  }, [sources]);

  const last = activity.at(-1);
  const running = last && (last.phase === 'started' || last.phase === 'checked');
  const flagged = counts.manipulative;

  const screenAll = async () => {
    setBusy('all');
    setError(null);
    try {
      const r = await vettingRepository.start(investigationId);
      if (!r.queued) setError('Every source has already been screened.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start screening.');
    } finally {
      setBusy(null);
    }
  };

  const checkUrl = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('url');
    setError(null);
    setResult(null);
    try {
      setResult(await vettingRepository.vetUrl(url.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check this website.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <span className="tw-live-wrap">
      <button type="button" className={`tw-vet-toggle${flagged ? ' is-flagged' : ''}`} onClick={() => setOpen((v) => !v)} disabled={disabled} aria-expanded={open} title="Screen sources for propaganda and manipulation">
        {running ? <LoaderCircle className="gh-spin" size={13} /> : flagged ? <ShieldAlert size={13} aria-hidden="true" /> : <ShieldCheck size={13} aria-hidden="true" />}
        {flagged ? ` ${flagged} flagged` : ' Propaganda check'}
      </button>
      {open && <div className="tw-live-panel tw-vet-panel" role="dialog" aria-label="Propaganda check">
        <div className="tw-live-head">
          <strong>Propaganda check</strong>
          <button type="button" aria-label="Close propaganda check" onClick={() => setOpen(false)}><X size={14} /></button>
        </div>
        <p className="tw-live-lede">Every website used to build the graph is screened automatically: its domain is checked against public lists of influence operations and state media, and its text is screened for propaganda techniques with verified quotes. Manipulative sources are pruned from claims.</p>

        <span className="tw-live-section">This investigation</span>
        <div className="tw-vet-counts">
          <span className="v-manipulative"><ShieldAlert size={12} /> {counts.manipulative} manipulative</span>
          <span className="v-uncertain"><ShieldQuestion size={12} /> {counts.uncertain} uncertain</span>
          <span className="v-credible"><ShieldCheck size={12} /> {counts.credible} credible</span>
          <span>{counts.unchecked} unlisted</span>
        </div>
        <p className="tw-live-hint">{counts.content} of {counts.total} sources screened in depth (page text). Domain lists apply automatically.</p>
        {running && last?.total ? <div className="tw-vet-progress" aria-label="Screening progress"><i style={{ width: `${Math.round(((last.checked ?? 0) / last.total) * 100)}%` }} /></div> : null}
        <button type="button" className="tw-live-find-btn tw-vet-run" onClick={() => void screenAll()} disabled={busy !== null || Boolean(running) || counts.total === 0}>
          {busy === 'all' || running ? <><LoaderCircle className="gh-spin" size={13} /> Screening sources…</> : <><ShieldCheck size={13} /> Screen remaining sources (up to 12)</>}
        </button>

        <form className="tw-live-form" onSubmit={(e) => void checkUrl(e)}>
          <label>Check any website
            <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/article" />
          </label>
          <button type="submit" className="tw-live-start" disabled={busy !== null || !/^https?:\/\/\S+$/i.test(url.trim())}>
            {busy === 'url' ? <><LoaderCircle className="gh-spin" size={13} /> Reading and screening…</> : 'Check website'}
          </button>
        </form>
        {result && <VettingCard vetting={result} />}

        {error && <p className="tw-live-error" role="alert">{error}</p>}
        {activity.length > 0 && <div className="tw-live-feed" aria-live="polite">
          <span className="tw-live-section">Activity</span>
          <ul>{activity.slice(-6).reverse().map((a, i) => <li key={`${a.timestamp}-${i}`} className={a.verdict ? `v-${a.verdict}` : `p-${a.phase}`}><time>{new Date(a.timestamp).toLocaleTimeString()}</time> {a.message}</li>)}</ul>
        </div>}
      </div>}
    </span>
  );
}
