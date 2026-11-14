import { useMemo } from 'react';
import type { BranchNode, FocusTarget as AppFocus, SpineNode as AppSpine } from '../../types/tree';
import type { ViewTransform } from './types/tree';
import { TreeCanvas } from './components/TreeCanvas';

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
  /** Evidence/event ids to highlight (cited by the current answer); null = no highlight. */
  highlight?: { evidenceIds: ReadonlySet<string>; eventIds: ReadonlySet<string> } | null;
  onViewChange?: (view: ViewTransform) => void;
  onCanvasReady?: (svg: SVGSVGElement | null) => void;
  onGrowthComplete: (eventId: string, evidenceId?: string) => void;
}

/** Canvas labels only: long article titles are truncated (the detail panel keeps the full title). */
export function shortLabel(name: string, max = 44): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function mapTreeModels(spine: AppSpine[]) {
  return spine.map((node) => ({
    id: node.id, name: node.name, info: node.info, isNew: Boolean(node._animateGrowth),
    branches: node.branches.map((branch) => ({
      id: branch.id, name: shortLabel(branch.name), info: branch.info, seed: branch.seed,
      isNew: Boolean(branch._animateGrowth || (branch._prog !== undefined && branch._prog < 1)),
    })),
  }));
}

export function TreeCanvasAdapter({ spine, selectedIndex, focus, moving, detailLevel, researching, fitSignal, onHoverTarget, onSelectTarget, onClearPin, onContinue, isContinuing, highlight = null, onViewChange, onCanvasReady, onGrowthComplete }: Props) {
  const models = useMemo(() => mapTreeModels(spine), [spine]);
  const selected = focus ?? { i: selectedIndex };
  const selectedBranch: BranchNode | undefined = selected.j === undefined ? undefined : spine[selected.i]?.branches[selected.j];
  const selectNode = (i: number) => onSelectTarget({ i });
  const setFocus = (target: { spineIndex: number; branchIndex?: number } | null) => {
    if (!target) { onHoverTarget(null); return; }
    onHoverTarget({ i: target.spineIndex, ...(target.branchIndex === undefined ? {} : { j: target.branchIndex }) });
  };
  const selectBranch = (i: number, j: number) => onSelectTarget({ i, j });
 return <div className={`itl-tree ${detailLevel === 'minimal' ? 'detail-minimal' : ''} ${moving ? '' : 'motion-paused'}`}><TreeCanvas spine={models} selectedIndex={selectedIndex} focusTarget={focus ? { spineIndex: focus.i, ...(focus.j === undefined ? {} : { branchIndex: focus.j }) } : null} isPaused={!moving} researching={researching} fitRequest={{ id: fitSignal, instant: fitSignal === 0 }} onSelectNode={selectNode} onSelectBranch={selectBranch} onSetFocus={setFocus} onGrowthComplete={onGrowthComplete} onContinue={onContinue} isContinuing={isContinuing} highlight={highlight} onViewChange={onViewChange} onCanvasReady={onCanvasReady} className="itl-svg" />
    {selectedBranch && <span className="itl-source-preserve" aria-hidden="true">{selectedBranch.sourceUrl}{selectedBranch.sourceDomain}{selectedBranch.publishedAt}{selectedBranch.sourceType}{selectedBranch.impactAngle}</span>}
    <button className="itl-clear" aria-label="Clear selection" onClick={onClearPin} />
  </div>;
}
