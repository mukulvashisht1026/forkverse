import type {
  LiveBackendMessage,
  SpineNode,
  WebSocketServerEvent,
} from '../types/tree';

export interface TimelineClientState {
  nodes: SpineNode[];
  version: number;
  updatedAt: string | null;
  lastMessage: LiveBackendMessage | null;
}

export function resolveApiUrl(
  path: string,
  configuredBase = ''
): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const base = configuredBase.trim().replace(/\/+$/, '');
  if (!base) {
    return cleanPath;
  }
  if (base.endsWith('/api') && cleanPath.startsWith('/api')) {
    return `${base}${cleanPath.slice(4)}`;
  }
  return `${base}${cleanPath}`;
}

export function resolveWsUrl(
  configuredWsUrl = '',
  locationLike?: { protocol: string; host: string }
): string {
  const explicit = configuredWsUrl.trim();
  if (explicit) return explicit;
  const loc =
    locationLike ??
    (typeof window !== 'undefined'
      ? window.location
      : { protocol: 'http:', host: 'localhost:3000' });
  const wsProto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProto}//${loc.host}/ws`;
}

function defaultEventMessage(event: WebSocketServerEvent): string | null {
  if ('message' in event && typeof event.message === 'string' && event.message.trim()) {
    return event.message.trim();
  }
  switch (event.type) {
    case 'node:created':
      return `Added main node: ${event.payload.node.name}`;
    case 'node:updated':
      return `Updated main node: ${event.payload.node.name}`;
    case 'node:deleted':
      return 'Removed main node from timeline.';
    case 'branch:created':
      return `Added branch "${event.payload.branch.name}"`;
    case 'branch:deleted':
      return 'Removed branch from timeline.';
    default:
      return null;
  }
}

export function applyTimelineEvent(
  state: TimelineClientState,
  event: WebSocketServerEvent
): TimelineClientState {
  const msgText = defaultEventMessage(event);
  const nextMessage: LiveBackendMessage | null =
    msgText && event.type !== 'timeline:init'
      ? {
          id: `${event.type}-${event.timestamp}-${Math.random().toString(36).slice(2, 7)}`,
          text: msgText,
          eventType: event.type,
          timestamp: event.timestamp,
        }
      : state.lastMessage;

  switch (event.type) {
    case 'timeline:init': {
      return {
        nodes: event.payload.nodes.map((n) => ({
          ...n,
          branches: (n.branches || []).map((b) => ({
            ...b,
            _prog: b._prog ?? 1,
          })),
        })),
        version: event.payload.version,
        updatedAt: event.payload.updatedAt,
        lastMessage: event.message
          ? {
              id: `init-${event.timestamp}`,
              text: event.message,
              eventType: event.type,
              timestamp: event.timestamp,
            }
          : state.lastMessage,
      };
    }

    case 'node:created': {
      const incoming = event.payload.node;
      const animatedNode: SpineNode = {
        ...incoming,
        branches: (incoming.branches || []).map((b) => ({
          ...b,
          _prog: 0,
        })),
      };
      const existingIdx = state.nodes.findIndex((n) => n.id === incoming.id);
      if (existingIdx >= 0) {
        return {
          ...state,
          version: Math.max(state.version, event.payload.version),
          updatedAt: event.timestamp,
          lastMessage: nextMessage,
        };
      }
      return {
        nodes: [...state.nodes, animatedNode],
        version: Math.max(state.version, event.payload.version),
        updatedAt: event.timestamp,
        lastMessage: nextMessage,
      };
    }

    case 'node:updated': {
      const updated = event.payload.node;
      const exists = state.nodes.some((n) => n.id === updated.id);
      if (!exists) {
        return {
          nodes: [...state.nodes, updated],
          version: Math.max(state.version, event.payload.version),
          updatedAt: event.timestamp,
          lastMessage: nextMessage,
        };
      }
      return {
        nodes: state.nodes.map((n) =>
          n.id === updated.id
            ? {
                ...updated,
                branches: (updated.branches || []).map((b) => {
                  const prevBranch = n.branches.find((pb) => pb.id === b.id);
                  return {
                    ...b,
                    _prog: prevBranch ? prevBranch._prog ?? 1 : 0,
                  };
                }),
              }
            : n
        ),
        version: Math.max(state.version, event.payload.version),
        updatedAt: event.timestamp,
        lastMessage: nextMessage,
      };
    }

    case 'node:deleted': {
      const filtered = state.nodes.filter(
        (n) => n.id !== event.payload.nodeId
      );
      if (filtered.length === state.nodes.length) {
        return {
          ...state,
          version: Math.max(state.version, event.payload.version),
          updatedAt: event.timestamp,
        };
      }
      return {
        nodes: filtered,
        version: Math.max(state.version, event.payload.version),
        updatedAt: event.timestamp,
        lastMessage: nextMessage,
      };
    }

    case 'branch:created': {
      const { nodeId, branch, version } = event.payload;
      let changed = false;
      const nextNodes = state.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        if (n.branches.some((b) => b.id === branch.id)) {
          return n;
        }
        changed = true;
        return {
          ...n,
          branches: [...n.branches, { ...branch, _prog: 0 }],
        };
      });
      if (!changed) {
        return {
          ...state,
          version: Math.max(state.version, version),
          updatedAt: event.timestamp,
        };
      }
      return {
        nodes: nextNodes,
        version: Math.max(state.version, version),
        updatedAt: event.timestamp,
        lastMessage: nextMessage,
      };
    }

    case 'branch:deleted': {
      const { nodeId, branchId, version } = event.payload;
      return {
        nodes: state.nodes.map((n) =>
          n.id === nodeId
            ? { ...n, branches: n.branches.filter((b) => b.id !== branchId) }
            : n
        ),
        version: Math.max(state.version, version),
        updatedAt: event.timestamp,
        lastMessage: nextMessage,
      };
    }

    case 'system:message': {
      return {
        ...state,
        updatedAt: event.timestamp,
        lastMessage: nextMessage,
      };
    }

    case 'pong':
    default:
      return state;
  }
}
