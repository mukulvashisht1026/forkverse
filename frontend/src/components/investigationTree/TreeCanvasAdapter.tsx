import { useMemo } from 'react';
import type { BranchNode, FocusTarget as AppFocus, SpineNode as AppSpine } from '../../types/tree';
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
    id: node.id, name: node.claimStatus ? node.name : shortLabel(node.name, 46), info: node.info,
    isNew: Boolean(node._animateGrowth),
    // News view: pending claims go to the separate unverified lane. Politician view: the main line IS
    // the claim tracker, so single-source claims stay on it with an UNVERIFIED badge instead.
    ...(node.claimStatus === 'pending' && (node.outcome ? { unverified: true } : { pending: true })),
    ...(node.disputed && { disputed: true }), ...(node.outcome && { outcome: node.outcome }),
    // A node counts as live-updated when it, or any of its sources, was just added by a monitor.
    ...((() => { const own = liveMarks?.get(node.id); const kids = node.branches.flatMap((b) => [liveMarks?.get(b.id), ...(b.groupedSources?.map((source) => liveMarks?.get(source.id)) ?? [])]); const m = own === 'fresh' || kids.includes('fresh') ? 'fresh' : own ?? kids.find(Boolean); return m ? { live: m } : {}; })()),
    branches: node.branches.map((branch) => {
      const branchLive = liveMarks?.get(branch.id) ?? branch.groupedSources?.map((source) => liveMarks?.get(source.id)).find(Boolean);
      return {
        id: branch.id, name: shortLabel(branch.name), info: branch.info, seed: branch.seed, publishedAt: branch.publishedAt, ...(branch.stance && { stance: branch.stance }), ...(branch.outcomeReport && { outcomeReport: true }), ...(branch.sourceReport && { sourceReport: true }),
        ...(branchLive && { live: branchLive }),
        // Group branches already represent their sources; a pulse is enough, don't regrow them.
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
  return <div className={`itl-tree ${detailLevel === 'minimal' ? 'detail-minimal' : ''} ${moving ? '' : 'motion-paused'}`}><TreeCanvas spine={models} selectedIndex={selectedIndex} focusTarget={focus ? { spineIndex: focus.i, ...(focus.j === undefined ? {} : { branchIndex: focus.j }) } : null} isPaused={!moving} researching={researching} fitRequest={{ id: fitSignal, instant: fitSignal === 0 }} onSelectNode={selectNode} onSelectBranch={selectBranch} onSetFocus={setFocus} onGrowthComplete={onGrowthComplete} onContinue={onContinue} isContinuing={isContinuing} highlight={highlight} links={links} claimView={links !== undefined} laneNote={laneNote} onViewChange={onViewChange} onCanvasReady={onCanvasReady} className="itl-svg" />
    {spine.map((node, i) => node.branches.map((branch, j) => <button key={`${node.id}:${branch.id}`} className="itl-branch-hit" style={{ left: `${((i + 0.5) / Math.max(spine.length, 1)) * 100}%`, top: `${j % 2 ? 62 : 38}%` }} aria-label={`Select evidence: ${branch.name}`} onMouseEnter={() => onHoverTarget({ i, j })} onMouseLeave={() => onHoverTarget(null)} onClick={() => selectBranch(i, j)} />))}
    {selectedBranch && <span className="itl-source-preserve" aria-hidden="true">{selectedBranch.sourceUrl}{selectedBranch.sourceDomain}{selectedBranch.publishedAt}{selectedBranch.sourceType}{selectedBranch.impactAngle}</span>}
    <button className="itl-clear" aria-label="Clear selection" onClick={onClearPin} />
  </div>;
}
