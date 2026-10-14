/**
 * Reconnecting WebSocket client. Re-subscribes rooms after reconnecting and
 * emits 'reconnected' so the chat can fetch `?after=<lastId>` to fill gaps.
 */
export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

type Handler = (msg: any) => void;

export class RealtimeClient {
  status: RealtimeStatus = 'idle';
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private rooms = new Set<string>();
  private attempts = 0;
  private timer: number | null = null;
  private stopped = false;
  private everOpened = false;

  constructor(private readonly url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`) {}

  connect() {
    this.stopped = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.setStatus(this.everOpened ? 'reconnecting' : 'connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      const reconnect = this.everOpened;
      this.everOpened = true;
      this.attempts = 0;
      this.setStatus('open');
      for (const room of this.rooms) this.send({ type: 'subscribe', treeId: room });
      if (reconnect) this.emit('reconnected', {});
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        this.emit(msg.type, msg);
        this.emit('*', msg);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      this.ws = null;
      if (this.stopped) return this.setStatus('closed');
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect() {
    this.setStatus(navigator.onLine === false ? 'closed' : 'reconnecting');
    const delay = Math.min(30_000, 1000 * 2 ** this.attempts) * (0.75 + Math.random() * 0.5);
    this.attempts++;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.connect(), delay);
  }

  disconnect() {
    this.stopped = true;
    if (this.timer) window.clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
    this.everOpened = false;
    this.setStatus('closed');
  }

  send(msg: unknown): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  subscribe(treeId: string) {
    this.rooms.add(treeId);
    this.send({ type: 'subscribe', treeId });
  }

  unsubscribe(treeId: string) {
    this.rooms.delete(treeId);
    this.send({ type: 'unsubscribe', treeId });
  }

  on(type: string, fn: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }

  private emit(type: string, msg: any) {
    for (const fn of this.handlers.get(type) ?? []) fn(msg);
  }

  private setStatus(s: RealtimeStatus) {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', { status: s });
  }
}

let shared: RealtimeClient | null = null;
export function realtime(): RealtimeClient {
  shared ??= new RealtimeClient();
  return shared;
}
