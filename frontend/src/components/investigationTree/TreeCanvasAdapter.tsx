import { useMemo } from 'react';
import type { BranchNode, FocusTarget as AppFocus, SpineNode as AppSpine } from '../../types/tree';

const FLAG_THRESHOLD = 60; // PROPAGANDA_FLAG_THRESHOLD in contracts/investigations.ts
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const TECH: Record<string, string> = {
  loaded_language: 'Loaded language', fear_or_prejudice: 'Fear / prejudice', name_calling: 'Name calling', false_dilemma: 'False dilemma',
  causal_oversimplification: 'Oversimplification', whataboutism: 'Whataboutism', straw_man: 'Straw man', repetition: 'Repetition',
  exaggeration_or_minimisation: 'Exaggeration', appeal_to_popularity: 'Bandwagon', appeal_to_authority: 'Appeal to authority',
  flag_waving: 'Flag waving', slogans: 'Slogans', doubt: 'Casting doubt', dehumanization: 'Dehumanisation', smears: 'Smears', other: 'Other',
};

/** Red flag for a source whose propaganda score is above the threshold (older results: manipulative verdict). */
export function propagandaFlag(v: BranchNode['vetting']): { score?: number; lines: string[] } | undefined {
  if (!v) return undefined;
  const score = v.propagandaScore;
  if (!(score !== undefined ? score > FLAG_THRESHOLD : v.verdict === 'manipulative')) return undefined;
  const lines = [`⚑ Propaganda score ${score !== undefined ? `${score}%` : 'high'}`];
  for (const t of (v.rhetoric?.techniques ?? []).filter((x) => x.voice === 'author').slice(0, 2)) lines.push(`${TECH[t.technique] ?? t.technique}: “${clip(t.quote, 46)}”`);
  if (v.rating?.kind === 'influence_operation') lines.push(clip(`Listed influence operation${v.rating.actorCountry ? ` (${v.rating.actorCountry})` : ''}`, 60));
  else if (v.rating?.kind === 'state_media') lines.push('State-affiliated media');
  lines.push('Pruned: not used to support claims');
  return { ...(score !== undefined && { score }), lines };
}

/** Tip tag for a vetted source: only shown when there is something to warn about. */
export function vetTag(v: BranchNode['vetting']): string | undefined {
  if (!v) return undefined;
  if (v.verdict === 'manipulative') return 'MANIPULATIVE';
  switch (v.rating?.kind) {
    case 'state_media': return 'STATE MEDIA';
    case 'unreliable': return 'LOW CREDIBILITY';
    case 'satire': return 'SATIRE';
    default: return undefined;
  }
}
import type { ViewTransform } from './types/tree';
import { TreeCanvas } from './components/TreeCanvas';
import type { TreeLink } from './types/tree';

interface Props {
  spine: AppSpine[];
  selectedIndex: number;
  focus: AppFocus | null;
  moving: boolean;
  detailLevel: 'detailed' | 'minimal';
  researching: boolean;
  fitSignal: number;
  onHoverTarget: (target: AppFocus | null) => void;
  onSelectTarget: (target: AppFocus) => void;
  onClearPin: () => void;
  onContinue: () => void;
  isContinuing: boolean;
  /** Claim view: neutral links between claims (evolution / follow-up / potential inconsistency). */
  links?: TreeLink[];
  /** Claim view: note at the end of the unverified lane. */
  laneNote?: string;
  /** Evidence/event ids to highlight (cited by the current answer); null = no highlight. */
  highlight?: { evidenceIds: ReadonlySet<string>; eventIds: ReadonlySet<string>; roles?: ReadonlyMap<string, string> } | null;
  /** Items added by live tracking (node, claim and evidence ids). */
  liveMarks?: ReadonlyMap<string, 'fresh' | 'recent'>;
  onViewChange?: (view: ViewTransform) => void;
  onCanvasReady?: (svg: SVGSVGElement | null) => void;
  onGrowthComplete: (eventId: string, evidenceId?: string) => void;
}

/** Canvas labels only: long article titles are truncated (the detail panel keeps the full title). */
export function shortLabel(name: string, max = 44): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function mapTreeModels(spine: AppSpine[], liveMarks?: ReadonlyMap<string, 'fresh' | 'recent'>) {
  return spine.map((node) => ({
    id: node.id, name: shortLabel(node.name, 140), info: node.info,
    isNew: Boolean(node._animateGrowth),
    // News view: pending claims go to the separate unverified lane. Politician view: the main line IS
    // the claim tracker, so single-source claims stay on it with an UNVERIFIED badge instead.
    ...(node.claimStatus === 'pending' && (node.outcome ? { unverified: true } : { pending: true })),
    ...(node.disputed && { disputed: true }), ...(node.outcome && { outcome: node.outcome }),
    // A node counts as live-updated when it, or any of its sources, was just added by a monitor.
    ...((() => { const own = liveMarks?.get(node.id); const kids = node.branches.flatMap((b) => [liveMarks?.get(b.id), ...(b.groupedSources?.map((source) => liveMarks?.get(source.id)) ?? [])]); const m = own === 'fresh' || kids.includes('fresh') ? 'fresh' : own ?? kids.find(Boolean) ?? (node.period?.live ? 'recent' : undefined); return m ? { live: m } : {}; })()),
    // Red flags: count and strongest score of this node's flagged sources (hover summary).
    ...((() => {
      const flagged = node.branches.map((b) => ({ b, f: b.redFlag ?? propagandaFlag(b.vetting) })).filter((x) => x.f);
      if (!flagged.length) return {};
      const scores = flagged.map((x) => x.f!.score).filter((n): n is number => n !== undefined);
      const max = scores.length ? Math.max(...scores) : undefined;
      const lines = [`⚑ ${flagged.length} red-flagged source${flagged.length === 1 ? '' : 's'}${max !== undefined ? ` · highest ${max}%` : ''}`,
        ...flagged.slice(0, 3).map(({ b, f }) => clip(`${f!.score !== undefined ? `${f!.score}% · ` : ''}${b.sourceDomain ?? b.name}`, 56))];
      return { flags: { count: flagged.length, ...(max !== undefined && { max }), lines } };
    })()),
    branches: node.branches.map((branch) => {
      const branchLive = liveMarks?.get(branch.id) ?? branch.groupedSources?.map((source) => liveMarks?.get(source.id)).find(Boolean);
      return {
        id: branch.id, name: shortLabel(branch.name), ...(branch.name.length > 44 && { fullName: branch.name.replace(/\s+/g, ' ').trim() }), info: branch.info, seed: branch.seed, publishedAt: branch.publishedAt, ...(branch.stance && { stance: branch.stance }), ...(branch.outcomeReport && { outcomeReport: true }), ...(branch.sourceReport && { sourceReport: true }),
        ...(branchLive && { live: branchLive }),
        ...(branch.vetting && { vet: branch.vetting.verdict }),
        ...(vetTag(branch.vetting) && { vetTag: vetTag(branch.vetting) }),
        ...((branch.redFlag ?? propagandaFlag(branch.vetting)) && { flag: branch.redFlag ?? propagandaFlag(branch.vetting) }),
        ...(branch.claimSources && { sources: new Set(branch.claimSources.map((x) => x.publisher ?? x.url ?? x.title)).size }),
        ...(branch.groupedSources && branch.groupedSources.length > 1 && { sources: new Set(branch.groupedSources.map((x) => x.sourceName ?? x.sourceDomain ?? x.sourceUrl ?? x.name)).size }),
        ...(branch.claimStatus === 'pending' && { unverifiedClaim: true }),
        // Live branches re-grow; group branches already represent their sources, so a pulse is enough.
        isNew: Boolean(branch._animateGrowth || (branch._prog !== undefined && branch._prog < 1) || (!branch.groupedSources && branchLive === 'fresh')),
      };
    }),
  }));
}

export function TreeCanvasAdapter({ spine, selectedIndex, focus, moving, detailLevel, researching, fitSignal, onHoverTarget, onSelectTarget, onClearPin, onContinue, isContinuing, highlight = null, links, laneNote, liveMarks, onViewChange, onCanvasReady, onGrowthComplete }: Props) {
  const models = useMemo(() => mapTreeModels(spine, liveMarks), [spine, liveMarks]);
  const selected = focus ?? { i: selectedIndex };
  const selectedBranch: BranchNode | undefined = selected.j === undefined ? undefined : spine[selected.i]?.branches[selected.j];
  const selectNode = (i: number) => onSelectTarget({ i });
  const setFocus = (target: { spineIndex: number; branchIndex?: number } | null) => {
    if (!target) { onHoverTarget(null); return; }
    onHoverTarget({ i: target.spineIndex, ...(target.branchIndex === undefined ? {} : { j: target.branchIndex }) });
  };
  const selectBranch = (i: number, j: number) => onSelectTarget({ i, j });
  return <div className={`itl-tree ${detailLevel === 'minimal' ? 'detail-minimal' : ''} ${moving ? '' : 'motion-paused'}`}><TreeCanvas spine={models} selectedIndex={selectedIndex} focusTarget={focus ? { spineIndex: focus.i, ...(focus.j === undefined ? {} : { branchIndex: focus.j }) } : null} isPaused={!moving} researching={researching} fitRequest={{ id: fitSignal, instant: fitSignal === 0 }} onSelectNode={selectNode} onSelectBranch={selectBranch} onSetFocus={setFocus} onGrowthComplete={onGrowthComplete} onContinue={onContinue} isContinuing={isContinuing} highlight={highlight} links={links} claimView={links !== undefined || spine.some((n) => n.period)} laneNote={laneNote} onViewChange={onViewChange} onCanvasReady={onCanvasReady} className="itl-svg" />
    {spine.map((node, i) => node.branches.map((branch, j) => <button key={`${node.id}:${branch.id}`} className="itl-branch-hit" style={{ left: `${((i + 0.5) / Math.max(spine.length, 1)) * 100}%`, top: `${j % 2 ? 62 : 38}%` }} aria-label={`Select evidence: ${branch.name}`} onMouseEnter={() => onHoverTarget({ i, j })} onMouseLeave={() => onHoverTarget(null)} onClick={() => selectBranch(i, j)} />))}
    {selectedBranch && <span className="itl-source-preserve" aria-hidden="true">{selectedBranch.sourceUrl}{selectedBranch.sourceDomain}{selectedBranch.publishedAt}{selectedBranch.sourceType}{selectedBranch.impactAngle}</span>}
    <button className="itl-clear" aria-label="Clear selection" onClick={onClearPin} />
  </div>;
}
