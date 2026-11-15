import { isManipulativeVetting } from '../utils/vetting';
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

/** Red flag above this propaganda score (PROPAGANDA_FLAG_THRESHOLD in contracts/investigations.ts). */
const FLAG_AT = 74;

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
        {vetting.propagandaScore !== undefined && <span className={`tw-vet-score${vetting.propagandaScore > FLAG_AT ? ' is-flagged' : ''}`}>{vetting.propagandaScore > FLAG_AT ? '⚑ ' : ''}Propaganda score {vetting.propagandaScore}%</span>}
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
      {isManipulativeVetting(vetting) && <p className="tw-vet-note">Pruned: this source is shown faded and is never used to establish a claim.</p>}
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
  const { counts, flagged } = useMemo(() => {
    const seen = new Set<string>();
    const c = { flagged: 0, manipulative: 0, uncertain: 0, credible: 0, screened: 0, total: 0 };
    const list: { id: string; url: string; host: string; title: string; score?: number; verdict: SourceVetting['verdict']; why: string; techniques: string[] }[] = [];
    for (const b of sources) {
      if (seen.has(b.id) || !b.sourceUrl) continue;
      seen.add(b.id);
      c.total += 1;
      const v = b.vetting;
      if (!v) continue;
      c[isManipulativeVetting(v) ? 'manipulative' : v.verdict === 'manipulative' ? 'uncertain' : v.verdict] += 1;
      if (v.depth === 'content') c.screened += 1;
      const isFlagged = v.propagandaScore !== undefined ? v.propagandaScore > FLAG_AT : isManipulativeVetting(v);
      if (!isFlagged) continue;
      c.flagged += 1;
      const r = v.rhetoric;
      list.push({
        id: b.id,
        url: b.sourceUrl,
        host: hostOf(b.sourceUrl),
        title: b.name,
        ...(v.propagandaScore !== undefined && { score: v.propagandaScore }),
        verdict: v.verdict,
        why: (r?.verdict === 'likely_propaganda' && r.rationale) || v.reasons[0] || 'Screened as manipulative.',
        techniques: [...new Set((r?.techniques ?? []).filter((t) => t.voice === 'author').map((t) => TECHNIQUE[t.technique] ?? t.technique))].slice(0, 4),
      });
    }
    list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return { counts: c, flagged: list };
  }, [sources]);
  const last = activity.at(-1);
  const running = Boolean(last && (last.phase === 'started' || last.phase === 'checked'));
  if (!counts.total && !running) return null;
  const summary = `${counts.screened} of ${counts.total} sources screened in depth · ${counts.manipulative} manipulative · ${counts.uncertain} uncertain · ${counts.credible} credible`;
  return (
    <span className={`tw-vet-badge${counts.flagged ? ' is-flagged' : ''}`} tabIndex={0} role="status" aria-label={`Propaganda screening: ${summary}; ${counts.flagged} red-flagged`}>
      {running ? <LoaderCircle className="gh-spin" size={12} aria-hidden="true" /> : counts.flagged ? <ShieldAlert size={12} aria-hidden="true" /> : <ShieldCheck size={12} aria-hidden="true" />}
      {running && last?.total ? `Screening ${last.checked ?? 0}/${last.total}` : `${counts.screened} screened`}
      {counts.flagged > 0 && <b>⚑ {counts.flagged} flagged</b>}
      <span className="tw-vet-pop" role="tooltip">
        <strong className="tw-vet-pop-title">Propaganda screening</strong>
        <span className="tw-vet-pop-sub">Automatic for every source used in the graph. {summary}.</span>
        {running && last && <span className="tw-vet-pop-now"><LoaderCircle className="gh-spin" size={11} aria-hidden="true" /> {last.message}</span>}
        {flagged.length ? <>
          <span className="tw-vet-pop-head">⚑ Red-flagged websites ({flagged.length})</span>
          <ul>{flagged.slice(0, 8).map((f) => (
            <li key={f.id}>
              <span className="tw-vet-pop-row">
                <a href={f.url} target="_blank" rel="noopener noreferrer" title={f.title}>{f.host}</a>
                <span className="tw-vet-pop-score">{f.score !== undefined ? `${f.score}%` : VERDICT_LABEL[f.verdict]}</span>
              </span>
              <span className="tw-vet-pop-why">{clip(f.why, 180)}</span>
              {f.techniques.length > 0 && <span className="tw-vet-pop-tech">{f.techniques.join(' · ')}</span>}
            </li>
          ))}</ul>
          {flagged.length > 8 && <span className="tw-vet-pop-more">+{flagged.length - 8} more: hover the red flags in the graph</span>}
          <span className="tw-vet-pop-note">Flagged sources are shown faded and never count towards a claim. A screening aid, not proof of intent or falsity.</span>
        </> : <span className="tw-vet-pop-ok">No red-flagged websites so far.</span>}
      </span>
    </span>
  );
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./i, ''); } catch { return url; }
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
