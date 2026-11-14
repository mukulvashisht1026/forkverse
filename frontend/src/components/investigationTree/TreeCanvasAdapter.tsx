import { useMemo } from 'react';
import type { BranchNode, FocusTarget as AppFocus, SpineNode as AppSpine } from '../../types/tree';
import { TreeCanvas } from './components/TreeCanvas';

interface Props {
  spine: AppSpine[];
  selectedIndex: number;
  focus: AppFocus | null;
  moving: boolean;
  fitSignal: number;
  onHoverTarget: (target: AppFocus | null) => void;
  onSelectTarget: (target: AppFocus) => void;
  onClearPin: () => void;
  onContinue: () => void;
  isContinuing: boolean;
  /** Evidence/event ids to highlight (cited by the current answer); null = no highlight. */
  highlight?: { evidenceIds: ReadonlySet<string>; eventIds: ReadonlySet<string>; roles?: ReadonlyMap<string, string> } | null;
}

/** Canvas labels only: long article titles are truncated (the detail panel keeps the full title). */
export function shortLabel(name: string, max = 44): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function mapTreeModels(spine: AppSpine[]) {
  return spine.map((node) => ({
    id: node.id, name: node.name, info: node.info,
    branches: node.branches.map((branch) => ({
      id: branch.id, name: shortLabel(branch.name), info: branch.info, seed: branch.seed, publishedAt: branch.publishedAt,
      isNew: Boolean(branch._animateGrowth || (branch._prog !== undefined && branch._prog < 1)),
    })),
  }));
}

export function TreeCanvasAdapter({ spine, selectedIndex, focus, moving, fitSignal, onHoverTarget, onSelectTarget, onClearPin, onContinue, isContinuing, highlight = null }: Props) {
  const models = useMemo(() => mapTreeModels(spine), [spine]);
  const selected = focus ?? { i: selectedIndex };
  const selectedBranch: BranchNode | undefined = selected.j === undefined ? undefined : spine[selected.i]?.branches[selected.j];
  const selectNode = (i: number) => onSelectTarget({ i });
  const setFocus = (target: { spineIndex: number; branchIndex?: number } | null) => {
    if (!target) { onHoverTarget(null); return; }
    onHoverTarget({ i: target.spineIndex, ...(target.branchIndex === undefined ? {} : { j: target.branchIndex }) });
  };
  const selectBranch = (i: number, j: number) => onSelectTarget({ i, j });
  return <div className="itl-tree"><TreeCanvas spine={models} selectedIndex={selectedIndex} focusTarget={focus ? { spineIndex: focus.i, ...(focus.j === undefined ? {} : { branchIndex: focus.j }) } : null} isPaused={!moving} fitRequest={{ id: fitSignal, instant: fitSignal === 0 }} onSelectNode={selectNode} onSetFocus={setFocus} onBranchGrowthComplete={() => {}} onContinue={onContinue} isContinuing={isContinuing} highlight={highlight} className="itl-svg" />
    {spine.map((node, i) => node.branches.map((branch, j) => <button key={`${node.id}:${branch.id}`} className="itl-branch-hit" style={{ left: `${((i + 0.5) / Math.max(spine.length, 1)) * 100}%`, top: `${j % 2 ? 62 : 38}%` }} aria-label={`Select evidence: ${branch.name}`} onMouseEnter={() => onHoverTarget({ i, j })} onMouseLeave={() => onHoverTarget(null)} onClick={() => selectBranch(i, j)} />))}
    {selectedBranch && <span className="itl-source-preserve" aria-hidden="true">{selectedBranch.sourceUrl}{selectedBranch.sourceDomain}{selectedBranch.publishedAt}{selectedBranch.sourceType}{selectedBranch.impactAngle}</span>}
    <button className="itl-clear" aria-label="Clear selection" onClick={onClearPin} />
  </div>;
}
