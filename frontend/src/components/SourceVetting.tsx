import { useMemo } from 'react';
import { LoaderCircle, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import type { BranchNode } from '../types/tree';
import type { SourceVetting, VettingActivity } from '../services/investigations';

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
        {vetting.propagandaScore !== undefined && <span className={`tw-vet-score${vetting.propagandaScore > 60 ? ' is-flagged' : ''}`}>{vetting.propagandaScore > 60 ? '⚑ ' : ''}Propaganda score {vetting.propagandaScore}%</span>}
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
 * Toolbar badge (read-only): screening runs automatically for every source the graph uses, so
 * this only reports the state: sources screened, red-flagged ones, and live progress.
 */
export function SourceVettingBadge({ sources, activity }: { sources: BranchNode[]; activity: VettingActivity[] }) {
  const counts = useMemo(() => {
    const seen = new Set<string>();
    const c = { flagged: 0, manipulative: 0, uncertain: 0, credible: 0, screened: 0, total: 0 };
    for (const b of sources) {
      if (seen.has(b.id) || !b.sourceUrl) continue;
      seen.add(b.id);
      c.total += 1;
      const v = b.vetting;
      if (!v) continue;
      c[v.verdict] += 1;
      if (v.depth === 'content') c.screened += 1;
      if (v.propagandaScore !== undefined ? v.propagandaScore > 60 : v.verdict === 'manipulative') c.flagged += 1;
    }
    return c;
  }, [sources]);
  const last = activity.at(-1);
  const running = Boolean(last && (last.phase === 'started' || last.phase === 'checked'));
  if (!counts.total && !running) return null;
  const title = [
    'Propaganda screening (automatic for every source used in the graph)',
    `${counts.screened} of ${counts.total} sources screened in depth`,
    `${counts.manipulative} manipulative · ${counts.uncertain} uncertain · ${counts.credible} credible`,
    counts.flagged ? `${counts.flagged} red-flagged (score above 60%): hover the red flags in the graph` : 'No red flags',
    ...(running && last ? [`Now: ${last.message}`] : []),
  ].join('\n');
  return (
    <span className={`tw-vet-badge${counts.flagged ? ' is-flagged' : ''}`} title={title} role="status" aria-label={title}>
      {running ? <LoaderCircle className="gh-spin" size={12} aria-hidden="true" /> : counts.flagged ? <ShieldAlert size={12} aria-hidden="true" /> : <ShieldCheck size={12} aria-hidden="true" />}
      {running && last?.total ? `Screening ${last.checked ?? 0}/${last.total}` : `${counts.screened} screened`}
      {counts.flagged > 0 && <b>⚑ {counts.flagged} flagged</b>}
    </span>
  );
}
