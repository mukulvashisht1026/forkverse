import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, ArrowUpRight, LoaderCircle } from 'lucide-react';
import type { FocusTarget, SpineNode, BranchNode } from './types/tree';
import { useLiveTimeline } from './hooks/useLiveTimeline';
import { TreeCanvasAdapter } from './components/investigationTree/TreeCanvasAdapter';
import './components/investigationTree/treeCanvas.css';
import { SpineNav } from './components/SpineNav';
import { investigationRepository, rolesFrom, watchInvestigation, type Investigation, type InvestigationHighlight } from './services/investigations';
import { ResearchChat } from './components/ResearchChat';
import type { InvestigationGraphDto } from '../../contracts/investigations';
import { mapInvestigationGraphDto, type ClaimLink, type InvestigationGraph } from './services/investigations';

/** Claim view: pending claims shown on the unverified lane (the rest are counted). */
const PENDING_SHOWN = 8;

function asDate(value?: string) {
  if (!value || value === 'Live update' || value === 'Live scrape') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
}

export default function App() {
  const [fitSignal, setFitSignal] = useState(0);
  const fitGraph = useCallback(() => setFitSignal((count) => count + 1), []);
  const { sendPrompt } = useLiveTimeline(fitGraph);
  const [view, setView] = useState<'home' | 'workspace'>('home');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hoverFocus, setHoverFocus] = useState<FocusTarget | null>(null);
  const [pinnedFocus, setPinnedFocus] = useState<FocusTarget | null>(null);
  const [motionOn, setMotionOn] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [topic, setTopic] = useState('');
  const [exampleOffset, setExampleOffset] = useState(0);
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
  const [workspaceFitSignal, setWorkspaceFitSignal] = useState(0);
  const [continuing, setContinuing] = useState(false);
  /** Graph items cited by the current research answer (pushed over /ws); null = no highlight. */
  const [highlight, setHighlight] = useState<InvestigationHighlight | null>(null);
  const [researchRunning, setResearchRunning] = useState(false);
  const lastRevisionRef = useRef(0);

  /** Claim timeline (Entity -> Topic -> Claims -> Evidence), present once claims were built. */
  const [claimGraph, setClaimGraph] = useState<{ nodes: SpineNode[]; links: ClaimLink[]; hiddenPending: number; entity?: string } | null>(null);
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
    const nodes = graph.claimNodes.filter((n) => n.claimStatus !== 'pending' || shown.has(n.id));
    setClaimGraph({ nodes, links: links.filter((l) => nodes.some((n) => n.id === l.from) && nodes.some((n) => n.id === l.to)), hiddenPending: pending.length - shown.size, ...(graph.entity ? { entity: graph.entity } : {}) });
  };
  const topicExamples = [
    'US tariffs and international trade policy',
    'European AI regulation and its global impact',
    'Global lithium supply chains',
    'The international dispute over Arctic shipping routes',
    'How central banks are responding to inflation',
    'A public figure’s documented political statements',
  ];
  const visibleExamples = Array.from({ length: 3 }, (_, index) => topicExamples[(exampleOffset + index) % topicExamples.length]);

  useEffect(() => {
    if (topic || creating) return;
    const timer = window.setInterval(() => setExampleOffset((offset) => (offset + 1) % topicExamples.length), 7000);
    return () => window.clearInterval(timer);
  }, [topic, creating, topicExamples.length]);

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
    setPinnedFocus((current) => current?.i === target.i && current.j === target.j ? null : target);
  }, []);
  const activeFocus = hoverFocus ?? pinnedFocus;
  const focusNode: SpineNode | undefined = pinnedFocus ? activeNodes[pinnedFocus.i] : undefined;
  const focusBranch: BranchNode | undefined = pinnedFocus?.j !== undefined ? focusNode?.branches[pinnedFocus.j] : undefined;
  const focusTitle = focusBranch?.name ?? focusNode?.name;
  const focusDescription = focusBranch?.info ?? focusNode?.info;
  const sourceUrl = focusBranch?.sourceUrl ?? focusNode?.sourceUrl;
  const sourceName = focusBranch?.sourceDomain ?? (sourceUrl ? new URL(sourceUrl).hostname : undefined);
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
        <div className="gh-brand"><span className="gh-mark">G</span><span>GHOSTLINE</span></div>
        <section className="gh-create">
          <h1>What would you like to investigate?</h1>
          <p className="gh-lede">Explore a topic through connected events and evidence.</p>
          <form onSubmit={createInvestigation} className="gh-form">
            <label className="gh-topic-label" htmlFor="research-topic">Research topic</label>
            <div className="gh-research-composer">
              <textarea id="research-topic" value={topic} onChange={(e) => { setTopic(e.target.value); setCreateError(null); }} placeholder="e.g. US tariffs and international trade policy" rows={3} disabled={creating} aria-describedby={createError ? 'topic-error' : undefined} />
              <div className="gh-composer-footer">
                <span className="gh-composer-note">Open-ended research · sources and events</span>
                <button className="gh-primary" type="submit" disabled={creating || !topic.trim()}>{creating ? <><LoaderCircle className="gh-spin" size={15} /> Starting…</> : <>Start investigation <ArrowUpRight size={15} /></>}</button>
              </div>
            </div>
            {createError && <p id="topic-error" role="alert" className="gh-error">{createError}</p>}
            {creating && <p className="gh-hint">Starting live research…</p>}
            <div className="gh-example-picker" aria-label="Topic examples">
              <span className="gh-example-label">For example</span>
              <div className="gh-example-list">
                {visibleExamples.map((example) => <button className="gh-example-chip" type="button" key={example} disabled={creating} onClick={() => { setTopic(example); setCreateError(null); }} title="Fill research topic">
                  <span>{example}</span>
                </button>)}
              </div>
            </div>
          </form>
        </section>
        <section className="gh-existing">
          <div className="gh-section-heading"><h2>Explore investigations</h2></div>
          <p className="gh-library-lede">Browse existing public research.</p>
          {libraryLoading ? <p className="gh-muted">Loading public investigations…</p> : libraryError ? <div className="gh-library-unavailable"><p>Public investigations are temporarily unavailable.</p><button type="button" onClick={() => void loadPublicInvestigations()}>Retry</button></div> : investigations.length ? investigations.map((item) => (
            <button className="gh-investigation" key={item.id} onClick={() => void openWorkspace(item)}>
              <span className="gh-investigation-copy"><strong>{item.title}</strong>{item.description && <span>{item.description}</span>}</span>
              <span className="gh-investigation-meta">{asDate(item.updatedAt ?? item.createdAt) ?? ''}<ArrowUpRight size={16} /></span>
            </button>
          )) : <p className="gh-muted">No public investigations available yet.</p>}
        </section>
      </div>
    </main>
  ) : (
    <main className="gh-workspace">
      <header className="gh-topbar">
        <button className="gh-back" onClick={returnHome} aria-label="Back to investigations"><ArrowLeft size={16} /><span>Ghostline</span></button>
        <span className="gh-workspace-title" title={selectedInvestigation?.title}>{claimGraph?.entity && <><span className="gh-entity">{claimGraph.entity}</span><span className="gh-crumb-sep">›</span></>}{selectedInvestigation?.title ?? 'Investigation'}</span>
      </header>
      <div className="gh-workspace-body">
        <div className="gh-chat-column">
          {temporaryTimelineContext && <p className="gh-context-notice" role="status">Temporary timeline context; not a saved investigation.</p>}
          {selectedInvestigation && <ResearchChat key={selectedInvestigation.id} investigationId={selectedInvestigation.id} historyAvailable={!temporaryTimelineContext} disabled={workspaceLoading || Boolean(workspaceError) || temporaryTimelineContext} onGraphUpdated={applyResearchGraph} onHighlight={(nodeIds, evidenceIds, roles) => { const roleMap = rolesFrom(roles); setHighlight(nodeIds.length || evidenceIds.length ? { messageId: 'sse', evidenceIds: new Set(evidenceIds), eventIds: new Set(nodeIds), final: true, ...(roleMap && { roles: roleMap }) } : null); }} onShowSources={(evidenceIds, eventIds, roles) => { const roleMap = rolesFrom(roles); setHighlight({ messageId: 'local', evidenceIds: new Set(evidenceIds), eventIds: new Set(eventIds), final: true, ...(roleMap && { roles: roleMap }) }); }} selectedEvent={temporaryTimelineContext || showClaims ? null : activeNodes[selectedIndex] ? { id: activeNodes[selectedIndex].id, title: activeNodes[selectedIndex].name } : null} />}
        </div>
        <section className="gh-graph" aria-label="Evidence graph">
          {workspaceNodes && <TreeCanvasAdapter spine={activeNodes} selectedIndex={selectedIndex} focus={activeFocus} moving={motionOn} fitSignal={workspaceFitSignal} onHoverTarget={setHoverFocus} onSelectTarget={focusTarget} onClearPin={() => setPinnedFocus(null)} onContinue={() => void continueGraph()} isContinuing={continuing} highlight={highlight} links={showClaims ? claimGraph!.links : undefined} laneNote={showClaims && claimGraph!.hiddenPending ? `+${claimGraph!.hiddenPending} more unverified (listed in the chat)` : undefined} />}
          <div className="gh-graph-label">{showClaims ? <>CLAIM TIMELINE <span>{activeNodes.filter((n) => n.claimStatus === 'established').length} established · {activeNodes.filter((n) => n.claimStatus === 'pending').length + (claimGraph?.hiddenPending ?? 0)} unverified · {claimGraph!.links.length} links</span></> : <>EVIDENCE GRAPH <span>{activeNodes.length} research runs</span></>}</div>
          {claimGraph && <div className="gh-graph-mode" role="group" aria-label="Graph view"><button type="button" className={showClaims ? 'on' : ''} onClick={() => { setGraphMode('claims'); setSelectedIndex(0); setPinnedFocus(null); setWorkspaceFitSignal((v) => v + 1); }}>Claims</button><button type="button" className={!showClaims ? 'on' : ''} onClick={() => { setGraphMode('runs'); setSelectedIndex(0); setPinnedFocus(null); setWorkspaceFitSignal((v) => v + 1); }}>Research runs</button></div>}
          {showClaims && !highlight?.roles && <div className="gh-claim-legend" aria-label="Claim legend"><span className="lg-supports"><i />supports</span><span className="lg-contradicts"><i />contradicts</span><span className="lg-context"><i />context</span><span className="lg-pending"><i />unverified lane</span><span className="lg-link"><i />links: solid = stated, dashed = inferred / sequence</span></div>}
          <div className="gh-graph-controls">{highlight?.roles && <div className="gh-proof-legend" aria-label="Proof roles"><span className="role-consensus"><i />Shared facts</span><span className="role-angle"><i />Own angle</span><span className="role-dispute"><i />Disputed</span><span className="role-unreadable"><i />Unreadable</span></div>}{highlight && <button type="button" className="gh-highlight-clear" onClick={() => setHighlight(null)} title="Show the whole graph again">{highlight.roles ? `Comparing ${highlight.evidenceIds.size} articles` : highlight.final ? `Showing ${highlight.evidenceIds.size} cited source${highlight.evidenceIds.size === 1 ? '' : 's'}` : 'Citing sources…'} · Clear</button>}<button type="button" onClick={() => setMotionOn((value) => !value)}>{motionOn ? 'Pause motion' : 'Resume motion'}</button><button type="button" onClick={fitGraph}>Fit graph</button></div>
          {workspaceLoading && <div className="gh-graph-state">Loading investigation graph…</div>}
          {workspaceError && <div className="gh-graph-state"><p>{workspaceError}</p><button onClick={() => selectedInvestigation && void openWorkspace(selectedInvestigation)}>Retry</button></div>}
          {!workspaceLoading && !workspaceError && workspaceNodes?.length === 0 && <div className="gh-graph-state">{researchRunning ? 'Researching… evidence will appear here as it is found.' : 'This investigation has no evidence yet.'}</div>}
          {pinnedFocus && focusTitle && <article className="gh-detail" aria-label="Selected evidence">
            <div className="gh-detail-head"><span>{focusBranch ? 'Evidence' : showClaims ? (focusNode?.claimStatus === 'pending' ? 'Unverified claim' : 'Claim') : 'Event'}</span><button aria-label="Close evidence details" onClick={() => setPinnedFocus(null)}>Close</button></div>
            <h3>{focusTitle}</h3>
            {focusDate && <p className="gh-detail-date">{focusDate}</p>}
            {focusDescription && <p className="gh-detail-description">{focusDescription}</p>}
            {(focusBranch?.sourceType || sourceName) && <p className="gh-source-label">{sourceName ?? focusBranch?.sourceType}</p>}
            {sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer">Open original source <ArrowUpRight size={14} /></a>}
          </article>}
          {workspaceNodes && !showClaims && <SpineNav spine={activeNodes} selectedIndex={selectedIndex} onHoverNode={setHoverFocus} onSelectNode={(index) => { setSelectedIndex(index); setPinnedFocus({ i: index }); }} />}
        </section>
      </div>
    </main>
  );
}
