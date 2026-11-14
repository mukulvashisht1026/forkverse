import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, ArrowUpRight, LoaderCircle, Pencil, FolderClosed, Tag } from 'lucide-react';
import type { FocusTarget, SpineNode, BranchNode } from './types/tree';
import { useLiveTimeline } from './hooks/useLiveTimeline';
import { TreeCanvasAdapter } from './components/investigationTree/TreeCanvasAdapter';
import './components/investigationTree/treeCanvas.css';
import { SpineNav } from './components/SpineNav';
import { investigationRepository, watchInvestigation, type Investigation, type InvestigationHighlight } from './services/investigations';
import { isMockInvestigationMode, mockInvestigationRepository } from './services/mockInvestigations';
import { ResearchChat } from './components/ResearchChat';
import { MockResearchChat } from './components/MockResearchChat';
import type { InvestigationGraphDto } from '../../contracts/investigations';
import { investigationEventsToSpineNodes } from './services/investigationGraphAdapter';
import { NodeCard } from './components/NodeCard';
import { SPINE_GAP, generateBranchGeometry } from './components/investigationTree/utils/treeMath';

function HomeTypography() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const touch = window.matchMedia('(pointer: coarse)');
    const home = canvas.parentElement;
    const content = home?.querySelector<HTMLElement>('.gh-home-content');
    if (!home || !content) return;
    let frame = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let glyphs: { x: number; y: number; char: string; dx: number; dy: number; vx: number; vy: number; opacity: number; phase: number; changeAt: number }[] = [];
    let pointer = { x: -10000, y: -10000 };
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,;:!?—–… “” ‘ ’ /()[]{}';
    const resize = () => {
      const rect = home.getBoundingClientRect();
      width = rect.width; height = rect.height; dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = width * dpr; canvas.height = height * dpr;
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const step = width < 600 ? 15 : 13;
      glyphs = [];
      const protectedRect = content.getBoundingClientRect();
      const fieldTop = Math.max(0, protectedRect.top - rect.top - 150);
      for (let y = fieldTop; y < height + 20; y += 26) for (let x = 10; x < width; x += step) {
        const px = rect.left + x, py = rect.top + y;
        if (px >= protectedRect.left - 24 && px <= protectedRect.right + 24 && py >= protectedRect.top - 24 && py <= protectedRect.bottom + 24) continue;
        // Fade only toward side edges; keep visible glyphs above and below protected content.
        const sideDistance = px < protectedRect.left - 24 ? protectedRect.left - 24 - px : px > protectedRect.right + 24 ? px - protectedRect.right - 24 : 0;
        const sideFade = Math.min(1, sideDistance / 140);
        glyphs.push({ x, y, char: chars[Math.floor(Math.random() * chars.length)], dx: 0, dy: 0, vx: 0, vy: 0, opacity: .12 * sideFade, phase: Math.floor(Math.random() * 75), changeAt: 20 + Math.floor(Math.random() * 75) });
      }
    };
    const move = (event: PointerEvent) => { pointer = { x: event.clientX, y: event.clientY }; };
    const leave = () => { pointer = { x: -10000, y: -10000 }; };
    const draw = () => {
      context.clearRect(0, 0, width, height);
      context.font = '11px Georgia, "Times New Roman", serif';
      context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = 'rgba(55, 53, 48, .14)';
      const rect = home.getBoundingClientRect();
      for (const g of glyphs) {
        if (!reduced.matches && !touch.matches) {
          const x = rect.left + g.x + g.dx, y = rect.top + g.y + g.dy;
          const vx = x - pointer.x, vy = y - pointer.y, distance = Math.hypot(vx, vy);
          if (distance < 115 && distance > 0) { const force = (1 - distance / 115) * 2.1; g.vx += vx / distance * force; g.vy += vy / distance * force; }
        }
        g.vx *= .84; g.vy *= .84; g.dx = (g.dx + g.vx) * .88; g.dy = (g.dy + g.vy) * .88;
        const x = g.x + g.dx, y = g.y + g.dy;
        if (!reduced.matches && !touch.matches && (pointer.x - rect.left - x) ** 2 + (pointer.y - rect.top - y) ** 2 < 10000) g.char = chars[Math.floor(Math.random() * chars.length)];
        if (!reduced.matches && !touch.matches) {
          g.phase += 1;
          if (g.phase >= g.changeAt) {
            g.char = chars[Math.floor(Math.random() * chars.length)];
            g.phase = 0;
            g.changeAt = 20 + Math.floor(Math.random() * 75);
          }
        }
        context.globalAlpha = g.opacity / .12;
        context.fillText(g.char, x, y);
      }
      context.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(resize); observer.observe(home); observer.observe(content);
    resize();
    if (!reduced.matches && !touch.matches) { home.addEventListener('pointermove', move); home.addEventListener('pointerleave', leave); }
    const visibility = () => { cancelAnimationFrame(frame); if (!document.hidden) frame = requestAnimationFrame(draw); };
    document.addEventListener('visibilitychange', visibility);
    if (!document.hidden) frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); home.removeEventListener('pointermove', move); home.removeEventListener('pointerleave', leave); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  return <canvas ref={canvasRef} className="tw-typography-bg" aria-hidden="true" />;
}

function safeHostname(value: string): string | undefined {
  try { return new URL(value).hostname; } catch { return undefined; }
}

function asDate(value?: string) {
  if (!value || value === 'Live update' || value === 'Live scrape') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
}

export default function App() {
  const mockMode = isMockInvestigationMode();
  const repository = mockMode ? mockInvestigationRepository : investigationRepository;
const [workspaceFitSignal, setWorkspaceFitSignal] = useState(0);
const fitGraph = useCallback(() => setWorkspaceFitSignal((count) => count + 1), []);
const { sendPrompt } = useLiveTimeline(fitGraph);
  const [view, setView] = useState<'home' | 'workspace'>('home');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [activeFolder, setActiveFolder] = useState('All investigations');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const graphFolders = ['All investigations', 'Policy & regulation', 'Climate & resources', 'Markets & economy'];
  const graphTags = ['Policy', 'Climate', 'Technology', 'Markets'];
  const tagsFor = (item: Investigation) => {
    const title = `${item.title} ${item.description ?? ''}`.toLowerCase();
    return graphTags.filter((tag) => title.includes(tag.toLowerCase()) || tag === 'Technology' && /ai|tech/.test(title));
  };
  const folderFor = (item: Investigation) => {
    const tags = tagsFor(item);
    return tags.includes('Climate') ? 'Climate & resources' : tags.includes('Markets') ? 'Markets & economy' : 'Policy & regulation';
  };
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
      setInvestigations(await repository.listPublicInvestigations());
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : 'Public investigations could not be loaded.');
    } finally {
      setLibraryLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    const onPopState = () => {
      const match = window.location.pathname.match(/^\/([^/]+)\/?$/);
      if (!match) { setView('home'); return; }
      void repository.getInvestigation(decodeURIComponent(match[1])).then((item) => openWorkspace(item, false));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  // URL navigation shares the same public lookup as initial load.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);

  useEffect(() => { void loadPublicInvestigations(); }, [loadPublicInvestigations]);

  useEffect(() => {
    const match = window.location.pathname.match(/^\/([^/]+)\/?$/);
    if (!match || match[1] === 'api') return;
    void repository.getInvestigation(decodeURIComponent(match[1])).then((investigation) => openWorkspace(investigation, false)).catch(() => {
      window.history.replaceState(null, '', '/');
    });
  // Intentionally only resolve initial public URL once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);

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

  const saveTitle = async () => {
    if (!selectedInvestigation) return;
    const title = titleDraft.trim();
    if (!title || title === selectedInvestigation.title) { setEditingTitle(false); return; }
    try {
      const updated = await repository.renameInvestigation(selectedInvestigation.id, title);
      setSelectedInvestigation(updated);
      setInvestigations((items) => items.map((item) => item.id === updated.id ? updated : item));
      setEditingTitle(false);
    } catch (error) { setWorkspaceError(error instanceof Error ? error.message : 'Could not rename graph.'); }
  };

  const returnHome = () => {
    window.history.pushState(null, '', '/');
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
      const graph = await repository.getInvestigationGraph(investigationId);
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
    if (!liveInvestigationId || mockMode) return;
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

  const openWorkspace = async (investigation: Investigation, updateUrl = true) => {
    if (updateUrl) window.history.pushState(null, '', `/${encodeURIComponent(investigation.id)}`);
    setEditingTitle(false);
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
      const graph = await repository.getInvestigationGraph(investigation.id);
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
      const created = await repository.createInvestigation({ topic: cleanTopic });
      setTopic('');
      await openWorkspace(created);
      setResearchRunning(!mockMode);
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
      if (mockMode) {
        const graph = await repository.extendInvestigation(selectedInvestigation.id, { topic: `Next development after ${lastNode.name}` });
        setWorkspaceNodes(graph.nodes);
        setSelectedIndex(graph.nodes.length - 1);
        setWorkspaceFitSignal((value) => value + 1);
        return;
      }
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
      <HomeTypography />
      <div className="gh-home-content">
        <div className="gh-brand"><span className="gh-mark">T</span><span>TRACEWIRE</span></div>
        <section className="gh-create" aria-labelledby="tracewire-headline">
          <svg className="tw-hero-network" viewBox="0 0 380 180" aria-hidden="true" focusable="false">
            <defs><linearGradient id="tw-line-wave"><stop offset="0" stopColor="#d1a900" stopOpacity=".12" /><stop offset=".5" stopColor="#d1a900" stopOpacity=".65" /><stop offset="1" stopColor="#d1a900" stopOpacity=".12" /></linearGradient></defs>
            <g className="tw-network-lines" fill="none" stroke="url(#tw-line-wave)" strokeLinecap="round">
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
        {!libraryError && <section className="gh-existing" aria-labelledby="public-investigations-title">
          <div className="gh-section-heading"><h2 id="public-investigations-title">Explore investigations</h2></div>
          <p className="gh-library-lede">Open real investigations and explore the evidence already collected.</p>
          {libraryLoading ? <p className="gh-muted">Loading public investigations…</p> : investigations.length ? <>
            <nav className="gh-folder-nav" aria-label="Investigation folders">{graphFolders.map((folder) => <button type="button" key={folder} className={activeFolder === folder ? 'is-active' : ''} onClick={() => setActiveFolder(folder)}><FolderClosed size={14} />{folder}</button>)}</nav>
            {activeFolder === 'All investigations' ? <div className="gh-tag-filter" aria-label="Filter by tag"><button type="button" className={!activeTag ? 'is-active' : ''} onClick={() => setActiveTag(null)}>All tags</button>{graphTags.map((tag) => <button type="button" key={tag} className={activeTag === tag ? 'is-active' : ''} onClick={() => setActiveTag(activeTag === tag ? null : tag)}><Tag size={12} />{tag}</button>)}</div> : null}
            {(activeFolder === 'All investigations' ? investigations : investigations.filter((item) => folderFor(item) === activeFolder)).filter((item) => !activeTag || tagsFor(item).includes(activeTag)).slice(0, showAllInvestigations ? undefined : 6).map((item) => (
              <button className="gh-investigation" key={item.id} type="button" onClick={() => void openWorkspace(item)}>
                <span className="gh-investigation-copy"><strong>{item.title}</strong>{item.description && <span>{item.description}</span>}<span className="gh-item-tags">{(tagsFor(item).length ? tagsFor(item) : ['Research']).map((tag) => <i key={tag}>{tag}</i>)}</span></span>
                <span className="gh-investigation-meta">{asDate(item.updatedAt ?? item.createdAt) ?? ''}<ArrowUpRight size={16} /></span>
              </button>))}
            {investigations.length > 6 && <button className="tw-view-all" type="button" aria-expanded={showAllInvestigations} onClick={() => setShowAllInvestigations((expanded) => !expanded)}>{showAllInvestigations ? 'Show fewer investigations' : 'View all investigations'}</button>}
          </> : <p className="gh-muted">No public investigations available yet.</p>}
        </section>}
      </div>
    </main>
  ) : (
    <main className="gh-workspace">
      <header className="gh-topbar">
<button className="gh-back" onClick={returnHome} aria-label="Back to investigations"><ArrowLeft size={16} /><span className="gh-topbar-brand">TRACEWIRE</span></button>
        <div className="gh-title-edit">{editingTitle ? <input autoFocus maxLength={120} value={titleDraft} aria-label="Graph title" onChange={(event) => setTitleDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { setTitleDraft(selectedInvestigation?.title ?? ''); event.currentTarget.blur(); } }} onBlur={() => void saveTitle()} /> : <><span className="gh-workspace-title" title={selectedInvestigation?.title}>{selectedInvestigation?.title ?? 'Investigation'}</span><button type="button" className="gh-title-edit-button" aria-label="Edit graph title" onClick={() => { setTitleDraft(selectedInvestigation?.title ?? ''); setEditingTitle(true); }}><Pencil size={14} /></button></>}</div>
      </header>
      <div className="gh-workspace-body">
        <div className="gh-chat-column">
          {temporaryTimelineContext && <p className="gh-context-notice" role="status">Temporary timeline context; not a saved investigation.</p>}
          {selectedInvestigation && (mockMode
            ? <MockResearchChat key={selectedInvestigation.id} onAddEvent={async (prompt) => { const graph = await repository.extendInvestigation(selectedInvestigation.id, { topic: prompt }); setWorkspaceNodes(graph.nodes); setWorkspaceFitSignal((value) => value + 1); }} />
            : <ResearchChat key={selectedInvestigation.id} investigationId={selectedInvestigation.id} historyAvailable={!temporaryTimelineContext} disabled={workspaceLoading || Boolean(workspaceError) || temporaryTimelineContext} onGraphUpdated={applyResearchGraph} onShowSources={(evidenceIds, eventIds) => setHighlight({ messageId: 'local', evidenceIds: new Set(evidenceIds), eventIds: new Set(eventIds), final: true })} />)}
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
