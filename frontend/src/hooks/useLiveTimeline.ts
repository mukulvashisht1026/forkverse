import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BranchGrowthSide,
  BranchNode,
  LiveBackendMessage,
  PromptRequest,
  PromptResponse,
  ScrapeProviderPreference,
  SpineNode,
  TimelineSnapshot,
  WebSocketServerEvent,
} from '../types/tree';
import {
  applyTimelineEvent,
  resolveApiUrl,
  resolveWsUrl,
  type TimelineClientState,
} from '../utils/timelineReducer';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
const WS_BASE = import.meta.env.VITE_WS_URL ?? '';
const MOCK_DATA = import.meta.env.VITE_MOCK_DATA === 'true';

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(resolveApiUrl(path, API_BASE), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Backend request failed (${res.status})`);
  }
  return data;
}

export function useLiveTimeline(onTimelineGrew?: () => void) {
  const [state, setState] = useState<TimelineClientState>({
    nodes: [],
    version: 0,
    updatedAt: null,
    lastMessage: null,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [dismissedMsgId, setDismissedMsgId] = useState<string | null>(null);

  const onGrewRef = useRef(onTimelineGrew);
  onGrewRef.current = onTimelineGrew;

  const prevCountsRef = useRef<{ nodes: number; branches: number }>({
    nodes: 0,
    branches: 0,
  });

  useEffect(() => {
    const nodeCount = state.nodes.length;
    const branchCount = state.nodes.reduce(
      (sum, n) => sum + (n.branches?.length ?? 0),
      0
    );
    const prev = prevCountsRef.current;
    if (
      nodeCount > prev.nodes ||
      (prev.branches > 0 && branchCount > prev.branches)
    ) {
      onGrewRef.current?.();
    }
    prevCountsRef.current = { nodes: nodeCount, branches: branchCount };
  }, [state.nodes]);

  const fetchTimeline = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const snapshot = await apiJson<TimelineSnapshot>('/api/timeline');
      setState((prev) =>
        applyTimelineEvent(prev, {
          type: 'timeline:init',
          payload: snapshot,
          timestamp: snapshot.updatedAt,
        })
      );
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : 'Unable to load timeline from backend.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (MOCK_DATA) { setLoading(false); return; }
    void fetchTimeline();
  }, [fetchTimeline]);

  useEffect(() => {
    if (MOCK_DATA) return;
    let closedByCleanup = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;
    let attempt = 0;

    const connect = () => {
      if (closedByCleanup) return;
      const wsUrl = resolveWsUrl(WS_BASE);
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        attempt = 0;
        setWsConnected(true);
        pingTimer = window.setInterval(() => {
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      socket.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(String(evt.data)) as WebSocketServerEvent;
          setState((prev) => applyTimelineEvent(prev, parsed));
          setLoading(false);
          setLoadError(null);
        } catch {
          // Ignore malformed frame
        }
      };

      socket.onclose = () => {
        setWsConnected(false);
        if (pingTimer !== null) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        if (!closedByCleanup) {
          const delay = Math.min(10000, 1000 * Math.pow(2, attempt));
          attempt += 1;
          reconnectTimer = window.setTimeout(connect, delay);
        }
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      closedByCleanup = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (pingTimer !== null) clearInterval(pingTimer);
      socket?.close();
    };
  }, []);

  const createMainNode = useCallback(
    async (input: { name: string; info: string }): Promise<SpineNode> => {
      const res = await apiJson<{ node: SpineNode; version: number }>(
        '/api/timeline/nodes',
        {
          method: 'POST',
          body: JSON.stringify({
            name: input.name,
            declaration: input.info || input.name,
            info: input.info || 'Custom main declaration node.',
            platform: 'Backend API',
            scrapeEngine: 'manual',
          }),
        }
      );
      setState((prev) =>
        applyTimelineEvent(prev, {
          type: 'node:created',
          payload: { node: res.node, version: res.version },
          timestamp: new Date().toISOString(),
        })
      );
      return res.node;
    },
    []
  );

  const createBranch = useCallback(
    async (
      nodeId: string,
      input: { name: string; info: string; growthSide: BranchGrowthSide }
    ): Promise<BranchNode> => {
      const res = await apiJson<{ branch: BranchNode; version: number }>(
        `/api/timeline/nodes/${encodeURIComponent(nodeId)}/branches`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: input.name,
            info: input.info || 'Supporting evidence.',
            sourceType: input.growthSide === 'bottom' ? 'social' : 'news',
            growthSide: input.growthSide,
          }),
        }
      );
      setState((prev) =>
        applyTimelineEvent(prev, {
          type: 'branch:created',
          payload: { nodeId, branch: res.branch, version: res.version },
          timestamp: new Date().toISOString(),
        })
      );
      return res.branch;
    },
    []
  );

  const scrapeMainNode = useCallback(
    async (input: {
      query: string;
      url?: string;
      provider: ScrapeProviderPreference;
    }): Promise<{ node: SpineNode; notice?: string }> => {
      const res = await apiJson<{
        node: SpineNode;
        version?: number;
        notice?: string;
      }>('/api/scrape-event', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setState((prev) =>
        applyTimelineEvent(prev, {
          type: 'node:created',
          payload: {
            node: res.node,
            version: res.version ?? prev.version + 1,
          },
          timestamp: new Date().toISOString(),
        })
      );
      return { node: res.node, notice: res.notice };
    },
    []
  );

  const scrapeBranches = useCallback(
    async (
      nodeId: string,
      input: {
        topic: string;
        query: string;
        existingCount: number;
        provider: ScrapeProviderPreference;
      }
    ): Promise<{ branches: BranchNode[]; notice?: string }> => {
      const res = await apiJson<{
        branches: BranchNode[];
        version?: number;
        notice?: string;
      }>('/api/scrape-branch', {
        method: 'POST',
        body: JSON.stringify({ ...input, nodeId }),
      });
      for (const branch of res.branches) {
        setState((prev) =>
          applyTimelineEvent(prev, {
            type: 'branch:created',
            payload: {
              nodeId,
              branch,
              version: res.version ?? prev.version + 1,
            },
            timestamp: new Date().toISOString(),
          })
        );
      }
      return { branches: res.branches, notice: res.notice };
    },
    []
  );

  const deleteMainNode = useCallback(async (nodeId: string) => {
    const res = await apiJson<{ nodeId: string; version: number }>(
      `/api/timeline/nodes/${encodeURIComponent(nodeId)}`,
      { method: 'DELETE' }
    );
    setState((prev) =>
      applyTimelineEvent(prev, {
        type: 'node:deleted',
        payload: { nodeId: res.nodeId, version: res.version },
        timestamp: new Date().toISOString(),
      })
    );
  }, []);

  const deleteBranch = useCallback(async (nodeId: string, branchId: string) => {
    const res = await apiJson<{
      nodeId: string;
      branchId: string;
      version: number;
    }>(
      `/api/timeline/nodes/${encodeURIComponent(nodeId)}/branches/${encodeURIComponent(branchId)}`,
      { method: 'DELETE' }
    );
    setState((prev) =>
      applyTimelineEvent(prev, {
        type: 'branch:deleted',
        payload: {
          nodeId: res.nodeId,
          branchId: res.branchId,
          version: res.version,
        },
        timestamp: new Date().toISOString(),
      })
    );
  }, []);

  const sendPrompt = useCallback(
    async (input: PromptRequest): Promise<PromptResponse> => {
      const res = await apiJson<PromptResponse>('/api/prompt', {
        method: 'POST',
        body: JSON.stringify(input),
      });

      if (res.node) {
        setState((prev) =>
          applyTimelineEvent(prev, {
            type: 'node:created',
            payload: {
              node: res.node!,
              version: res.version ?? prev.version + 1,
            },
            message: res.message,
            timestamp: new Date().toISOString(),
          })
        );
      } else if (res.branches && res.branches.length > 0 && res.nodeId) {
        for (const branch of res.branches) {
          setState((prev) =>
            applyTimelineEvent(prev, {
              type: 'branch:created',
              payload: {
                nodeId: res.nodeId!,
                branch,
                version: res.version ?? prev.version + 1,
              },
              message: res.message,
              timestamp: new Date().toISOString(),
            })
          );
        }
      } else if (res.message) {
        setState((prev) =>
          applyTimelineEvent(prev, {
            type: 'system:message',
            message: res.message!,
            timestamp: new Date().toISOString(),
          })
        );
      }

      return res;
    },
    []
  );

  const liveMessage: LiveBackendMessage | null =
    state.lastMessage && state.lastMessage.id !== dismissedMsgId
      ? state.lastMessage
      : null;

  const dismissMessage = useCallback(() => {
    if (state.lastMessage) {
      setDismissedMsgId(state.lastMessage.id);
    }
  }, [state.lastMessage]);

  return {
    nodes: state.nodes,
    version: state.version,
    loading,
    loadError,
    wsConnected,
    liveMessage,
    dismissMessage,
    reload: fetchTimeline,
    createMainNode,
    createBranch,
    scrapeMainNode,
    scrapeBranches,
    sendPrompt,
    deleteMainNode,
    deleteBranch,
  };
}
