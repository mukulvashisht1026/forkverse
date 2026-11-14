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
}

export function mapTreeModels(spine: AppSpine[]) {
  return spine.map((node) => ({
    id: node.id, name: node.name, info: node.info,
    branches: node.branches.map((branch) => ({
      id: branch.id, name: branch.name, info: branch.info, seed: branch.seed,
      isNew: Boolean(branch._animateGrowth || (branch._prog !== undefined && branch._prog < 1)),
    })),
  }));
}

export function TreeCanvasAdapter({ spine, selectedIndex, focus, moving, fitSignal, onHoverTarget, onSelectTarget, onClearPin, onContinue, isContinuing }: Props) {
  const models = useMemo(() => mapTreeModels(spine), [spine]);
  const selected = focus ?? { i: selectedIndex };
  const selectedBranch: BranchNode | undefined = selected.j === undefined ? undefined : spine[selected.i]?.branches[selected.j];
  const selectNode = (i: number) => onSelectTarget({ i });
  const setFocus = (target: { spineIndex: number; branchIndex?: number } | null) => {
    if (!target) { onHoverTarget(null); return; }
    onHoverTarget({ i: target.spineIndex, ...(target.branchIndex === undefined ? {} : { j: target.branchIndex }) });
  };
  const selectBranch = (i: number, j: number) => onSelectTarget({ i, j });
  return <div className="itl-tree"><TreeCanvas spine={models} selectedIndex={selectedIndex} focusTarget={focus ? { spineIndex: focus.i, ...(focus.j === undefined ? {} : { branchIndex: focus.j }) } : null} isPaused={!moving} fitRequest={{ id: fitSignal, instant: fitSignal === 0 }} onSelectNode={selectNode} onSelectBranch={selectBranch} onSetFocus={setFocus} onBranchGrowthComplete={() => {}} onContinue={onContinue} isContinuing={isContinuing} className="itl-svg" />
    {selectedBranch && <span className="itl-source-preserve" aria-hidden="true">{selectedBranch.sourceUrl}{selectedBranch.sourceDomain}{selectedBranch.publishedAt}{selectedBranch.sourceType}{selectedBranch.impactAngle}</span>}
    <button className="itl-clear" aria-label="Clear selection" onClick={onClearPin} />
  </div>;
}
