import { ExternalLink } from 'lucide-react';
import type { BranchNode, ClaimSourceRef, SpineNode } from '../types/tree';

function host(url?: string): string | undefined {
  if (!url) return undefined;
  try { return new URL(url).hostname.replace(/^www\./i, ''); } catch { return undefined; }
}

function day(value?: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function outletCount(sources: readonly ClaimSourceRef[]): number {
  return new Set(sources.map((s) => s.publisher ?? host(s.url) ?? s.title)).size;
}

function SourceLink({ source, quote }: { source: ClaimSourceRef; quote?: boolean }) {
  const meta = [source.publisher ?? host(source.url), day(source.publishedAt)].filter(Boolean).join(' · ');
  const body = <>
    <strong>{source.title}</strong>
    {meta && <span className="tl-card-meta">{meta}</span>}
    {quote && source.quote && <q className="tl-card-quote">{source.quote}</q>}
  </>;
  return source.url
    ? <a className="tl-card-source" href={source.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={11} aria-hidden="true" />{body}</a>
    : <div className="tl-card-source">{body}</div>;
}

/** Spine card in the timeline view: the period's claims (branches) and every source behind them. */
export function PeriodCard({ node, onOpenClaim }: { node: SpineNode; onOpenClaim: (branchIndex: number) => void }) {
  const p = node.period;
  if (!p) return null;
  return (
    <div className="tl-card">
      <p className="tl-card-stats">{p.established} established · {p.unverified} unverified · {p.sources.length} source{p.sources.length === 1 ? '' : 's'}</p>
      <section aria-label="Claims in this period">
        <h4>Claims</h4>
        <ul>{node.branches.map((b, j) => (
          <li key={b.id}><button type="button" className={`tl-card-claim ${b.claimStatus === 'pending' ? 'is-pending' : ''}`} onClick={() => onOpenClaim(j)}>
            <span className="tl-card-count" title="Independent sources stating this claim">{outletCount(b.claimSources ?? [])}</span>
            <span><strong>{b.name}</strong><span className="tl-card-meta">{b.relation}</span></span>
          </button></li>
        ))}</ul>
      </section>
      {p.sources.length > 0 && <details className="tl-card-sources">
        <summary>All sources ({p.sources.length})</summary>
        <ul>{p.sources.map((s, i) => <li key={s.url ?? `${s.title}-${i}`}><SourceLink source={s} /></li>)}</ul>
      </details>}
    </div>
  );
}

/** Branch card in the timeline view: one claim and the merged articles that state it. */
export function ClaimSourcesCard({ claim, periodLabel, dateLabel, onBack }: { claim: BranchNode; periodLabel: string; dateLabel: string | null; onBack: () => void }) {
  const sources = claim.claimSources ?? [];
  const n = outletCount(sources);
  return (
    <div className="tl-card">
      <p className={`tl-card-strength ${claim.claimStatus === 'pending' ? 'is-pending' : n > 2 ? 'is-strong' : ''}`}>
        {n} independent source{n === 1 ? '' : 's'} {n > 1 ? 'state this' : 'so far'}{dateLabel ? ` · ${dateLabel}` : ''}
      </p>
      <section aria-label="Sources for this claim">
        <ul>{sources.map((s, i) => <li key={s.url ?? `${s.title}-${i}`}><SourceLink source={s} quote /></li>)}</ul>
      </section>
      <button type="button" className="node-card-back" onClick={onBack}>← {periodLabel || 'Period'}</button>
    </div>
  );
}
