import { Check, LoaderCircle } from 'lucide-react';

export type BuildPhase = 'loading' | 'research' | 'screening' | 'claims';

const STEPS: { id: Exclude<BuildPhase, 'loading'>; label: string }[] = [
  { id: 'research', label: 'Finding sources' },
  { id: 'screening', label: 'Screening sources for propaganda' },
  { id: 'claims', label: 'Building claims & timeline' },
];

/**
 * Shown while an investigation's first graph is being built: a centred card while the canvas is
 * empty, a compact pill once articles start to appear (so the growing graph stays visible).
 */
export function GraphBuildLoader({ phase, articles, screened, compact }: {
  phase: BuildPhase;
  articles: number;
  screened?: { checked: number; total: number };
  compact: boolean;
}) {
  if (phase === 'loading') {
    return <div className="tw-build is-card" role="status"><LoaderCircle className="gh-spin" size={18} aria-hidden="true" /><strong>Loading investigation…</strong></div>;
  }
  const current = STEPS.findIndex((s) => s.id === phase);
  const detail = phase === 'research'
    ? `${articles} article${articles === 1 ? '' : 's'} found so far`
    : phase === 'screening' && screened?.total
      ? `${screened.checked} of ${screened.total} sources screened`
      : phase === 'claims'
        ? 'Extracting claims, checking quotes, finding independent confirmation…'
        : '';

  if (compact) {
    return (
      <div className="tw-build is-pill" role="status" aria-live="polite">
        <LoaderCircle className="gh-spin" size={13} aria-hidden="true" />
        <span><b>{STEPS[current]?.label}</b>{detail && ` · ${detail}`}</span>
        <span className="tw-build-dots" aria-hidden="true">{STEPS.map((s, i) => <i key={s.id} className={i < current ? 'done' : i === current ? 'on' : ''} />)}</span>
      </div>
    );
  }

  return (
    <div className="tw-build is-card" role="status" aria-live="polite">
      <div className="tw-build-orbit" aria-hidden="true"><span /><span /><span /></div>
      <strong>Building your investigation graph</strong>
      <ol>
        {STEPS.map((s, i) => (
          <li key={s.id} className={i < current ? 'done' : i === current ? 'on' : ''}>
            <span className="tw-build-icon">{i < current ? <Check size={12} /> : i === current ? <LoaderCircle className="gh-spin" size={12} /> : i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>
      {detail && <p>{detail}</p>}
      <p className="tw-build-note">Usually 1–2 minutes. Sources appear on the graph as they are found.</p>
    </div>
  );
}
