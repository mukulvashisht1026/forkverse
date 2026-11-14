import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, ArrowUpRight, LoaderCircle } from 'lucide-react';
import type { FocusTarget, SpineNode, BranchNode } from './types/tree';
import { useLiveTimeline } from './hooks/useLiveTimeline';
import { TreeCanvasAdapter } from './components/investigationTree/TreeCanvasAdapter';
import './components/investigationTree/treeCanvas.css';
import { SpineNav } from './components/SpineNav';
import { investigationRepository, type Investigation } from './services/investigations';
import { ResearchChat } from './components/ResearchChat';
import type { InvestigationGraphDto } from '../../contracts/investigations';
import { investigationEventsToSpineNodes } from './services/investigationGraphAdapter';
import { temporaryWorkspaceFromTimelineNode } from './services/createWorkspace';

function asDate(value?: string) {
  if (!value || value === 'Live update' || value === 'Live scrape') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
}

export default function App() {
  const [fitSignal, setFitSignal] = useState(0);
  const fitGraph = useCallback(() => setFitSignal((count) => count + 1), []);
  const { scrapeMainNode, sendPrompt, nodes: timelineNodes } = useLiveTimeline(fitGraph);
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

  const activeNodes = workspaceNodes ?? [];
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
  };

  const openWorkspace = async (investigation: Investigation) => {
    setSelectedInvestigation(investigation);
    setTemporaryTimelineContext(false);
    setView('workspace');
    setWorkspaceNodes(null);
    setWorkspaceError(null);
    setWorkspaceLoading(true);
    setPinnedFocus(null);
    try {
      const graph = await investigationRepository.getInvestigationGraph(investigation.id);
      if (graph.investigationId !== investigation.id) throw new Error('Investigation graph ID mismatch.');
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
      const result = await scrapeMainNode({ query: cleanTopic, provider: 'auto' });
      const workspace = temporaryWorkspaceFromTimelineNode(result.node);
      setSelectedInvestigation(workspace.investigation);
      setTemporaryTimelineContext(workspace.temporary);
      setWorkspaceNodes(workspace.nodes);
      setWorkspaceFitSignal((value) => value + 1);
      setView('workspace');
      setCreateError(null);
      if (result.notice) window.setTimeout(() => window.alert(result.notice!), 0);
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
          <div className="gh-section-heading"><h2>Explore timeline</h2></div>
          <p className="gh-library-lede">Browse current global timeline nodes; these are not persisted investigations yet.</p>
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
        <span className="gh-workspace-title" title={selectedInvestigation?.title}>{selectedInvestigation?.title ?? 'Investigation'}</span>
      </header>
      <div className="gh-workspace-body">
        {temporaryTimelineContext && <p className="gh-hint" role="status">This view uses a global timeline node as temporary context, not a persisted investigation. Investigation-scoped chat may be unavailable until backend supports durable investigation IDs.</p>}
        {selectedInvestigation && <ResearchChat key={selectedInvestigation.id} investigationId={selectedInvestigation.id} disabled={workspaceLoading || Boolean(workspaceError)} onGraphUpdated={applyResearchGraph} />}
        <section className="gh-graph" aria-label="Evidence graph">
          {workspaceNodes && <TreeCanvasAdapter spine={activeNodes} selectedIndex={selectedIndex} focus={activeFocus} moving={motionOn} fitSignal={workspaceFitSignal} onHoverTarget={setHoverFocus} onSelectTarget={focusTarget} onClearPin={() => setPinnedFocus(null)} onContinue={() => void continueGraph()} isContinuing={continuing} />}
          <div className="gh-graph-label">EVIDENCE GRAPH <span>{activeNodes.length} events</span></div>
          <div className="gh-graph-controls"><button type="button" onClick={() => setMotionOn((value) => !value)}>{motionOn ? 'Pause motion' : 'Resume motion'}</button><button type="button" onClick={fitGraph}>Fit graph</button></div>
          {workspaceLoading && <div className="gh-graph-state">Loading investigation graph…</div>}
          {workspaceError && <div className="gh-graph-state"><p>{workspaceError}</p><button onClick={() => selectedInvestigation && void openWorkspace(selectedInvestigation)}>Retry</button></div>}
          {!workspaceLoading && !workspaceError && workspaceNodes?.length === 0 && <div className="gh-graph-state">This investigation has no evidence yet.</div>}
          {pinnedFocus && focusTitle && <article className="gh-detail" aria-label="Selected evidence">
            <div className="gh-detail-head"><span>{focusBranch ? 'Evidence' : 'Event'}</span><button aria-label="Close evidence details" onClick={() => setPinnedFocus(null)}>Close</button></div>
            <h3>{focusTitle}</h3>
            {focusDate && <p className="gh-detail-date">{focusDate}</p>}
            {focusDescription && <p className="gh-detail-description">{focusDescription}</p>}
            {(focusBranch?.sourceType || sourceName) && <p className="gh-source-label">{sourceName ?? focusBranch?.sourceType}</p>}
            {sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer">Open original source <ArrowUpRight size={14} /></a>}
          </article>}
          {workspaceNodes && <SpineNav spine={activeNodes} selectedIndex={selectedIndex} onHoverNode={setHoverFocus} onSelectNode={(index) => { setSelectedIndex(index); setPinnedFocus({ i: index }); }} />}
        </section>
      </div>
    </main>
  );
}
