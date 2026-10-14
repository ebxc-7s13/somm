import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AppContext } from '../context';
import { SESSION_COOKIE, sessionUser } from '../services/accounts';

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Attach the authenticated WebSocket endpoint (/ws) to an HTTP server. */
export function attachWebSocket(server: Server, ctx: AppContext): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') return socket.destroy();
    const origin = req.headers.origin;
    if (origin && !ctx.config.allowedOrigins.includes(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      return socket.destroy();
    }
    const user = sessionUser(ctx.db, readCookie(req.headers.cookie, SESSION_COOKIE));
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      const connId = ctx.hub.connect(user.id, ws);
      let alive = true;
      ws.on('pong', () => (alive = true));
      const heartbeat = setInterval(() => {
        if (!alive) return ws.terminate();
        alive = false;
        ws.ping();
      }, 30_000);
      heartbeat.unref?.();
      ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        ctx.hub.handle(connId, data.toString());
      });
      ws.on('close', () => {
        clearInterval(heartbeat);
        ctx.hub.disconnect(connId);
      });
      ws.on('error', () => ws.close());
    });
  });

  return wss;
}
