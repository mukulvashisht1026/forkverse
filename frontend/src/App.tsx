import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, ArrowUpRight, LoaderCircle } from 'lucide-react';
import type { FocusTarget, SpineNode, BranchNode } from './types/tree';
import { useLiveTimeline } from './hooks/useLiveTimeline';
import { TreeCanvasAdapter } from './components/investigationTree/TreeCanvasAdapter';
import './components/investigationTree/treeCanvas.css';
import { SpineNav } from './components/SpineNav';
import { investigationRepository, watchInvestigation, type Investigation, type InvestigationHighlight } from './services/investigations';
import { ResearchChat } from './components/ResearchChat';
import type { InvestigationGraphDto } from '../../contracts/investigations';
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
  const lastRevisionRef = useRef(0);

  /** Open node cards: map of nodeId -> { isBranch: boolean, branchIndex?: number } */
  const [openNodeCards, setOpenNodeCards] = useState<Map<string, { isBranch: boolean; spineIndex: number; branchIndex?: number }>>(new Map());
  const [viewTransform, setViewTransform] = useState({ k: 1, x: 0, y: 0 });
  const [canvasElement, setCanvasElement] = useState<SVGSVGElement | null>(null);
  const cardOffsets = useRef(new Map<string, { x: number; y: number }>());
  const [cardRevision, setCardRevision] = useState(0);

  const activeNodes = workspaceNodes ?? [];
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
    void loadPublicInvestigations();
  };

  /** Re-fetch the open investigation's graph; ignores responses older than what is shown. */
  const refreshGraph = useCallback(async (investigationId: string) => {
    try {
      const graph = await investigationRepository.getInvestigationGraph(investigationId);
      if (graph.investigationId !== investigationId || graph.revision < lastRevisionRef.current) return;
      lastRevisionRef.current = graph.revision;
      setWorkspaceNodes(graph.nodes);
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
        schedule();
      },
      onResync: schedule,
      onHighlight: (next) => setHighlight(next.evidenceIds.size || next.eventIds.size ? next : null),
    });
    return () => { stop(); window.clearTimeout(timer); };
  }, [liveInvestigationId, refreshGraph]);

  const openWorkspace = async (investigation: Investigation) => {
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
      setWorkspaceNodes(graph.nodes);
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
    if (node) {
      const cardId = target.j === undefined ? node.id : `${node.id}:${node.branches[target.j]?.id ?? target.j}`;
      setOpenNodeCards((cards) => new Map(cards).set(cardId, { isBranch: target.j !== undefined, spineIndex: target.i, branchIndex: target.j }));
    }
  }, [activeNodes]);
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
    const nodes = investigationEventsToSpineNodes(event.graph.events);
    setWorkspaceNodes(nodes);
    setWorkspaceFitSignal((value) => value + 1);
  }, [selectedInvestigation]);

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
        <span className="gh-workspace-title" title={selectedInvestigation?.title}>{selectedInvestigation?.title ?? 'Investigation'}</span>
      </header>
      <div className="gh-workspace-body">
        <div className="gh-chat-column">
          {temporaryTimelineContext && <p className="gh-context-notice" role="status">Temporary timeline context; not a saved investigation.</p>}
          {selectedInvestigation && <ResearchChat key={selectedInvestigation.id} investigationId={selectedInvestigation.id} historyAvailable={!temporaryTimelineContext} disabled={workspaceLoading || Boolean(workspaceError) || temporaryTimelineContext} onGraphUpdated={applyResearchGraph} onShowSources={(evidenceIds, eventIds) => setHighlight({ messageId: 'local', evidenceIds: new Set(evidenceIds), eventIds: new Set(eventIds), final: true })} />}
        </div>
        <section className="gh-graph" aria-label="Evidence graph">
{workspaceNodes && <TreeCanvasAdapter spine={activeNodes} selectedIndex={selectedIndex} focus={activeFocus} moving={motionOn} fitSignal={workspaceFitSignal} onHoverTarget={setHoverFocus} onSelectTarget={focusTarget} onClearPin={() => setPinnedFocus(null)} onContinue={() => void continueGraph()} isContinuing={continuing} highlight={highlight} onViewChange={setViewTransform} onCanvasReady={setCanvasElement} />}
<div className="gh-graph-label">Evidence graph <span>{activeNodes.length} {activeNodes.length === 1 ? 'event' : 'events'}</span></div>
<div className="gh-graph-controls">{highlight && <button type="button" className="gh-highlight-clear" onClick={() => setHighlight(null)} title="Show the whole graph again">{highlight.final ? `Showing ${highlight.evidenceIds.size} cited source${highlight.evidenceIds.size === 1 ? '' : 's'}` : 'Citing sources…'} · Clear</button>}<button type="button" onClick={() => setMotionOn((value) => !value)}>{motionOn ? 'Pause motion' : 'Resume motion'}</button><button type="button" onClick={fitGraph}>Fit graph</button></div>
          {workspaceLoading && <div className="gh-graph-state">Loading investigation graph…</div>}
          {workspaceError && <div className="gh-graph-state"><p>{workspaceError}</p><button onClick={() => selectedInvestigation && void openWorkspace(selectedInvestigation)}>Retry</button></div>}
          {!workspaceLoading && !workspaceError && workspaceNodes?.length === 0 && <div className="gh-graph-state">{researchRunning ? 'Researching… evidence will appear here as it is found.' : 'This investigation has no evidence yet.'}</div>}

          {workspaceNodes && <SpineNav spine={activeNodes} selectedIndex={selectedIndex} onHoverNode={setHoverFocus} onSelectNode={(index) => focusTarget({ i: index })} />}
          {/* Floating node cards */}
          {workspaceNodes && Array.from(openNodeCards.entries()).map(([nodeId, cardInfo]) => {
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
              />
            );
          })}
        </section>
      </div>
    </main>
  );
}
