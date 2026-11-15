import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, ArrowUpRight, LoaderCircle, Pencil, Tag, MoreHorizontal } from 'lucide-react';
import type { FocusTarget, SpineNode } from './types/tree';
import { useLiveTimeline } from './hooks/useLiveTimeline';
import { TreeCanvasAdapter } from './components/investigationTree/TreeCanvasAdapter';
import './components/investigationTree/treeCanvas.css';
import { SpineNav } from './components/SpineNav';
import { investigationRepository, rolesFrom, watchInvestigation, type Investigation, type InvestigationHighlight, type Monitor, type MonitorActivity } from './services/investigations';
import { isMockInvestigationMode, mockInvestigationRepository } from './services/mockInvestigations';
import { LiveMonitor, host as siteHost } from './components/LiveMonitor';
import { addLiveIds, liveMarksAt, pruneLiveIds } from './utils/liveMarks';
import { ResearchChat } from './components/ResearchChat';
import { MockResearchChat } from './components/MockResearchChat';
import type { InvestigationGraphDto } from '../../contracts/investigations';
import { mapInvestigationGraphDto, type ClaimLink, type InvestigationGraph } from './services/investigations';
import { groupResearchRunInsights } from './services/investigationGraphAdapter';

/** Claim view: pending claims shown on the unverified lane (the rest are counted). */
const PENDING_SHOWN = 8;
import { NodeCard } from './components/NodeCard';
import { DraggableChatPanel } from './components/DraggableChatPanel';
import { closeNodeCard, keepExistingNodeCard, nodeCardId, openNodeCard, shouldDismissNodeCardPointer, type ActiveNodeCard } from './utils/nodeCardState';
import { animateGraphAdditions, findGraphAdditions, isNewerGraphRevision, type GraphAdditions } from './utils/graphAdditions';

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
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const graphTags = ['Policy', 'Climate', 'Technology', 'Markets'];
  const tagsFor = (item: Investigation) => {
    const title = `${item.title} ${item.description ?? ''}`.toLowerCase();
    return graphTags.filter((tag) => title.includes(tag.toLowerCase()) || tag === 'Technology' && /ai|tech/.test(title));
  };
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hoverFocus, setHoverFocus] = useState<FocusTarget | null>(null);
  const [pinnedFocus, setPinnedFocus] = useState<FocusTarget | null>(null);
  const [motionOn, setMotionOn] = useState(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try { return !reduced && window.sessionStorage.getItem('tracewire-motion') !== 'paused'; }
    catch { return !reduced; }
  });
  const [detailLevel, setDetailLevel] = useState<'detailed' | 'minimal'>(() => {
    try { return window.sessionStorage.getItem('tracewire-graph-detail') === 'minimal' ? 'minimal' : 'detailed'; }
    catch { return 'detailed'; }
  });
  const [topic, setTopic] = useState('');
  const [exampleOffset, setExampleOffset] = useState(0);
  const [exampleHovered, setExampleHovered] = useState(false);
  const [exampleFocused, setExampleFocused] = useState(false);
  const [topicFocused, setTopicFocused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [visibleInvestigationCount, setVisibleInvestigationCount] = useState(2);
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
  const [whatChanged, setWhatChanged] = useState<{ revision: number; additions: GraphAdditions } | null>(null);
  const [researchRunning, setResearchRunning] = useState(false);
  const selectedInvestigationIdRef = useRef<string | null>(null);
  const graphSnapshotRef = useRef<{ investigationId: string; revision: number; nodes: SpineNode[] } | null>(null);
  /** Visibility is independent from graph selection: at most one stable-ID card is active. */
  const [activeNodeCard, setActiveNodeCard] = useState<ActiveNodeCard>(null);
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
  /** Websites currently tracked by live monitors (shown as links over the graph). */
  const [trackedMonitors, setTrackedMonitors] = useState<Monitor[]>([]);
  const lastRevisionRef = useRef(0);

  /** Claim timeline (Entity -> Topic -> Claims -> Evidence), present once claims were built. */
  const [claimGraph, setClaimGraph] = useState<{ nodes: SpineNode[]; allNodes: SpineNode[]; links: ClaimLink[]; hiddenPending: number; entity?: string; mode?: 'news' | 'politician' } | null>(null);
  const [graphMode, setGraphMode] = useState<'claims' | 'runs'>('claims');
  const showClaims = graphMode === 'claims' && Boolean(claimGraph?.nodes.length);
  const applyGraph = (graph: InvestigationGraph) => {
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
    setClaimGraph((previous) => ({ nodes: animateGraphAdditions(previous?.nodes ?? null, nodes), allNodes: graph.claimNodes!, links: links.filter((l) => nodes.some((n) => n.id === l.from) && nodes.some((n) => n.id === l.to)), hiddenPending: politician ? 0 : pending.length - shown.size, ...(graph.entity ? { entity: graph.entity } : {}), ...(graph.mode ? { mode: graph.mode } : {}) }));
  };
  const runNodes = useMemo(() => groupResearchRunInsights(workspaceNodes ?? [], claimGraph?.allNodes ?? []), [workspaceNodes, claimGraph?.allNodes]);
  const activeNodes = showClaims ? claimGraph!.nodes : runNodes;
  const [viewTransform, setViewTransform] = useState({ k: 1, x: 0, y: 0 });
  const [canvasElement, setCanvasElement] = useState<SVGSVGElement | null>(null);
  const workspaceBodyRef = useRef<HTMLDivElement>(null);
  const cardOffsets = useRef(new Map<string, { x: number; y: number }>());
  const [cardRevision, setCardRevision] = useState(0);

  useEffect(() => {
    try { window.sessionStorage.setItem('tracewire-graph-detail', detailLevel); } catch { /* session preference is optional */ }
  }, [detailLevel]);
  useEffect(() => {
    try { window.sessionStorage.setItem('tracewire-motion', motionOn ? 'playing' : 'paused'); } catch { /* session preference is optional */ }
  }, [motionOn]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => { setReducedMotion(media.matches); if (media.matches) setMotionOn(false); };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!activeNodeCard) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!shouldDismissNodeCardPointer(Boolean(target.closest('.node-card')), Boolean(target.closest('.node-group, .tip-group')))) return;
      setActiveNodeCard((active) => active === activeNodeCard ? null : active);
    };
    document.addEventListener('pointerdown', handleOutsidePointer);
    return () => document.removeEventListener('pointerdown', handleOutsidePointer);
  }, [activeNodeCard]);
  // These are editable example prompts, not claims about a configured demo investigation.
  const topicExamples = [
    'Trace how European AI regulation has evolved, from early proposals to implementation, and connect the major policy decisions to original documents and reporting.',
    'Investigate how global lithium supply chains have shifted, identifying key policy changes, investments, export restrictions, and their original sources.',
    'Follow the international dispute over Arctic shipping routes, connecting policy decisions, environmental concerns, and documented shipping developments.',
    'Investigate how central banks responded to inflation, comparing major decisions over time and tracing the evidence behind each shift.',
    'Trace changes in US tariffs and international trade policy, connecting official announcements with responses from affected trading partners.',
  ];
  const filteredHomeInvestigations = investigations.filter((item) => !activeTag || tagsFor(item).includes(activeTag));
  const examplePaused = exampleHovered || exampleFocused || topicFocused || creating || reducedMotion || view !== 'home';

  useEffect(() => {
    if (examplePaused) return;
    const timer = window.setInterval(() => setExampleOffset((offset) => (offset + 1) % topicExamples.length), 9000);
    return () => window.clearInterval(timer);
  }, [examplePaused, topicExamples.length]);
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
      if (!match) { selectedInvestigationIdRef.current = null; setView('home'); return; }
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
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { setPinnedFocus(null); setActiveNodeCard(null); } };
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

  useEffect(() => {
    setActiveNodeCard((card) => keepExistingNodeCard(card, new Set(activeNodes.map((node) => node.id)), new Set(activeNodes.flatMap((node) => node.branches.map((branch) => branch.id)))));
  }, [activeNodes]);

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
    setWhatChanged(null);
    selectedInvestigationIdRef.current = null;
    graphSnapshotRef.current = null;
    setResearchRunning(false);
    setClaimGraph(null);
    setGraphMode('claims');
    void loadPublicInvestigations();
  };

  const acceptGraphSnapshot = useCallback((investigationId: string, revision: number, nodes: SpineNode[]) => {
    if (selectedInvestigationIdRef.current !== investigationId) return false;
    const previous = graphSnapshotRef.current;
    if (previous?.investigationId === investigationId && !isNewerGraphRevision(previous.revision, revision)) return false;
    const sameInvestigation = previous?.investigationId === investigationId;
    const additions = sameInvestigation ? findGraphAdditions(previous.nodes, nodes) : { events: [], evidence: [] };
    const animatedNodes = animateGraphAdditions(sameInvestigation ? previous.nodes : null, nodes);
    graphSnapshotRef.current = { investigationId, revision, nodes: animatedNodes };
    setWorkspaceNodes(animatedNodes);
    setWhatChanged(additions.events.length || additions.evidence.length ? { revision, additions } : null);
    return true;
  }, []);

  const completeGraphGrowth = useCallback((eventId: string, evidenceId?: string) => {
    const complete = (nodes: SpineNode[]) => {
      let changed = false;
      const next = nodes.map((node) => {
        if (node.id !== eventId) return node;
        if (evidenceId) {
          const branches = node.branches.map((branch) => {
            if (branch.id !== evidenceId || !branch._animateGrowth) return branch;
            changed = true;
            return { ...branch, _animateGrowth: false, _prog: 1 };
          });
          return changed ? { ...node, branches } : node;
        }
        if (!node._animateGrowth) return node;
        changed = true;
        return { ...node, _animateGrowth: false };
      });
      return changed ? next : nodes;
    };
    setWorkspaceNodes((nodes) => nodes ? complete(nodes) : nodes);
    setClaimGraph((graph) => graph ? { ...graph, nodes: complete(graph.nodes) } : graph);
    const snapshot = graphSnapshotRef.current;
    if (snapshot) graphSnapshotRef.current = { ...snapshot, nodes: complete(snapshot.nodes) };
  }, []);

  /** Re-fetch; only a strictly newer revision with new stable IDs can update What changed. */
  const refreshGraph = useCallback(async (investigationId: string) => {
    try {
      const graph = await repository.getInvestigationGraph(investigationId);
      if (graph.investigationId !== investigationId || graph.revision < lastRevisionRef.current) return;
      lastRevisionRef.current = graph.revision;
      acceptGraphSnapshot(investigationId, graph.revision, graph.nodes);
      applyGraph(graph);
    } catch {
      // best effort; the explicit load path reports errors
    }
  }, [acceptGraphSnapshot, repository]);

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
        // Live monitor runs ("mon-…"): the new source and its "Live update" event animate in.
        if (update.runId?.startsWith('mon-')) markLive([update.evidenceId, update.eventId]);
        schedule();
      },
      onResync: schedule,
      onHighlight: (next) => {
        if (next.messageId.startsWith('monitor-')) markLive([...next.evidenceIds, ...next.eventIds]);
        setHighlight(next.evidenceIds.size || next.eventIds.size ? next : null);
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

  // Live toast fades after a while; the full history stays in the monitor panel.
  useEffect(() => {
    if (!liveToast) return;
    const t = window.setTimeout(() => setLiveToast(null), liveToast.phase === 'claims_updated' ? 12_000 : 8000);
    return () => window.clearTimeout(t);
  }, [liveToast]);

  const openWorkspace = async (investigation: Investigation, updateUrl = true) => {
    selectedInvestigationIdRef.current = investigation.id;
    if (updateUrl) window.history.pushState(null, '', `/${encodeURIComponent(investigation.id)}`);
    setEditingTitle(false);
    setMonitorActivity([]);
    setLiveToast(null);
    setTrackedMonitors([]);
    setLiveAdded(new Map());
    setSelectedInvestigation(investigation);
    setTemporaryTimelineContext(false);
    setView('workspace');
    setWorkspaceNodes(null);
    setWorkspaceError(null);
    setWorkspaceLoading(true);
    setPinnedFocus(null);
    setHighlight(null);
    setWhatChanged(null);
    setClaimGraph(null);
    setGraphMode('claims');
    setActiveNodeCard(null);
    cardOffsets.current.clear();
    graphSnapshotRef.current = null;
    lastRevisionRef.current = 0;
    try {
      const graph = await repository.getInvestigationGraph(investigation.id);
      if (graph.investigationId !== investigation.id) throw new Error('Investigation graph ID mismatch.');
      if (selectedInvestigationIdRef.current !== investigation.id) return;
      lastRevisionRef.current = graph.revision;
      acceptGraphSnapshot(investigation.id, graph.revision, graph.nodes);
      applyGraph(graph);
      setWorkspaceFitSignal((value) => value + 1);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Investigation could not be loaded.');
    } finally {
      if (selectedInvestigationIdRef.current === investigation.id) setWorkspaceLoading(false);
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

  const navigateToTarget = useCallback((target: FocusTarget) => {
    setSelectedIndex(target.i);
    setPinnedFocus((previous) => previous?.i === target.i && previous?.j === target.j ? previous : target);
  }, []);

  /** Graph-node clicks open/focus one stable-ID card; selection alone never controls visibility. */
  const focusTarget = useCallback((target: FocusTarget) => {
    navigateToTarget(target);
    const node = activeNodes[target.i];
    if (node) {
      const evidence = target.j === undefined ? undefined : node.branches[target.j];
      if (target.j !== undefined && !evidence) return;
      const card = { eventId: node.id, ...(evidence ? { evidenceId: evidence.id } : {}) };
      setActiveNodeCard((active) => openNodeCard(active, card));
    }
  }, [activeNodes, navigateToTarget]);
  const activeFocus = hoverFocus ?? pinnedFocus;

  const applyResearchGraph = useCallback((event: { type: 'graph_updated'; graph: InvestigationGraphDto }) => {
    if (!selectedInvestigation || event.graph.investigationId !== selectedInvestigation.id) return;
    if (event.graph.revision < lastRevisionRef.current) return;
    lastRevisionRef.current = event.graph.revision;
    const mapped = mapInvestigationGraphDto(event.graph);
    if (!acceptGraphSnapshot(event.graph.investigationId, event.graph.revision, mapped.nodes)) return;
    const hadClaims = Boolean(claimGraph);
    applyGraph(mapped);
    if (mapped.claimNodes?.length && !hadClaims) setGraphMode('claims');
    setWorkspaceFitSignal((value) => value + 1);
  }, [selectedInvestigation, claimGraph, acceptGraphSnapshot]);

  const continueGraph = async () => {
    if (continuing || !selectedInvestigation || activeNodes.length === 0) return;
    const lastNode = activeNodes[activeNodes.length - 1];
    const context = activeNodes.slice(-3).map((node) => node.name).join('; ');
    setContinuing(true);
    try {
      if (mockMode) {
        const graph = await repository.extendInvestigation(selectedInvestigation.id, { topic: `Next development after ${lastNode.name}` });
        const nextNodes = animateGraphAdditions(activeNodes, graph.nodes);
        setWorkspaceNodes(nextNodes);
        const snapshot = graphSnapshotRef.current;
        if (snapshot) graphSnapshotRef.current = { ...snapshot, nodes: nextNodes };
        setSelectedIndex(graph.nodes.length - 1);
        setWorkspaceFitSignal((value) => value + 1);
        return;
      }
      const result = await sendPrompt({
        prompt: `Continue this investigation after "${lastNode.name}". Research the next significant related event. Context: ${context}`,
        mode: 'new-node', selectedNodeId: lastNode.id, selectedNodeName: lastNode.name, provider: 'auto',
      });
      if (result.node) {
        const current = graphSnapshotRef.current?.nodes ?? activeNodes;
        if (!current.some((node) => node.id === result.node!.id)) {
          const node = result.branches?.length
            ? { ...result.node!, branches: [...result.node!.branches, ...result.branches.filter((branch) => !result.node!.branches.some((existing) => existing.id === branch.id))] }
            : result.node!;
          const animatedNode = { ...node, _animateGrowth: true, branches: node.branches.map((branch) => ({ ...branch, _animateGrowth: true, _prog: 0 })) };
          const nextNodes = [...current, animatedNode];
          setWorkspaceNodes(nextNodes);
          const snapshot = graphSnapshotRef.current;
          if (snapshot) graphSnapshotRef.current = { ...snapshot, nodes: nextNodes };
          setSelectedIndex(nextNodes.length - 1);
        }
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

  const focusWhatChanged = () => {
    if (!whatChanged) return;
    const eventIds = new Set(whatChanged.additions.events.map((item) => item.id));
    const evidenceIds = new Set(whatChanged.additions.evidence.map((item) => item.id));
    setHighlight({ messageId: `revision-${whatChanged.revision}`, eventIds, evidenceIds, final: true });
    const firstEvidence = whatChanged.additions.evidence[0];
    const firstEventId = whatChanged.additions.events[0]?.id ?? firstEvidence?.eventId;
    const spineIndex = activeNodes.findIndex((node) => node.id === firstEventId);
    if (spineIndex >= 0) {
      const branchIndex = firstEvidence?.eventId === firstEventId
        ? activeNodes[spineIndex].branches.findIndex((branch) => branch.id === firstEvidence.id)
        : -1;
      navigateToTarget({ i: spineIndex, ...(branchIndex >= 0 ? { j: branchIndex } : {}) });
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
            <div className="gh-research-composer">
              <textarea id="research-topic" value={topic}
                onFocus={() => setTopicFocused(true)}
                onBlur={() => setTopicFocused(false)}
                onChange={(e) => { setTopic(e.target.value); setCreateError(null); }}
                placeholder="What would you like to investigate?" rows={4} disabled={creating}
                aria-label="Research topic"
                aria-describedby={createError ? 'topic-error' : undefined} />
              {topic.trim().length >= 2 && <div className="gh-source-suggestions" aria-live="polite" aria-label="Potential sources">
                <span className="gh-source-hint">Potential sources · demo</span>
                {(() => { const matched = [
                  { name: 'Reuters', type: 'News', match: /news|war|election|policy|trade|company|market|climate|technology|health|science|government|law|research|claim|fact|statement|president|politician/i },
                  { name: 'Associated Press', type: 'News', match: /news|war|election|policy|trade|company|market|climate|technology|health|science|government|law|research|claim|fact|statement|president|politician/i },
                  { name: 'BBC News', type: 'News', match: /news|war|election|policy|trade|company|market|climate|technology|health|science|government|law|research|claim|fact|statement|president|politician/i },
                  { name: 'Government & official sites', type: 'Official', match: /government|policy|law|regulation|election|president|official/i },
                  { name: 'Academic research', type: 'Research', match: /research|science|study|health|climate|technology/i },
                  { name: 'FactCheck.org', type: 'Fact-check', match: /claim|fact|statement|election|president|politician/i },
                ].filter((source) => source.match.test(topic)).slice(0, 4); return matched.length ? matched.map((source) => <span className="gh-source-pill" key={source.name} title={`${source.type} · demo suggestion`}>{source.name}</span>) : <span className="gh-source-pill">General news</span>; })()}
              </div>}
              <div className="gh-composer-footer">
                <button className="gh-primary" type="submit" disabled={creating || !topic.trim()}>
                  {creating ? <><LoaderCircle className="gh-spin" size={15} /> Starting…</> : <>Start investigation <ArrowUpRight size={15} /></>}
                </button>
              </div>
            </div>
            {createError && <p id="topic-error" role="alert" className="gh-error">{createError}</p>}
            {creating && <p className="gh-hint">Starting live research…</p>}
            <div className={`tw-example${examplePaused ? ' is-paused' : ''}`} onMouseEnter={() => setExampleHovered(true)} onMouseLeave={() => setExampleHovered(false)} onFocusCapture={() => setExampleFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setExampleFocused(false); }}>
              <button key={exampleOffset} className="tw-example-button" type="button" disabled={creating}
                aria-label={`Fill prompt with example: ${topicExamples[exampleOffset]}`}
                onClick={() => { setTopic(topicExamples[exampleOffset]); setCreateError(null); document.getElementById('research-topic')?.focus(); }}>
                <span className="tw-example-text">{topicExamples[exampleOffset]}</span>
                <ArrowUpRight size={15} aria-hidden="true" />
              </button>
            </div>
          </form>
        </section>
        {!libraryError && <section className="gh-existing" aria-labelledby="public-investigations-title">
          <div className="gh-section-heading"><h2 id="public-investigations-title">Explore investigations</h2></div>
          {libraryLoading ? <p className="gh-muted">Loading public investigations…</p> : investigations.length ? <>
            <div className="gh-tag-filter" aria-label="Filter by tag"><button type="button" className={!activeTag ? 'is-active' : ''} onClick={() => { setActiveTag(null); setVisibleInvestigationCount(2); }}>All tags</button>{graphTags.map((tag) => <button type="button" key={tag} className={activeTag === tag ? 'is-active' : ''} onClick={() => { setActiveTag(activeTag === tag ? null : tag); setVisibleInvestigationCount(2); }}><Tag size={12} />{tag}</button>)}</div>
            {filteredHomeInvestigations.slice(0, visibleInvestigationCount).map((item) => (
              <a className="gh-investigation" key={item.id} href={`/${encodeURIComponent(item.id)}`} onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                void openWorkspace(item);
              }}>
                <span className="gh-investigation-copy"><strong>{item.title}</strong></span>
                <span className="gh-investigation-meta"><ArrowUpRight size={16} aria-hidden="true" /></span>
              </a>))}
            {filteredHomeInvestigations.length > visibleInvestigationCount && <button className="gh-load-more" type="button" aria-label="Show more investigations" title="Show more investigations" onClick={() => setVisibleInvestigationCount((count) => count + 2)}><MoreHorizontal size={20} aria-hidden="true" /></button>}
          </> : <p className="gh-muted">No public investigations available yet.</p>}
        </section>}
      </div>
    </main>
  ) : (
    <main className="gh-workspace">
      <header className="gh-topbar">
        <button className="gh-back" onClick={returnHome} aria-label="Back to investigations"><ArrowLeft size={16} /><span className="gh-topbar-brand">TRACEWIRE</span></button>
        <div className="gh-title-edit">{editingTitle ? <input autoFocus maxLength={120} value={titleDraft} aria-label="Graph title" onChange={(event) => setTitleDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { setTitleDraft(selectedInvestigation?.title ?? ''); event.currentTarget.blur(); } }} onBlur={() => void saveTitle()} /> : <><span className="gh-workspace-title" title={selectedInvestigation?.title}>{claimGraph?.entity && <><span className="gh-entity">{claimGraph.entity}</span><span className="gh-crumb-sep">›</span></>}{selectedInvestigation?.title ?? 'Investigation'}</span><button type="button" className="gh-title-edit-button" aria-label="Edit graph title" onClick={() => { setTitleDraft(selectedInvestigation?.title ?? ''); setEditingTitle(true); }}><Pencil size={14} /></button></>}</div>
        {claimGraph && <div className="gh-graph-mode" role="group" aria-label="Graph view">
          <button type="button" className={showClaims ? 'on' : ''} aria-pressed={showClaims} onClick={() => { setGraphMode('claims'); setSelectedIndex(0); setPinnedFocus(null); setActiveNodeCard(null); setWorkspaceFitSignal((v) => v + 1); }}>Claims</button>
          <button type="button" className={!showClaims ? 'on' : ''} aria-pressed={!showClaims} onClick={() => { setGraphMode('runs'); setSelectedIndex(0); setPinnedFocus(null); setActiveNodeCard(null); setWorkspaceFitSignal((v) => v + 1); }}>Research runs</button>
        </div>}
      </header>
      <div className="gh-workspace-body" ref={workspaceBodyRef}>
        <DraggableChatPanel workspaceRef={workspaceBodyRef}>
        <div className="gh-chat-column">
          {temporaryTimelineContext && <p className="gh-context-notice" role="status">Temporary timeline context; not a saved investigation.</p>}
          {selectedInvestigation && (mockMode
            ? <MockResearchChat key={selectedInvestigation.id} onAddEvent={async (prompt) => { const graph = await repository.extendInvestigation(selectedInvestigation.id, { topic: prompt }); acceptGraphSnapshot(graph.investigationId, graph.revision, graph.nodes); setWorkspaceFitSignal((value) => value + 1); }} />
            : <ResearchChat key={selectedInvestigation.id} investigationId={selectedInvestigation.id} historyAvailable={!temporaryTimelineContext} disabled={workspaceLoading || Boolean(workspaceError) || temporaryTimelineContext} onGraphUpdated={applyResearchGraph} onHighlight={(nodeIds, evidenceIds, roles) => { const roleMap = rolesFrom(roles); setHighlight(nodeIds.length || evidenceIds.length ? { messageId: 'sse', evidenceIds: new Set(evidenceIds), eventIds: new Set(nodeIds), final: true, ...(roleMap && { roles: roleMap }) } : null); }} onShowSources={(evidenceIds, eventIds, roles) => { const roleMap = rolesFrom(roles); setHighlight({ messageId: 'local', evidenceIds: new Set(evidenceIds), eventIds: new Set(eventIds), final: true, ...(roleMap && { roles: roleMap }) }); }} selectedEvent={temporaryTimelineContext || showClaims ? null : activeNodes[selectedIndex] ? { id: activeNodes[selectedIndex].id, title: activeNodes[selectedIndex].name } : null} />)}
        </div>
        </DraggableChatPanel>
        <section className="gh-graph" aria-label={showClaims ? 'Claim timeline' : 'Evidence graph'}>
          {workspaceNodes && <TreeCanvasAdapter
            spine={activeNodes} selectedIndex={selectedIndex} focus={activeFocus} moving={motionOn}
            detailLevel={detailLevel} researching={researchRunning || continuing} fitSignal={workspaceFitSignal}
            onHoverTarget={setHoverFocus} onSelectTarget={focusTarget} onClearPin={() => setPinnedFocus(null)}
            onContinue={() => void continueGraph()} isContinuing={continuing} highlight={highlight}
            liveMarks={liveMarks} links={showClaims ? claimGraph?.links : undefined}
            laneNote={undefined}
            onViewChange={setViewTransform} onCanvasReady={setCanvasElement} onGrowthComplete={completeGraphGrowth}
          />}
          {showClaims && !highlight?.roles && <details className="gh-claim-legend">
            <summary>Legend &amp; timeline</summary>
            <p>{activeNodes.filter((n) => n.claimStatus === 'established').length} established · {activeNodes.filter((n) => n.claimStatus === 'pending').length + (claimGraph?.hiddenPending ?? 0)} unverified · {claimGraph?.links.length ?? 0} links</p>
            <div aria-label="Claim legend">{claimGraph?.mode === 'politician' ? <>
              <span className="lg-source"><i />Reports the claim</span><span className="lg-fulfilled"><i />Fulfilled</span><span className="lg-contradicts"><i />Not fulfilled</span><span className="lg-supports"><i />In progress</span><span className="lg-context"><i />No follow-up yet</span>
            </> : <>
              <span className="lg-supports"><i />Supports</span><span className="lg-contradicts"><i />Contradicts</span><span className="lg-context"><i />Context</span><span className="lg-pending"><i />Unverified lane</span>
            </>}</div>
            <p>{claimGraph?.mode === 'politician' ? 'Unverified: one source so far. ' : 'The lower lane contains claims awaiting corroboration. '}Solid links are stated; dashed links are inferred or sequential. Select a claim to inspect its sources.</p>
            {liveMarks.size > 0 && <p>{liveMarks.size} items added by live tracking</p>}
          </details>}
          <div className="gh-graph-controls">
            {selectedInvestigation && !temporaryTimelineContext && !mockMode && <LiveMonitor key={selectedInvestigation.id} investigationId={selectedInvestigation.id} topic={selectedInvestigation.title} activity={monitorActivity} disabled={workspaceLoading || Boolean(workspaceError)} onMonitorsChange={setTrackedMonitors} />}
            {whatChanged && !showClaims && <button type="button" className="gh-what-changed" onClick={focusWhatChanged} title={`New since graph revision ${whatChanged.revision}`}>What changed · {whatChanged.additions.events.length + whatChanged.additions.evidence.length}</button>}
            {highlight?.roles && <div className="gh-proof-legend" aria-label="Proof roles"><span className="role-consensus"><i />Shared facts</span><span className="role-angle"><i />Own angle</span><span className="role-dispute"><i />Disputed</span><span className="role-unreadable"><i />Unreadable</span></div>}
            {highlight && <button type="button" className="gh-highlight-clear" onClick={() => setHighlight(null)} title="Show the whole graph again">{highlight.roles ? `Comparing ${highlight.evidenceIds.size} articles` : highlight.final ? `Showing ${highlight.evidenceIds.size} cited sources` : 'Citing sources…'} · Clear</button>}
            <button type="button" aria-pressed={motionOn && !reducedMotion} disabled={reducedMotion} title={reducedMotion ? 'Disabled by your reduced-motion preference' : undefined} onClick={() => setMotionOn((value) => !value)}>{motionOn && !reducedMotion ? 'Pause motion' : 'Resume motion'}</button>
            <button type="button" aria-pressed={detailLevel === 'detailed'} onClick={() => setDetailLevel((level) => level === 'detailed' ? 'minimal' : 'detailed')}>{detailLevel === 'detailed' ? 'Detailed view' : 'Minimal view'}</button>
            <button type="button" onClick={fitGraph}>Fit graph</button>
          </div>
          {liveToast && <div className={`tw-live-toast p-${liveToast.phase}`} role="status" aria-live="polite"><span className="tw-live-toast-tag"><i className="tw-live-dot" aria-hidden="true" />LIVE</span><span>{liveToast.message}{liveToast.url && <> · <a href={liveToast.url} target="_blank" rel="noopener noreferrer" title={liveToast.url}>{siteHost(liveToast.url)}</a></>}</span><button type="button" aria-label="Dismiss live update" onClick={() => setLiveToast(null)}>×</button></div>}
          {trackedMonitors.length > 0 && <div className="tw-tracking-strip" aria-label="Websites tracked live"><span className="tw-tracking-tag"><i className="tw-live-dot" aria-hidden="true" />TRACKING</span>{trackedMonitors.map((m) => <a key={m.id} href={m.url} target="_blank" rel="noopener noreferrer" title={`${m.label}\n${m.url}`} className={`s-${m.status}`}>{siteHost(m.url)}</a>)}</div>}
          {workspaceLoading && <div className="gh-graph-state">Loading investigation graph…</div>}
          {workspaceError && <div className="gh-graph-state"><p>{workspaceError}</p><button onClick={() => selectedInvestigation && void openWorkspace(selectedInvestigation)}>Retry</button></div>}
          {!workspaceLoading && !workspaceError && workspaceNodes?.length === 0 && <div className="gh-graph-state">{researchRunning ? 'Researching… evidence will appear here as it is found.' : 'This investigation has no evidence yet.'}</div>}
          {workspaceNodes && !showClaims && <SpineNav spine={activeNodes} selectedIndex={selectedIndex} onHoverNode={setHoverFocus} onSelectNode={(index) => focusTarget({ i: index })} />}
          {workspaceNodes && activeNodeCard && (() => {
            const cardInfo = activeNodeCard;
            const cardId = nodeCardId(cardInfo);
            const spineIdx = activeNodes.findIndex((item) => item.id === cardInfo.eventId);
            const node = activeNodes[spineIdx];
            if (!node) return null;
            const isBranch = Boolean(cardInfo.evidenceId);
            const branchIndex = cardInfo.evidenceId ? node.branches.findIndex((item) => item.id === cardInfo.evidenceId) : -1;
            if (isBranch && branchIndex < 0) return null;
            const targetBranch = isBranch && branchIndex >= 0 ? node.branches[branchIndex] : undefined;
            const targetNode = targetBranch ?? node;
            const groupedSources = targetBranch?.groupedSources;
            const anchorId = isBranch ? `evidence:${node.id}:${targetNode.id}` : `event:${node.id}`;
            const positionKey = `${graphMode}:${anchorId}`;
            const savedOffset = cardOffsets.current.get(positionKey);
            const nodeRef = { current: canvasElement };
            return <NodeCard key={positionKey} node={targetNode} isBranch={isBranch} anchorId={anchorId} view={viewTransform} svgRef={nodeRef} workspaceRef={workspaceBodyRef} offset={savedOffset} revision={cardRevision} onClose={() => setActiveNodeCard((active) => closeNodeCard(active, cardId))} onDragEnd={(_id, offset) => { cardOffsets.current.set(positionKey, offset); setCardRevision((n) => n + 1); }} cardKey={cardId} label={showClaims ? (isBranch ? 'Evidence' : node.claimStatus === 'pending' ? 'Unverified claim' : 'Claim') : groupedSources?.length ? `Insight · ${groupedSources.length} source${groupedSources.length === 1 ? '' : 's'}` : undefined}>
              {showClaims && (isBranch
                ? <button type="button" className="node-card-back" onClick={() => focusTarget({ i: spineIdx })}>← Claim: {node.name}</button>
                : <section className="node-card-sources" aria-label="Claim sources"><h4>{node.branches.length ? `${node.branches.length} source${node.branches.length === 1 ? '' : 's'}` : 'No sources attached yet'}</h4><ul>{node.branches.map((b, j) => <li key={b.id}><button type="button" onClick={() => focusTarget({ i: spineIdx, j })}><span className="node-card-relation">{b.relation ?? b.stance}</span><strong>{b.name}</strong><span className="node-card-source-meta">{[b.sourceDomain, asDate(b.publishedAt)].filter(Boolean).join(' · ')}</span></button></li>)}</ul></section>)}
              {groupedSources && groupedSources.length > 0 && <section className="node-card-sources" aria-label="Sources for this insight"><h4>{groupedSources.length} source{groupedSources.length === 1 ? '' : 's'} for this insight</h4><ul>{groupedSources.map((source) => <li key={source.id}>{source.sourceUrl ? <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer"><strong>{source.name}</strong></a> : <strong>{source.name}</strong>}<span className="node-card-source-meta">{[source.sourceName ?? source.sourceDomain, asDate(source.publishedAt)].filter(Boolean).join(' · ')}</span></li>)}</ul></section>}
            </NodeCard>;
          })()}
        </section>
      </div>
    </main>
  );
}
