/**
 * WebSocket hub for the frontend's live timeline (contract: frontend/README.md §4).
 *
 * - Clients connect to `/ws` (Caddy and the Vite dev proxy forward it here).
 * - On open the server sends `timeline:init` with the current snapshot.
 * - Client `ping` -> `pong`; client `timeline:sync` -> fresh `timeline:init`.
 * - `broadcast()` pushes node/branch/system events to every open client.
 * - Server-side heartbeat drops connections that stop answering protocol pings.
 */
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { TimelineStore } from '../timeline/store.js';
import type { WebSocketServerEvent } from '../timeline/types.js';
import { logger } from '../utils/logger.js';

const WS_PATHS = new Set(['/ws', '/api/ws']);
const HEARTBEAT_MS = 30_000;

export class RealtimeHub {
  private wss = new WebSocketServer({ noServer: true });
  private alive = new WeakMap<WebSocket, boolean>();
  private heartbeat?: NodeJS.Timeout;
  private connectListeners: Array<() => void> = [];

  constructor(private store: TimelineStore) {
    this.wss.on('connection', (ws) => this.onConnection(ws));
  }

  /** Handle HTTP upgrades on `/ws` for this server; other paths are rejected. */
  attach(server: Server): void {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (!WS_PATHS.has(pathname)) {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
    });

    this.heartbeat = setInterval(() => {
      for (const ws of this.wss.clients) {
        if (this.alive.get(ws) === false) {
          ws.terminate();
          continue;
        }
        this.alive.set(ws, false);
        ws.ping();
      }
    }, HEARTBEAT_MS);
    server.on('close', () => this.close());
  }

  /** Run fn after each new client has been sent its timeline:init snapshot. */
  onClientConnected(fn: () => void): void {
    this.connectListeners.push(fn);
  }

  get clientCount(): number {
    return this.wss.clients.size;
  }

  broadcast(event: WebSocketServerEvent): void {
    const frame = JSON.stringify(event);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(frame);
    }
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
  }

  private onConnection(ws: WebSocket): void {
    this.alive.set(ws, true);
    ws.on('pong', () => this.alive.set(ws, true));
    ws.on('error', (err) => logger.warn({ err }, 'websocket client error'));

    void this.sendSnapshot(ws).then(() => this.connectListeners.forEach((fn) => fn()));

    ws.on('message', (raw) => {
      let msg: { type?: unknown };
      try {
        msg = JSON.parse(String(raw)) as { type?: unknown };
      } catch {
        return; // ignore malformed frames
      }
      if (msg.type === 'ping') {
        send(ws, { type: 'pong', timestamp: new Date().toISOString() });
      } else if (msg.type === 'timeline:sync') {
        void this.sendSnapshot(ws);
      }
    });
  }

  private async sendSnapshot(ws: WebSocket): Promise<void> {
    try {
      const payload = await this.store.getSnapshot();
      send(ws, { type: 'timeline:init', payload, timestamp: new Date().toISOString() });
    } catch (err) {
      logger.error({ err }, 'failed to load timeline snapshot for websocket');
      send(ws, {
        type: 'system:message',
        message: 'Backend could not load the timeline (database unavailable).',
        timestamp: new Date().toISOString(),
      });
    }
  }
}

function send(ws: WebSocket, event: WebSocketServerEvent): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
}
