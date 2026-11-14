import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, ArrowUpRight, LoaderCircle } from 'lucide-react';
import type { FocusTarget, SpineNode, BranchNode } from './types/tree';
import { useLiveTimeline } from './hooks/useLiveTimeline';
import { TreeCanvasAdapter } from './components/investigationTree/TreeCanvasAdapter';
import './components/investigationTree/treeCanvas.css';
import { SpineNav } from './components/SpineNav';
import { investigationRepository, rolesFrom, vettingRepository, watchInvestigation, type Investigation, type InvestigationHighlight, type Monitor, type MonitorActivity, type VettingActivity } from './services/investigations';
import { SourceVettingPanel, VettingCard } from './components/SourceVetting';
import { LiveMonitor, host as siteHost } from './components/LiveMonitor';
import { addLiveIds, liveMarksAt, pruneLiveIds } from './utils/liveMarks';
import { ResearchChat } from './components/ResearchChat';
import type { InvestigationGraphDto } from '../../contracts/investigations';
import { mapInvestigationGraphDto, type ClaimLink, type InvestigationGraph } from './services/investigations';

/** Claim view: pending claims shown on the unverified lane (the rest are counted). */
const PENDING_SHOWN = 8;
import { investigationEventsToSpineNodes } from './services/investigationGraphAdapter';
import { NodeCard } from './components/NodeCard';
import { SPINE_GAP, generateBranchGeometry } from './components/investigationTree/utils/treeMath';

function safeHostname(value: string): string | undefined {
  try { return new URL(value).hostname; } catch { return undefined; }
}

function asDate(value?: string) {
  if (!value || value === 'Live update' || value === 'Live scrape') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
}

export default function App() {
const [workspaceFitSignal, setWorkspaceFitSignal] = useState(0);
const fitGraph = useCallback(() => setWorkspaceFitSignal((count) => count + 1), []);
const { sendPrompt } = useLiveTimeline(fitGraph);
  const [view, setView] = useState<'home' | 'workspace'>('home');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hoverFocus, setHoverFocus] = useState<FocusTarget | null>(null);
  const [pinnedFocus, setPinnedFocus] = useState<FocusTarget | null>(null);
  const [motionOn, setMotionOn] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [topic, setTopic] = useState('');
  const [exampleOffset, setExampleOffset] = useState(0);
  const [suggestionHovered, setSuggestionHovered] = useState(false);
  const [suggestionFocused, setSuggestionFocused] = useState(false);
  const [topicFocused, setTopicFocused] = useState(false);
  const [showAllInvestigations, setShowAllInvestigations] = useState(false);
  const [reducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [selectedInvestigation, setSelectedInvestigation] = useState<Investigation | null>(null);
  const [temporaryTimelineContext, setTemporaryTimelineContext] = useState(false);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceNodes, setWorkspaceNodes] = useState<SpineNode[] | null>(null);
  const [continuing, setContinuing] = useState(false);
  /** Graph items cited by the current research answer (pushed over /ws); null = no highlight. */
  const [highlight, setHighlight] = useState<InvestigationHighlight | null>(null);
  const [researchRunning, setResearchRunning] = useState(false);
  /** Live monitor progress for the open investigation (newest last) and the toast being shown. */
  const [monitorActivity, setMonitorActivity] = useState<MonitorActivity[]>([]);
  const [liveToast, setLiveToast] = useState<MonitorActivity | null>(null);
  /** Graph ids added by live tracking, with the time they arrived (drives NEW · LIVE animations). */
  const [liveAdded, setLiveAdded] = useState<Map<string, number>>(() => new Map());
  const [liveClock, setLiveClock] = useState(() => Date.now());
  const markLive = useCallback((ids: Iterable<string | undefined>) => {
    const clean = [...ids].filter((id): id is string => Boolean(id));
    if (!clean.length) return;
    const now = Date.now();
    setLiveClock(now);
    setLiveAdded((prev) => addLiveIds(prev, clean, now));
  }, []);
  const liveMarks = useMemo(() => liveMarksAt(liveAdded, liveClock), [liveAdded, liveClock]);
  // Re-evaluate fresh -> recent -> expired while anything is marked.
  useEffect(() => {
    if (!liveAdded.size) return;
    const t = window.setInterval(() => {
      const now = Date.now();
      setLiveClock(now);
      setLiveAdded((prev) => { const next = pruneLiveIds(prev, now); return next.size === prev.size ? prev : next; });
    }, 5000);
    return () => window.clearInterval(t);
  }, [liveAdded.size]);
  /** Source vetting (propaganda screening) progress and per-source requests in flight. */
  const [vettingActivity, setVettingActivity] = useState<VettingActivity[]>([]);
  const [vetToast, setVetToast] = useState<VettingActivity | null>(null);
  const [screeningIds, setScreeningIds] = useState<ReadonlySet<string>>(() => new Set());
  const screenSource = useCallback(async (investigationId: string, evidenceId: string) => {
    setScreeningIds((s) => new Set(s).add(evidenceId));
    try {
      await vettingRepository.start(investigationId, [evidenceId]);
    } catch (error) {
      setScreeningIds((s) => { const n = new Set(s); n.delete(evidenceId); return n; });
      window.alert(error instanceof Error ? error.message : 'Could not screen this source.');
    }
  }, []);
  /** Websites currently tracked by live monitors (shown as links over the graph). */
  const [trackedMonitors, setTrackedMonitors] = useState<Monitor[]>([]);
  const lastRevisionRef = useRef(0);

  /** Claim timeline (Entity -> Topic -> Claims -> Evidence), present once claims were built. */
  const [claimGraph, setClaimGraph] = useState<{ nodes: SpineNode[]; links: ClaimLink[]; hiddenPending: number; entity?: string; mode?: 'news' | 'politician' } | null>(null);
  const [graphMode, setGraphMode] = useState<'claims' | 'runs'>('claims');
  const showClaims = graphMode === 'claims' && Boolean(claimGraph?.nodes.length);
  const activeNodes = showClaims ? claimGraph!.nodes : workspaceNodes ?? [];
  const applyGraph = (graph: InvestigationGraph) => {
    setWorkspaceNodes(graph.nodes);
    if (!graph.claimNodes?.length) { setClaimGraph(null); return; }
    // Unverified lane shows the most relevant pending claims (linked, best supported, most recent);
    // the full list stays in the chat summary.
    const links = graph.claimLinks ?? [];
    const linked = new Set(links.flatMap((l) => [l.from, l.to]));
    const pending = graph.claimNodes.filter((n) => n.claimStatus === 'pending');
    const shown = new Set(
      [...pending]
        .sort((a, b) => Number(linked.has(b.id)) - Number(linked.has(a.id)) || b.branches.length - a.branches.length || (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))
        .slice(0, PENDING_SHOWN)
        .map((n) => n.id),
    );
    // Politician view: every claim is on the main tracker line, so nothing is collapsed.
    const politician = graph.mode === 'politician';
    const nodes = graph.claimNodes.filter((n) => politician || n.claimStatus !== 'pending' || shown.has(n.id));
    setClaimGraph({ nodes, links: links.filter((l) => nodes.some((n) => n.id === l.from) && nodes.some((n) => n.id === l.to)), hiddenPending: politician ? 0 : pending.length - shown.size, ...(graph.entity ? { entity: graph.entity } : {}), ...(graph.mode ? { mode: graph.mode } : {}) });
  };
  /** Open node cards: map of nodeId -> { isBranch: boolean, branchIndex?: number } */
  const [openNodeCards, setOpenNodeCards] = useState<Map<string, { isBranch: boolean; spineIndex: number; branchIndex?: number }>>(new Map());
  const [viewTransform, setViewTransform] = useState({ k: 1, x: 0, y: 0 });
  const [canvasElement, setCanvasElement] = useState<SVGSVGElement | null>(null);
  const cardOffsets = useRef(new Map<string, { x: number; y: number }>());
  const [cardRevision, setCardRevision] = useState(0);

  // These are editable example prompts, not claims about a configured demo investigation.
  const topicExamples = [
    'Trace how European AI regulation has evolved, from early proposals to implementation, and connect the major policy decisions to original documents and reporting.',
    'Investigate how global lithium supply chains have shifted, identifying key policy changes, investments, export restrictions, and their original sources.',
    'Follow the international dispute over Arctic shipping routes, connecting policy decisions, environmental concerns, and documented shipping developments.',
    'Investigate how central banks responded to inflation, comparing major decisions over time and tracing the evidence behind each shift.',
    'Trace changes in US tariffs and international trade policy, connecting official announcements with responses from affected trading partners.',
  ];
  const suggestionPaused = suggestionHovered || suggestionFocused || topicFocused || creating || reducedMotion;

  useEffect(() => {
    if (suggestionPaused) return;
    const timer = window.setInterval(() => setExampleOffset((offset) => (offset + 1) % topicExamples.length), 7000);
    return () => window.clearInterval(timer);
  }, [suggestionPaused, topicExamples.length]);

  const loadPublicInvestigations = useCallback(async () => {
    setLibraryLoading(true);
    setLibraryError(null);
    try {
      setInvestigations(await investigationRepository.listPublicInvestigations());
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : 'Public investigations could not be loaded.');
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  useEffect(() => { void loadPublicInvestigations(); }, [loadPublicInvestigations]);

  useEffect(() => {
    if (!pinnedFocus) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setPinnedFocus(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pinnedFocus]);

  useEffect(() => {
    if (selectedIndex >= activeNodes.length) setSelectedIndex(Math.max(0, activeNodes.length - 1));
    if (pinnedFocus) {
      const current = activeNodes[pinnedFocus.i];
      if (!current || (pinnedFocus.j !== undefined && !current.branches[pinnedFocus.j])) setPinnedFocus(null);
    }
  }, [activeNodes, pinnedFocus, selectedIndex]);

  const returnHome = () => {
    setView('home');
    setWorkspaceNodes(null);
    setWorkspaceError(null);
    setHighlight(null);
    setResearchRunning(false);
    setClaimGraph(null);
    setGraphMode('claims');
    void loadPublicInvestigations();
  };

  /** Re-fetch the open investigation's graph; ignores responses older than what is shown. */
  const refreshGraph = useCallback(async (investigationId: string) => {
    try {
      const graph = await investigationRepository.getInvestigationGraph(investigationId);
      if (graph.investigationId !== investigationId || graph.revision < lastRevisionRef.current) return;
      lastRevisionRef.current = graph.revision;
      applyGraph(graph);
    } catch {
      // best effort; the explicit load path reports errors
    }
  }, []);

  // Live updates for a saved investigation: graph growth during research runs, and the
  // citation highlight pushed while the research chat answers.
  const liveInvestigationId = view === 'workspace' && !temporaryTimelineContext ? selectedInvestigation?.id : undefined;
  useEffect(() => {
    if (!liveInvestigationId) return;
    let timer: number | undefined;
    const schedule = () => {
      if (timer === undefined) timer = window.setTimeout(() => { timer = undefined; void refreshGraph(liveInvestigationId); }, 400);
    };
    const stop = watchInvestigation(liveInvestigationId, {
      onUpdate: (update) => {
        setResearchRunning(update.runStatus === 'queued' || update.runStatus === 'running');
        // Live monitor runs ("mon-…"): the new source and its "Live update" event animate in.
        if (update.runId?.startsWith('mon-')) markLive([update.evidenceId, update.eventId]);
        schedule();
      },
      onResync: schedule,
      onHighlight: (next) => {
        if (next.messageId.startsWith('monitor-')) markLive([...next.evidenceIds, ...next.eventIds]);
        setHighlight(next.evidenceIds.size || next.eventIds.size ? next : null);
      },
      onVetting: (activity) => {
        setVettingActivity((list) => [...list.slice(-29), activity]);
        if (activity.evidenceId) setScreeningIds((ids) => { if (!ids.has(activity.evidenceId!)) return ids; const n = new Set(ids); n.delete(activity.evidenceId!); return n; });
        if (activity.phase === 'done' || activity.phase === 'error') { setScreeningIds(new Set()); setVetToast(activity); schedule(); }
        else if (activity.verdict === 'manipulative') setVetToast(activity);
      },
      onMonitor: (activity) => {
        if (activity.phase === 'claims_updated') markLive(activity.newClaimIds ?? []);
        setMonitorActivity((list) => [...list.slice(-29), activity]);
        if (activity.phase !== 'checking') setLiveToast(activity);
        if (activity.phase === 'claims_updated') { schedule(); setWorkspaceFitSignal((v) => v + 1); }
      },
    });
    return () => { stop(); window.clearTimeout(timer); };
  }, [liveInvestigationId, refreshGraph, markLive]);

  useEffect(() => {
    if (!vetToast) return;
    const t = window.setTimeout(() => setVetToast(null), 9000);
    return () => window.clearTimeout(t);
  }, [vetToast]);
  const allSources = useMemo(() => (workspaceNodes ?? []).flatMap((n) => n.branches), [workspaceNodes]);

  // Live toast fades after a while; the full history stays in the monitor panel.
  useEffect(() => {
    if (!liveToast) return;
    const t = window.setTimeout(() => setLiveToast(null), liveToast.phase === 'claims_updated' ? 12_000 : 8000);
    return () => window.clearTimeout(t);
  }, [liveToast]);

  const openWorkspace = async (investigation: Investigation) => {
    setMonitorActivity([]);
    setLiveToast(null);
    setTrackedMonitors([]);
    setLiveAdded(new Map());
    setVettingActivity([]);
    setVetToast(null);
    setScreeningIds(new Set());
    setSelectedInvestigation(investigation);
    setTemporaryTimelineContext(false);
    setView('workspace');
    setWorkspaceNodes(null);
    setWorkspaceError(null);
    setWorkspaceLoading(true);
    setPinnedFocus(null);
    setHighlight(null);
    lastRevisionRef.current = 0;
    try {
      const graph = await investigationRepository.getInvestigationGraph(investigation.id);
      if (graph.investigationId !== investigation.id) throw new Error('Investigation graph ID mismatch.');
      lastRevisionRef.current = graph.revision;
      applyGraph(graph);
      setWorkspaceFitSignal((value) => value + 1);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Investigation could not be loaded.');
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const createInvestigation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanTopic = topic.trim();
    if (!cleanTopic) {
      setCreateError('Enter a research topic.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      // Persistent investigation: research runs in the backend and evidence streams in over /ws.
      const created = await investigationRepository.createInvestigation({ topic: cleanTopic });
      setTopic('');
      await openWorkspace(created);
      setResearchRunning(true);
      setCreateError(null);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Investigation creation failed.');
    } finally {
      setCreating(false);
    }
  };

  const focusTarget = useCallback((target: FocusTarget) => {
    setSelectedIndex(target.i);
    setPinnedFocus(target);
    const node = activeNodes[target.i];
    // Claim view uses the side detail panel; floating cards are for the research-runs view.
    if (node && !showClaims) {
      const cardId = target.j === undefined ? node.id : `${node.id}:${node.branches[target.j]?.id ?? target.j}`;
      setOpenNodeCards((cards) => new Map(cards).set(cardId, { isBranch: target.j !== undefined, spineIndex: target.i, branchIndex: target.j }));
    }
  }, [activeNodes, showClaims]);
  const activeFocus = hoverFocus ?? pinnedFocus;
  const focusNode: SpineNode | undefined = pinnedFocus ? activeNodes[pinnedFocus.i] : undefined;
  const focusBranch: BranchNode | undefined = pinnedFocus?.j !== undefined ? focusNode?.branches[pinnedFocus.j] : undefined;
  const focusTitle = focusBranch?.name ?? focusNode?.name;
  const focusDescription = focusBranch?.info ?? focusNode?.info;
  const sourceUrl = focusBranch?.sourceUrl ?? focusNode?.sourceUrl;
  const sourceName = focusBranch?.sourceDomain ?? (sourceUrl ? safeHostname(sourceUrl) : undefined);
  const focusDate = asDate(focusBranch?.publishedAt ?? focusNode?.timestamp);

  const applyResearchGraph = useCallback((event: { type: 'graph_updated'; graph: InvestigationGraphDto }) => {
    if (!selectedInvestigation || event.graph.investigationId !== selectedInvestigation.id) return;
    if (event.graph.revision < lastRevisionRef.current) return;
    lastRevisionRef.current = event.graph.revision;
    const hadClaims = Boolean(claimGraph);
    const mapped = mapInvestigationGraphDto(event.graph);
    applyGraph(mapped);
    if (mapped.claimNodes?.length && !hadClaims) setGraphMode('claims'); // just built: show the timeline
    setWorkspaceFitSignal((value) => value + 1);
  }, [selectedInvestigation, claimGraph]);

  const continueGraph = async () => {
    if (continuing || !selectedInvestigation || activeNodes.length === 0) return;
    const lastNode = activeNodes[activeNodes.length - 1];
    const context = activeNodes.slice(-3).map((node) => node.name).join('; ');
    setContinuing(true);
    try {
      const result = await sendPrompt({
        prompt: `Continue this investigation after "${lastNode.name}". Research the next significant related event. Context: ${context}`,
        mode: 'new-node', selectedNodeId: lastNode.id, selectedNodeName: lastNode.name, provider: 'auto',
      });
      if (result.node) {
        setWorkspaceNodes((nodes) => {
          const current = nodes ?? [];
          if (current.some((node) => node.id === result.node!.id)) return current;
          const node = result.branches?.length
            ? { ...result.node!, branches: [...result.node!.branches, ...result.branches.filter((branch) => !result.node!.branches.some((existing) => existing.id === branch.id))] }
            : result.node!;
          return [...current, node];
        });
        setSelectedIndex(activeNodes.length);
        setWorkspaceFitSignal((value) => value + 1);
      } else if (result.message) {
        window.alert(result.message);
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not continue research.');
    } finally {
      setContinuing(false);
    }
  };

  return view === 'home' ? (
    <main className="gh-home">
      <div className="gh-home-content">
        <div className="gh-brand"><span className="gh-mark">T</span><span>TRACEWIRE</span></div>
        <section className="gh-create" aria-labelledby="tracewire-headline">
          <svg className="tw-hero-network" viewBox="0 0 380 180" aria-hidden="true" focusable="false">
            <g fill="none" stroke="currentColor" strokeLinecap="round">
              <path d="M18 95 C85 95 98 65 150 65 S242 106 358 55" strokeWidth="1.3" />
              <path d="M76 88 C112 82 126 30 191 24 S260 40 314 16" strokeWidth=".75" />
              <path d="M124 72 C161 91 184 145 248 145 S313 123 358 158" strokeWidth=".8" />
              <path d="M188 76 C219 67 243 62 272 85 S316 110 352 107" strokeWidth=".7" />
            </g>
            <g fill="currentColor">
              <circle cx="18" cy="95" r="3" /><circle cx="150" cy="65" r="4" />
              <circle cx="191" cy="24" r="2" /><circle cx="248" cy="145" r="3" />
              <circle cx="272" cy="85" r="2.5" /><circle cx="358" cy="55" r="3" />
            </g>
          </svg>
          <h1 id="tracewire-headline">Every story evolves. Never lose the evidence.</h1>
          <p className="gh-lede">Turn scattered reporting into a living investigation of connected events, claims, and original sources.</p>
          <form onSubmit={createInvestigation} className="gh-form">
            <label className="gh-topic-label" htmlFor="research-topic">Research topic</label>
            <div className="gh-research-composer">
              <textarea id="research-topic" value={topic}
                onFocus={() => setTopicFocused(true)}
                onBlur={() => setTopicFocused(false)}
                onChange={(e) => { setTopic(e.target.value); setCreateError(null); }}
                placeholder="What would you like to investigate?" rows={3} disabled={creating}
                aria-describedby={createError ? 'topic-error' : undefined} />
              <div className="gh-composer-footer">
                <span className="gh-composer-note">Explore events, claims and original sources</span>
                <button className="gh-primary" type="submit" disabled={creating || !topic.trim()}>
                  {creating ? <><LoaderCircle className="gh-spin" size={15} /> Starting…</> : <>Start investigation <ArrowUpRight size={15} /></>}
                </button>
              </div>
            </div>
            {createError && <p id="topic-error" role="alert" className="gh-error">{createError}</p>}
            {creating && <p className="gh-hint">Starting live research…</p>}
            <div className="tw-example" onMouseEnter={() => setSuggestionHovered(true)}
              onMouseLeave={() => setSuggestionHovered(false)}
              onFocusCapture={() => setSuggestionFocused(true)}
              onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSuggestionFocused(false); }}>
              <span className="gh-example-label">Try an investigation</span>
              <button className="tw-example-button" type="button" disabled={creating}
                onClick={() => { setTopic(topicExamples[exampleOffset]); setCreateError(null); }}>
                <span key={exampleOffset} className="tw-example-text">{topicExamples[exampleOffset]}</span>
                <ArrowUpRight size={15} aria-hidden="true" />
              </button>
              <span className="tw-example-caption">Select to fill the research topic</span>
            </div>
          </form>
        </section>
        <section className="gh-existing" aria-labelledby="public-investigations-title">
          <div className="gh-section-heading"><h2 id="public-investigations-title">Explore investigations</h2></div>
          <p className="gh-library-lede">Open real investigations and explore the evidence already collected.</p>
          {libraryLoading ? <p className="gh-muted">Loading public investigations…</p> :
            libraryError ? <div className="gh-library-unavailable"><p>Public investigations are temporarily unavailable.</p><button type="button" onClick={() => void loadPublicInvestigations()}>Retry</button></div> :
            investigations.length ? <>
              <div id="tw-investigation-list" className={showAllInvestigations ? 'tw-investigation-list is-expanded' : 'tw-investigation-list'}>
                {(showAllInvestigations ? investigations : investigations.slice(0, 2)).map((item) => (
                  <button className="gh-investigation" key={item.id} type="button" onClick={() => void openWorkspace(item)}>
                    <span className="gh-investigation-copy"><strong>{item.title}</strong>{item.description && <span>{item.description}</span>}</span>
                    <span className="gh-investigation-meta">{asDate(item.updatedAt ?? item.createdAt) ?? ''}<ArrowUpRight size={16} /></span>
                  </button>
                ))}
              </div>
              {investigations.length > 2 && <button className="tw-view-all" type="button"
                aria-expanded={showAllInvestigations} aria-controls="tw-investigation-list"
                onClick={() => setShowAllInvestigations((expanded) => !expanded)}>
                {showAllInvestigations ? 'Show fewer investigations' : 'View all investigations'}
                <span aria-hidden="true">{showAllInvestigations ? '−' : '+'}</span>
              </button>}
            </> : <p className="gh-muted">No public investigations available yet.</p>}
        </section>
      </div>
    </main>
  ) : (
    <main className="gh-workspace">
      <header className="gh-topbar">
        <button className="gh-back" onClick={returnHome} aria-label="Back to investigations"><ArrowLeft size={16} /><span className="gh-topbar-brand">TRACEWIRE</span></button>
        <span className="gh-workspace-title" title={selectedInvestigation?.title}>{claimGraph?.entity && <><span className="gh-entity">{claimGraph.entity}</span><span className="gh-crumb-sep">›</span></>}{selectedInvestigation?.title ?? 'Investigation'}</span>
      </header>
      <div className="gh-workspace-body">
        <div className="gh-chat-column">
          {temporaryTimelineContext && <p className="gh-context-notice" role="status">Temporary timeline context; not a saved investigation.</p>}
          {selectedInvestigation && <ResearchChat key={selectedInvestigation.id} investigationId={selectedInvestigation.id} historyAvailable={!temporaryTimelineContext} disabled={workspaceLoading || Boolean(workspaceError) || temporaryTimelineContext} onGraphUpdated={applyResearchGraph} onHighlight={(nodeIds, evidenceIds, roles) => { const roleMap = rolesFrom(roles); setHighlight(nodeIds.length || evidenceIds.length ? { messageId: 'sse', evidenceIds: new Set(evidenceIds), eventIds: new Set(nodeIds), final: true, ...(roleMap && { roles: roleMap }) } : null); }} onShowSources={(evidenceIds, eventIds, roles) => { const roleMap = rolesFrom(roles); setHighlight({ messageId: 'local', evidenceIds: new Set(evidenceIds), eventIds: new Set(eventIds), final: true, ...(roleMap && { roles: roleMap }) }); }} selectedEvent={temporaryTimelineContext || showClaims ? null : activeNodes[selectedIndex] ? { id: activeNodes[selectedIndex].id, title: activeNodes[selectedIndex].name } : null} />}
        </div>
        <section className="gh-graph" aria-label="Evidence graph">
          {workspaceNodes && <TreeCanvasAdapter spine={activeNodes} selectedIndex={selectedIndex} focus={activeFocus} moving={motionOn} fitSignal={workspaceFitSignal} onHoverTarget={setHoverFocus} onSelectTarget={focusTarget} onClearPin={() => setPinnedFocus(null)} onContinue={() => void continueGraph()} isContinuing={continuing} highlight={highlight} liveMarks={liveMarks} links={showClaims ? claimGraph!.links : undefined} laneNote={showClaims && claimGraph!.hiddenPending ? `+${claimGraph!.hiddenPending} more unverified (listed in the chat)` : undefined} onViewChange={setViewTransform} onCanvasReady={setCanvasElement} />}
          <div className="gh-graph-label">{showClaims ? <>CLAIM TIMELINE <span>{activeNodes.filter((n) => n.claimStatus === 'established').length} established · {activeNodes.filter((n) => n.claimStatus === 'pending').length + (claimGraph?.hiddenPending ?? 0)} unverified · {claimGraph!.links.length} links</span></> : <>EVIDENCE GRAPH <span>{activeNodes.length} research runs</span></>}{liveMarks.size > 0 && <span className="tw-live-count"><i className="tw-live-dot" aria-hidden="true" />{liveMarks.size} added by live tracking</span>}</div>
          {claimGraph && <div className="gh-graph-mode" role="group" aria-label="Graph view"><button type="button" className={showClaims ? 'on' : ''} onClick={() => { setGraphMode('claims'); setSelectedIndex(0); setPinnedFocus(null); setWorkspaceFitSignal((v) => v + 1); }}>Claims</button><button type="button" className={!showClaims ? 'on' : ''} onClick={() => { setGraphMode('runs'); setSelectedIndex(0); setPinnedFocus(null); setWorkspaceFitSignal((v) => v + 1); }}>Research runs</button></div>}
          {showClaims && !highlight?.roles && claimGraph?.mode === 'politician' && <div className="gh-claim-legend" aria-label="Claim legend"><span className="lg-source"><i />reports the claim</span><span className="lg-fulfilled"><i />fulfilled</span><span className="lg-contradicts"><i />not fulfilled</span><span className="lg-supports"><i />in progress</span><span className="lg-context"><i />no coloured branch = no follow-up yet</span><span className="lg-context"><i />UNVERIFIED badge = one source so far</span></div>}
          {showClaims && !highlight?.roles && claimGraph?.mode !== 'politician' && <div className="gh-claim-legend" aria-label="Claim legend"><span className="lg-supports"><i />supports</span><span className="lg-contradicts"><i />contradicts</span><span className="lg-context"><i />context</span><span className="lg-pending"><i />unverified lane</span><span className="lg-link"><i />links: solid = stated, dashed = inferred / sequence</span></div>}
          <div className="gh-graph-controls">{selectedInvestigation && !temporaryTimelineContext && <SourceVettingPanel key={`vet-${selectedInvestigation.id}`} investigationId={selectedInvestigation.id} sources={allSources} activity={vettingActivity} disabled={workspaceLoading || Boolean(workspaceError)} />}{selectedInvestigation && !temporaryTimelineContext && <LiveMonitor key={selectedInvestigation.id} investigationId={selectedInvestigation.id} topic={selectedInvestigation.title} activity={monitorActivity} disabled={workspaceLoading || Boolean(workspaceError)} onMonitorsChange={setTrackedMonitors} />}{highlight?.roles && <div className="gh-proof-legend" aria-label="Proof roles"><span className="role-consensus"><i />Shared facts</span><span className="role-angle"><i />Own angle</span><span className="role-dispute"><i />Disputed</span><span className="role-unreadable"><i />Unreadable</span></div>}{highlight && <button type="button" className="gh-highlight-clear" onClick={() => setHighlight(null)} title="Show the whole graph again">{highlight.roles ? `Comparing ${highlight.evidenceIds.size} articles` : highlight.final ? `Showing ${highlight.evidenceIds.size} cited source${highlight.evidenceIds.size === 1 ? '' : 's'}` : 'Citing sources…'} · Clear</button>}<button type="button" onClick={() => setMotionOn((value) => !value)}>{motionOn ? 'Pause motion' : 'Resume motion'}</button><button type="button" onClick={fitGraph}>Fit graph</button></div>
          {liveToast && <div className={`tw-live-toast p-${liveToast.phase}`} role="status" aria-live="polite"><span className="tw-live-toast-tag"><i className="tw-live-dot" aria-hidden="true" />LIVE</span><span>{liveToast.message}{liveToast.url && <> · <a href={liveToast.url} target="_blank" rel="noopener noreferrer" title={liveToast.url}>{siteHost(liveToast.url)}</a></>}</span><button type="button" aria-label="Dismiss live update" onClick={() => setLiveToast(null)}>×</button></div>}
          {trackedMonitors.length > 0 && <div className="tw-tracking-strip" aria-label="Websites tracked live"><span className="tw-tracking-tag"><i className="tw-live-dot" aria-hidden="true" />TRACKING</span>{trackedMonitors.map((m) => <a key={m.id} href={m.url} target="_blank" rel="noopener noreferrer" title={`${m.label}\n${m.url}`} className={`s-${m.status}`}>{siteHost(m.url)}</a>)}</div>}
          {vetToast && <div className={`tw-live-toast tw-vet-toast ${vetToast.verdict ? `v-${vetToast.verdict}` : `p-${vetToast.phase}`}`} role="status" aria-live="polite"><span className="tw-live-toast-tag">VETTING</span><span>{vetToast.message}</span><button type="button" aria-label="Dismiss" onClick={() => setVetToast(null)}>×</button></div>}
          {workspaceLoading && <div className="gh-graph-state">Loading investigation graph…</div>}
          {workspaceError && <div className="gh-graph-state"><p>{workspaceError}</p><button onClick={() => selectedInvestigation && void openWorkspace(selectedInvestigation)}>Retry</button></div>}
          {!workspaceLoading && !workspaceError && workspaceNodes?.length === 0 && <div className="gh-graph-state">{researchRunning ? 'Researching… evidence will appear here as it is found.' : 'This investigation has no evidence yet.'}</div>}
          {showClaims && pinnedFocus && focusTitle && <article className="gh-detail" aria-label="Selected evidence">
            <div className="gh-detail-head"><span>{focusBranch ? 'Evidence' : showClaims ? (focusNode?.claimStatus === 'pending' ? 'Unverified claim' : 'Claim') : 'Event'}</span><button aria-label="Close evidence details" onClick={() => setPinnedFocus(null)}>Close</button></div>
            <h3>{focusTitle}</h3>
            {focusDate && <p className="gh-detail-date">{focusDate}</p>}
            {focusDescription && <p className="gh-detail-description">{focusDescription}</p>}
            {(focusBranch?.sourceType || sourceName) && <p className="gh-source-label">{sourceName ?? focusBranch?.sourceType}</p>}
            {sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer">Open original source <ArrowUpRight size={14} /></a>}
            {focusBranch?.sourceUrl && selectedInvestigation && <VettingCard vetting={focusBranch.vetting} screening={screeningIds.has(focusBranch.id)} onScreen={() => void screenSource(selectedInvestigation.id, focusBranch.id)} />}
            {showClaims && focusBranch && focusNode && <button type="button" className="gh-detail-back" onClick={() => setPinnedFocus({ i: pinnedFocus.i })}>← Claim: {focusNode.name}</button>}
            {showClaims && !focusBranch && focusNode && <div className="gh-detail-children">
              <p className="gh-detail-sub">{focusNode.branches.length ? `${focusNode.branches.length} source${focusNode.branches.length === 1 ? '' : 's'} (child nodes)` : 'No sources attached yet.'}</p>
              <ul>{focusNode.branches.map((b, j) => <li key={b.id}><button type="button" className={`rel-${b.outcomeReport ? 'outcome' : b.sourceReport ? 'source' : 'evidence'} stance-${b.stance ?? 'context'}`} onClick={() => setPinnedFocus({ i: pinnedFocus.i, j })}>
                <span className="gh-rel">{b.relation ?? b.stance}</span>
                <strong>{b.name}</strong>
                <span className="gh-detail-meta">{[b.sourceDomain, asDate(b.publishedAt)].filter(Boolean).join(' · ')}</span>
              </button></li>)}</ul>
            </div>}
          </article>}
          {workspaceNodes && !showClaims && <SpineNav spine={activeNodes} selectedIndex={selectedIndex} onHoverNode={setHoverFocus} onSelectNode={(index) => focusTarget({ i: index })} />}
          {/* Floating node cards */}
          {workspaceNodes && !showClaims && Array.from(openNodeCards.entries()).map(([nodeId, cardInfo]) => {
            const spineIdx = cardInfo.spineIndex;
            const node = activeNodes[spineIdx];
            if (!node) return null;
            const isBranch = cardInfo.isBranch;
            const branchIndex = cardInfo.branchIndex;
            const targetNode = isBranch && branchIndex !== undefined ? node.branches[branchIndex] : node;
            if (!targetNode) return null;
            const worldPos = isBranch && branchIndex !== undefined
              ? generateBranchGeometry(spineIdx * SPINE_GAP, branchIndex % 2 ? 1 : -1, Math.floor(branchIndex / 2), node.branches[branchIndex].seed, '#75c4c8').tip
              : { x: spineIdx * SPINE_GAP, y: 0 };
            const branchCardKey = nodeId;
            const savedOffset = cardOffsets.current.get(branchCardKey);
            const nodeRef = { current: canvasElement };
            return (
              <NodeCard
                key={`card-${nodeId}-${isBranch ? 'b' + branchIndex : 's'}`}
                node={targetNode}
                isBranch={isBranch}
                worldPos={worldPos}
                view={viewTransform}
                svgRef={nodeRef}
                offset={savedOffset}
                revision={cardRevision}
                onClose={() => { setPinnedFocus({ i: cardInfo.spineIndex, ...(branchIndex === undefined ? {} : { j: branchIndex }) }); }}
                onDragEnd={(_id, offset) => { cardOffsets.current.set(branchCardKey, offset); setCardRevision((n) => n + 1); }}
                cardKey={`${nodeId}-${isBranch ? 'b' + branchIndex : 's'}`}
                {...(isBranch && selectedInvestigation ? { onScreen: () => void screenSource(selectedInvestigation.id, targetNode.id), screening: screeningIds.has(targetNode.id) } : {})}
              />
            );
          })}
        </section>
      </div>
    </main>
  );
}
