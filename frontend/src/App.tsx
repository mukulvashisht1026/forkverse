import { useCallback, useEffect, useState } from 'react';
import type {
  BranchGrowthSide,
  FocusTarget,
  PromptTargetMode,
  ScrapeProviderPreference,
} from './types/tree';
import { resolveApiUrl } from './utils/timelineReducer';
import { useLiveTimeline } from './hooks/useLiveTimeline';
import { TreeMapCanvas } from './components/TreeMapCanvas';
import { SpineNav } from './components/SpineNav';
import { CenterFocusBox } from './components/CenterFocusBox';
import { ScrapePanel } from './components/ScrapePanel';
import { PromptBar } from './components/PromptBar';

export default function App() {
  const [fitSignal, setFitSignal] = useState<number>(0);
  const triggerFit = useCallback(() => setFitSignal((c) => c + 1), []);

  const {
    nodes: spine,
    loading,
    loadError,
    liveMessage,
    dismissMessage,
    reload,
    createMainNode,
    createBranch,
    scrapeMainNode,
    scrapeBranches,
    sendPrompt,
    deleteMainNode,
    deleteBranch,
  } = useLiveTimeline(triggerFit);

  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [hoverFocus, setHoverFocus] = useState<FocusTarget | null>(null);
  const [pinnedFocus, setPinnedFocus] = useState<FocusTarget | null>(null);
  const [moving, setMoving] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return true;
  });
  const [panelOpen, setPanelOpen] = useState<boolean>(false);
  const [exaConfigured, setExaConfigured] = useState<boolean | null>(null);
  const [contextConfigured, setContextConfigured] = useState<boolean | null>(
    null
  );
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  useEffect(() => {
    const statusUrl = resolveApiUrl(
      '/api/status',
      import.meta.env.VITE_API_BASE_URL ?? ''
    );
    fetch(statusUrl)
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: {
            exaConfigured?: boolean;
            contextDevConfigured?: boolean;
          } | null
        ) => {
          if (data) {
            if (typeof data.exaConfigured === 'boolean') {
              setExaConfigured(data.exaConfigured);
            }
            if (typeof data.contextDevConfigured === 'boolean') {
              setContextConfigured(data.contextDevConfigured);
            }
          }
        }
      )
      .catch(() => {
        // Ignore status probe error
      });
  }, []);

  useEffect(() => {
    if (spine.length === 0) {
      setSelectedIndex(0);
      setPinnedFocus(null);
      return;
    }
    if (selectedIndex >= spine.length) {
      setSelectedIndex(spine.length - 1);
    }
    if (pinnedFocus) {
      const targetNode = spine[pinnedFocus.i];
      if (
        !targetNode ||
        (pinnedFocus.j !== undefined && !targetNode.branches[pinnedFocus.j])
      ) {
        setPinnedFocus(null);
      }
    }
  }, [spine, selectedIndex, pinnedFocus]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPinnedFocus(null);
        setPanelOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const activeFocus = hoverFocus ?? pinnedFocus;

  const handleSelectTarget = useCallback((target: FocusTarget) => {
    setSelectedIndex(target.i);
    setPinnedFocus((prev) =>
      prev && prev.i === target.i && prev.j === target.j ? null : target
    );
  }, []);

  const handleSelectFromNav = useCallback((index: number) => {
    setSelectedIndex(index);
    setPinnedFocus({ i: index });
  }, []);

  const handleStepNode = useCallback((nextIndex: number) => {
    setSelectedIndex(nextIndex);
    setPinnedFocus({ i: nextIndex });
  }, []);

  const handleScrapeNewMainNode = useCallback(
    async (input: {
      query: string;
      url?: string;
      provider: ScrapeProviderPreference;
    }) => {
      setStatusBanner(null);
      const prevLen = spine.length;
      const result = await scrapeMainNode(input);
      if (result.notice) {
        setStatusBanner(result.notice);
      }
      setSelectedIndex(prevLen);
      setPinnedFocus({ i: prevLen });
      setFitSignal((c) => c + 1);
      setPanelOpen(false);
    },
    [scrapeMainNode, spine.length]
  );

  const handleScrapeBranchOntoSelected = useCallback(
    async (query: string, provider: ScrapeProviderPreference) => {
      setStatusBanner(null);
      const parent = spine[selectedIndex];
      if (!parent) return;

      const result = await scrapeBranches(parent.id, {
        topic: parent.name,
        query,
        existingCount: parent.branches.length,
        provider,
      });
      if (result.notice) {
        setStatusBanner(result.notice);
      }
      setFitSignal((c) => c + 1);
      setPanelOpen(false);
    },
    [scrapeBranches, selectedIndex, spine]
  );

  const handleAddManualBranch = useCallback(
    async (name: string, info: string, growthSide: BranchGrowthSide) => {
      const parent = spine[selectedIndex];
      if (!parent) return;
      await createBranch(parent.id, { name, info, growthSide });
      setFitSignal((c) => c + 1);
    },
    [createBranch, selectedIndex, spine]
  );

  const handleAddManualMain = useCallback(
    async (name: string, info: string) => {
      const prevLen = spine.length;
      await createMainNode({ name, info });
      setSelectedIndex(prevLen);
      setPinnedFocus({ i: prevLen });
      setFitSignal((c) => c + 1);
    },
    [createMainNode, spine.length]
  );

  const handleDeleteNode = useCallback(
    async (nodeId: string) => {
      await deleteMainNode(nodeId);
      setPinnedFocus(null);
    },
    [deleteMainNode]
  );

  const handleDeleteBranch = useCallback(
    async (nodeId: string, branchId: string) => {
      await deleteBranch(nodeId, branchId);
      setPinnedFocus(null);
    },
    [deleteBranch]
  );

  const handleSubmitPrompt = useCallback(
    async (input: {
      prompt: string;
      mode: PromptTargetMode;
      provider: ScrapeProviderPreference;
    }) => {
      setStatusBanner(null);
      const current = spine[selectedIndex];
      const prevLen = spine.length;
      const result = await sendPrompt({
        prompt: input.prompt,
        mode: input.mode,
        selectedNodeId: current?.id,
        selectedNodeName: current?.name,
        provider: input.provider,
      });
      if (result.notice) {
        setStatusBanner(result.notice);
      }
      if (result.node && result.mode !== 'branch') {
        setSelectedIndex(prevLen);
        setPinnedFocus({ i: prevLen });
      }
      setFitSignal((c) => c + 1);
    },
    [selectedIndex, sendPrompt, spine]
  );

  const selectedNode = spine[selectedIndex];
  const bannerText = liveMessage?.text ?? statusBanner;

  return (
    <main className="relative h-full w-full overflow-hidden select-none">
      <TreeMapCanvas
        spine={spine}
        selectedIndex={selectedIndex}
        focus={activeFocus}
        moving={moving}
        fitSignal={fitSignal}
        onHoverTarget={setHoverFocus}
        onSelectTarget={handleSelectTarget}
        onClearPin={() => setPinnedFocus(null)}
      />

      {/* Top Bar */}
      <header className="pointer-events-none absolute inset-x-4 top-4 z-20 flex items-center justify-between gap-2 sm:inset-x-8 sm:top-[22px] sm:gap-4">
        <h1 className="pointer-events-auto m-0 whitespace-nowrap shrink-0 text-[15px] font-normal tracking-[-0.01em] text-[#eef2fb] sm:text-[16px]">
          Signal Spine
        </h1>

        <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-3">
          <button
            type="button"
            aria-pressed={moving}
            onClick={() => setMoving((m) => !m)}
            className="cursor-pointer whitespace-nowrap shrink-0 rounded-[10px] border border-white/14 bg-white/10 px-2.5 py-1.5 text-[12.5px] font-light text-white backdrop-blur-md transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-[#ff9a4d] sm:px-3.5 sm:text-[14px]"
          >
            {moving ? 'Pause' : 'Resume'}
            <span className="hidden sm:inline"> motion</span>
          </button>

          <button
            type="button"
            onClick={() => setFitSignal((c) => c + 1)}
            className="cursor-pointer whitespace-nowrap shrink-0 rounded-[10px] border border-white/14 bg-white/10 px-2.5 py-1.5 text-[12.5px] font-light text-white backdrop-blur-md transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-[#ff9a4d] sm:px-3.5 sm:text-[14px]"
          >
            Fit<span className="hidden sm:inline"> view</span>
          </button>

          <button
            type="button"
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((o) => !o)}
            className="cursor-pointer whitespace-nowrap shrink-0 rounded-[10px] border border-white/14 bg-white/10 px-2.5 py-1.5 text-[12.5px] font-light text-white backdrop-blur-md transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-[#ff9a4d] sm:px-3.5 sm:text-[14px]"
          >
            + Scrape<span className="hidden sm:inline"> / Add</span>
          </button>
        </div>
      </header>

      {bannerText && (
        <div
          role="status"
          data-testid="live-message-banner"
          className="glass-panel-surface absolute left-1/2 top-16 z-20 flex max-w-[min(560px,calc(100%-32px))] -translate-x-1/2 items-center gap-3 px-3.5 py-2 text-[12.5px] text-[#9fd8ff]"
        >
          <span>{bannerText}</span>
          <button
            type="button"
            onClick={() => {
              dismissMessage();
              setStatusBanner(null);
            }}
            aria-label="Dismiss message"
            className="cursor-pointer shrink-0 text-[#8e9bb8] hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {loading && spine.length === 0 && (
        <div
          role="status"
          className="glass-panel-surface absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 px-5 py-3 text-[13.5px] text-[#cfd8ea]"
        >
          Loading timeline from backend server...
        </div>
      )}

      {loadError && spine.length === 0 && (
        <div
          role="alert"
          className="glass-panel-surface absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 px-6 py-4 text-center"
        >
          <p className="m-0 text-[13.5px] text-[#ffcca6]">{loadError}</p>
          <button
            type="button"
            onClick={() => void reload()}
            className="cursor-pointer rounded-lg border border-white/15 bg-white/10 px-3.5 py-1.5 text-[13px] text-white transition-colors hover:bg-white/20"
          >
            Retry backend sync
          </button>
        </div>
      )}

      {!loading && !loadError && spine.length === 0 && !panelOpen && (
        <div
          data-testid="empty-timeline-state"
          className="glass-panel-surface absolute left-1/2 top-1/2 z-20 flex w-[min(460px,calc(100%-32px))] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 px-6 py-5 text-center"
        >
          <p className="m-0 text-[15px] font-normal text-[#eef2fb]">
            Waiting for live backend timeline data
          </p>
          <p className="m-0 text-[13px] leading-relaxed text-[#8e9bb8]">
            Connected to <span className="font-mono-tabular text-[#cfd8ea]">/ws</span> and{' '}
            <span className="font-mono-tabular text-[#cfd8ea]">/api/timeline</span>. Push nodes from your backend or scrape a live X / web event now.
          </p>
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            className="mt-1 cursor-pointer rounded-lg border border-[#ff9a4d] bg-[#ff9a4d] px-3.5 py-1.5 text-[13px] font-medium text-[#1a0e04] transition-opacity hover:opacity-95"
          >
            Scrape live event
          </button>
        </div>
      )}

      <SpineNav
        spine={spine}
        selectedIndex={selectedIndex}
        onHoverNode={setHoverFocus}
        onSelectNode={handleSelectFromNav}
      />

      <CenterFocusBox
        spine={spine}
        focus={activeFocus}
        pinned={Boolean(
          pinnedFocus &&
            (!hoverFocus ||
              (hoverFocus.i === pinnedFocus.i &&
                hoverFocus.j === pinnedFocus.j))
        )}
        onUnpin={() => setPinnedFocus(null)}
        onStepNode={handleStepNode}
        onDeleteNode={handleDeleteNode}
        onDeleteBranch={handleDeleteBranch}
      />

      <ScrapePanel
        open={panelOpen}
        selectedNodeName={selectedNode?.name ?? ''}
        exaConfigured={exaConfigured}
        contextDevConfigured={contextConfigured}
        onClose={() => setPanelOpen(false)}
        onScrapeNewMainNode={handleScrapeNewMainNode}
        onScrapeBranchOntoSelected={handleScrapeBranchOntoSelected}
        onAddManualBranch={handleAddManualBranch}
        onAddManualMain={handleAddManualMain}
      />

      <PromptBar
        selectedNodeName={selectedNode?.name ?? ''}
        onSubmitPrompt={handleSubmitPrompt}
      />
    </main>
  );
}
