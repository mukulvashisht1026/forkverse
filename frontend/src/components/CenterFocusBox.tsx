import { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Trash2,
  X,
} from 'lucide-react';
import type { FocusTarget, SpineNode } from '../types/tree';

interface CenterFocusBoxProps {
  spine: SpineNode[];
  focus: FocusTarget | null;
  pinned: boolean;
  onUnpin: () => void;
  onStepNode: (nextIndex: number) => void;
  onDeleteNode?: (nodeId: string) => Promise<void>;
  onDeleteBranch?: (nodeId: string, branchId: string) => Promise<void>;
}

function formatEngineTag(engine: SpineNode['scrapeEngine']): string | null {
  if (engine === 'exa') return 'Exa AI Search';
  if (engine === 'context.dev') return 'Context.dev live';
  if (engine === 'gemini-search') return 'Live search grounding';
  return null;
}

export function CenterFocusBox({
  spine,
  focus,
  pinned,
  onUnpin,
  onStepNode,
  onDeleteNode,
  onDeleteBranch,
}: CenterFocusBoxProps) {
  const [deleting, setDeleting] = useState(false);
  const node = focus ? spine[focus.i] : undefined;
  const branch =
    focus && focus.j !== undefined && node ? node.branches[focus.j] : undefined;
  const isVisible = Boolean(node && (focus?.j === undefined || branch));

  if (!isVisible || !node || !focus) {
    return null;
  }

  const engineTag = formatEngineTag(node.scrapeEngine);
  const topCount = node.branches.filter(
    (b) => b.growthSide !== 'bottom' && b.sourceType !== 'social'
  ).length;
  const bottomCount = node.branches.length - topCount;

  const handleDeleteNode = async () => {
    if (!onDeleteNode || deleting) return;
    setDeleting(true);
    try {
      await onDeleteNode(node.id);
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteBranch = async () => {
    if (!onDeleteBranch || !branch || deleting) return;
    setDeleting(true);
    try {
      await onDeleteBranch(node.id, branch.id);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section
      id="focus"
      role="status"
      aria-live="polite"
      data-testid="center-focus-box"
      className={`focus-card-surface absolute left-1/2 top-[calc(50%-18px)] z-30 w-[min(540px,calc(100%-32px))] max-h-[calc(100dvh-240px)] overflow-y-auto px-6 py-5 sm:top-[calc(50%-20px)] sm:max-h-[min(620px,calc(100dvh-230px))] sm:px-7 sm:py-6 ${
        pinned ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
    >
      {focus.j === undefined && (
        <div>
          <div className="flex items-start justify-between gap-3">
            <p className="m-0 text-[13px] text-[#8e9bb8]">
              <span>
                Main node {focus.i + 1} of {spine.length}
              </span>
              <span aria-hidden="true"> · </span>
              <span>{node.platform}</span>
              {node.timestamp && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span>{node.timestamp}</span>
                </>
              )}
              {engineTag && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="text-[#9fd8ff]">{engineTag}</span>
                </>
              )}
            </p>
            {pinned && (
              <div className="flex shrink-0 items-center gap-1">
                {spine.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        onStepNode((focus.i - 1 + spine.length) % spine.length)
                      }
                      aria-label="Previous main node"
                      className="cursor-pointer rounded-md p-1 text-[#8e9bb8] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-[#ff9a4d]"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onStepNode((focus.i + 1) % spine.length)}
                      aria-label="Next main node"
                      className="cursor-pointer rounded-md p-1 text-[#8e9bb8] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-[#ff9a4d]"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </>
                )}
                {onDeleteNode && (
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => void handleDeleteNode()}
                    aria-label="Remove main node"
                    className="cursor-pointer rounded-md p-1 text-[#8e9bb8] transition-colors hover:bg-white/10 hover:text-[#ff9a4d] focus-visible:outline-2 focus-visible:outline-[#ff9a4d] disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onUnpin}
                  aria-label="Close focus card"
                  className="cursor-pointer rounded-md p-1 text-[#8e9bb8] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-[#ff9a4d]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          <h2 className="mt-2.5 mb-2 text-[30px] leading-[1.12] font-light tracking-[-0.01em] text-[#eef2fb] [text-wrap:balance] sm:text-[36px]">
            {node.name}
          </h2>

          <p className="m-0 text-[14.5px] leading-relaxed text-[#cfd8ea]">
            {node.declaration}
          </p>

          <p className="mt-2.5 mb-0 text-[13.5px] leading-relaxed text-[#8e9bb8]">
            {node.info}
          </p>

          {/* Stock & Market Impact */}
          <div className="mt-4 border-t border-white/12 pt-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="m-0 text-[13px] font-medium text-[#eef2fb]">
                Stock & Market Impact
              </h3>
              <span className="text-[12px] text-[#8e9bb8]">
                Equities & sectors
              </span>
            </div>
            <p className="mt-1.5 mb-2.5 text-[13.5px] leading-snug text-[#cfd8ea]">
              {node.stockImpact.summary}
            </p>
            {node.stockImpact.tickers.length > 0 && (
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3 sm:gap-3">
                {node.stockImpact.tickers.map((t) => {
                  const dirColor =
                    t.direction === 'up'
                      ? 'text-[#3fc1c9]'
                      : t.direction === 'down'
                        ? 'text-[#ff9a4d]'
                        : 'text-[#9fd8ff]';
                  const dirSymbol =
                    t.direction === 'up'
                      ? '▲'
                      : t.direction === 'down'
                        ? '▼'
                        : '◆';
                  return (
                    <div
                      key={t.ticker}
                      className="flex items-baseline justify-between border-t border-white/8 pt-1.5 sm:block"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono-tabular text-[13px] font-medium text-white">
                          {t.ticker}
                        </span>
                        <span
                          className={`font-mono-tabular text-[13px] font-medium ${dirColor}`}
                        >
                          <span aria-hidden="true">{dirSymbol} </span>
                          {t.change}
                        </span>
                      </div>
                      <div className="truncate text-[12px] text-[#8e9bb8]">
                        {t.company}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Public Appeal & Sentiment */}
          <div className="mt-4 border-t border-white/12 pt-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="m-0 text-[13px] font-medium text-[#eef2fb]">
                Public Appeal & Sentiment
              </h3>
              <span className="text-[12px] text-[#cfd8ea]">
                {node.publicAppeal.sentimentLabel}
              </span>
            </div>

            <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                style={{ width: `${node.publicAppeal.positivePct}%` }}
                className="bg-[#3fc1c9]"
              />
              <div
                style={{ width: `${node.publicAppeal.neutralPct}%` }}
                className="bg-[#8e9bb8]/60"
              />
              <div
                style={{ width: `${node.publicAppeal.negativePct}%` }}
                className="bg-[#ff9a4d]"
              />
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono-tabular text-[12px] text-[#8e9bb8]">
              <span className="text-[#3fc1c9]">
                {node.publicAppeal.positivePct}% Support
              </span>
              <span aria-hidden="true">·</span>
              <span>{node.publicAppeal.neutralPct}% Neutral</span>
              <span aria-hidden="true">·</span>
              <span className="text-[#ff9a4d]">
                {node.publicAppeal.negativePct}% Opposition
              </span>
            </div>

            <p className="mt-2 mb-0 text-[13.5px] leading-snug text-[#cfd8ea]">
              {node.publicAppeal.narrative}
            </p>
          </div>

          {/* Branch summary */}
          <div className="mt-4 border-t border-white/12 pt-3 text-[12.5px] text-[#8e9bb8]">
            {node.branches.length > 0
              ? `Support branches (${topCount} above · ${bottomCount} below): ${node.branches
                  .map((b) => b.name)
                  .join(' · ')}`
              : 'No support branches mapped yet — use Scrape / Add to grow branches.'}
          </div>
        </div>
      )}

      {branch && (
        <div>
          <div className="flex items-start justify-between gap-4">
            <p className="m-0 text-[13px] text-[#8e9bb8]">
              <span>Branch of {node.name}</span>
              <span aria-hidden="true"> · </span>
              <span className="capitalize">{branch.sourceType}</span>
              {branch.sourceDomain && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span>{branch.sourceDomain}</span>
                </>
              )}
              {branch.impactAngle && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span>{branch.impactAngle}</span>
                </>
              )}
            </p>
            {pinned && (
              <div className="flex shrink-0 items-center gap-1">
                {onDeleteBranch && (
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => void handleDeleteBranch()}
                    aria-label="Remove branch"
                    className="cursor-pointer rounded-md p-1 text-[#8e9bb8] transition-colors hover:bg-white/10 hover:text-[#ff9a4d] focus-visible:outline-2 focus-visible:outline-[#ff9a4d] disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onUnpin}
                  aria-label="Close branch card"
                  className="cursor-pointer rounded-md p-1 text-[#8e9bb8] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-[#ff9a4d]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          <h2 className="mt-2.5 mb-3 text-[28px] leading-[1.15] font-light text-[#eef2fb] [text-wrap:balance] sm:text-[32px]">
            {branch.name}
          </h2>

          <p className="m-0 text-[15px] leading-relaxed text-[#cfd8ea]">
            {branch.info || 'No scraped excerpt available.'}
          </p>

          {branch.sourceUrl && (
            <div className="mt-4 border-t border-white/12 pt-3">
              {pinned ? (
                <a
                  href={branch.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#9fd8ff] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-[#ff9a4d]"
                >
                  Open scraped source ({branch.sourceDomain || 'link'})
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : (
                <span className="text-[12.5px] text-[#8e9bb8]">
                  Click this branch orb to pin and open{' '}
                  {branch.sourceDomain || 'source URL'}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
