/**
 * Realtime hub over WebSockets: Tree chat fan-out and WebRTC call signalling.
 *
 * Chat messages are written through the REST API (validated, rate-limited,
 * persisted); the hub only pushes them to subscribed members. On reconnect the
 * client fetches `?after=<lastId>` to fill any gap, so delivery does not depend
 * on the socket staying up.
 *
 * Calls: 1:1 only. The hub relays SDP offers/answers and ICE candidates between
 * the two participants after checking that they share a Tree and have not
 * blocked each other. Media flows peer-to-peer (or via a configured TURN relay);
 * SOMM never sees or records audio/video.
 */
import type { AppConfig } from '../config';
import { all, get, newId, nowIso, run, type DB } from '../db';
import { SlidingWindowLimiter, LIMITS } from '../ratelimit';
import { isMember } from '../services/communities';
import { hiddenAuthors, type ChatMessage } from '../services/chat';

export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface Conn {
  id: string;
  userId: string;
  socket: SocketLike;
  rooms: Set<string>;
  frames: number[];
  /** Frames from one connection are processed in order, one at a time. */
  chain: Promise<void>;
}

interface ActiveCall {
  id: string;
  callerId: string;
  calleeId: string;
  communityId: string | null;
  media: 'audio' | 'video';
  status: 'ringing' | 'active';
  timer: NodeJS.Timeout | null;
  /** Serialised database writes for this call (insert before updates). */
  log: Promise<void>;
}

export const CALL_RING_TIMEOUT_MS = 45_000;
const MAX_FRAME_BYTES = 64 * 1024;
const MAX_SIGNAL_BYTES = 24 * 1024;

export class RealtimeHub {
  private conns = new Map<string, Conn>();
  private byUser = new Map<string, Set<string>>();
  private calls = new Map<string, ActiveCall>();
  private limiter = new SlidingWindowLimiter();
  private pending = new Set<Promise<unknown>>();

  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
    private readonly ringTimeoutMs = CALL_RING_TIMEOUT_MS,
  ) {}

  connect(userId: string, socket: SocketLike): string {
    const id = newId(8);
    this.conns.set(id, { id, userId, socket, rooms: new Set(), frames: [], chain: Promise.resolve() });
    if (!this.byUser.has(userId)) this.byUser.set(userId, new Set());
    this.byUser.get(userId)!.add(id);
    this.send(id, { type: 'hello', userId, calls: this.callConfig() });
    return id;
  }

  disconnect(connId: string) {
    const conn = this.conns.get(connId);
    if (!conn) return;
    this.conns.delete(connId);
    const set = this.byUser.get(conn.userId);
    set?.delete(connId);
    if (set && set.size === 0) {
      this.byUser.delete(conn.userId);
      for (const call of [...this.calls.values()]) {
        if (call.callerId === conn.userId || call.calleeId === conn.userId) this.finishCall(call, 'failed', 'peer_disconnected');
      }
    }
  }

  isOnline(userId: string) {
    return (this.byUser.get(userId)?.size ?? 0) > 0;
  }

  callConfig() {
    return {
      enabled: this.config.calls.enabled,
      iceServers: this.config.calls.iceServers,
      hasTurn: this.config.calls.hasTurn,
    };
  }

  private send(connId: string, payload: unknown) {
    const conn = this.conns.get(connId);
    if (!conn) return;
    try {
      conn.socket.send(JSON.stringify(payload));
    } catch {
      this.disconnect(connId);
    }
  }

  sendToUser(userId: string, payload: unknown) {
    for (const id of this.byUser.get(userId) ?? []) this.send(id, payload);
  }

  private error(connId: string, code: string, message: string, ref?: string) {
    this.send(connId, { type: 'error', code, message, ref });
  }

  /** Track a background database write so shutdown and tests can wait for it. */
  private track<T>(p: Promise<T>): Promise<T | undefined> {
    const tracked = p.catch((err: unknown) => {
      console.error('[realtime] database write failed:', err instanceof Error ? err.message : err);
      return undefined;
    });
    this.pending.add(tracked);
    void tracked.finally(() => this.pending.delete(tracked));
    return tracked;
  }

  /** Resolves once queued frames and background writes have finished. */
  async idle(): Promise<void> {
    await Promise.all([...this.conns.values()].map((c) => c.chain));
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  /** Handle one inbound frame from a client. Frames are queued per connection. */
  handle(connId: string, raw: string): Promise<void> {
    const conn = this.conns.get(connId);
    if (!conn) return Promise.resolve();
    if (raw.length > MAX_FRAME_BYTES) {
      this.error(connId, 'too_large', 'Frame too large.');
      return conn.chain;
    }
    const now = Date.now();
    conn.frames = conn.frames.filter((t) => t > now - 1000);
    if (conn.frames.length >= 40) {
      this.error(connId, 'rate_limited', 'Slow down.');
      return conn.chain;
    }
    conn.frames.push(now);
    conn.chain = conn.chain
      .then(() => this.process(conn, raw))
      .catch((err: unknown) => {
        console.error('[realtime] frame failed:', err instanceof Error ? err.message : err);
        this.error(connId, 'server_error', 'Something went wrong handling that message.');
      });
    return conn.chain;
  }

  private async process(conn: Conn, raw: string): Promise<void> {
    const connId = conn.id;
    if (!this.conns.has(connId)) return;
    let msg: { type?: string; [k: string]: unknown };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return this.error(connId, 'bad_json', 'Invalid message.');
    }
    switch (msg.type) {
      case 'ping':
        return this.send(connId, { type: 'pong', t: msg.t ?? null });
      case 'subscribe': {
        const communityId = typeof msg.treeId === 'string' ? msg.treeId : '';
        if (!(await isMember(this.db, communityId, conn.userId))) return this.error(connId, 'not_member', 'Join this Tree to receive its chat.', communityId);
        conn.rooms.add(communityId);
        return this.send(connId, { type: 'subscribed', treeId: communityId });
      }
      case 'unsubscribe':
        if (typeof msg.treeId === 'string') conn.rooms.delete(msg.treeId);
        return;
      case 'call:invite':
        return this.invite(conn, msg);
      case 'call:accept':
        return this.accept(conn, String(msg.callId ?? ''));
      case 'call:reject':
        return this.reject(conn, String(msg.callId ?? ''));
      case 'call:signal':
        return this.signal(conn, String(msg.callId ?? ''), msg.data, raw.length);
      case 'call:end':
        return this.end(conn, String(msg.callId ?? ''));
      default:
        return this.error(connId, 'unknown_type', 'Unknown message type.');
    }
  }

  // ------------------------------------------------------------------ chat

  async broadcastMessage(communityId: string, message: ChatMessage): Promise<void> {
    const subscribed = [...this.conns.values()].filter((conn) => conn.rooms.has(communityId));
    const hidden = new Map<string, Set<string>>();
    for (const userId of new Set(subscribed.map((c) => c.userId))) hidden.set(userId, await hiddenAuthors(this.db, userId));
    for (const conn of subscribed) {
      if (hidden.get(conn.userId)?.has(message.author.id)) continue;
      this.send(conn.id, { type: 'message', treeId: communityId, message: { ...message, mine: message.author.id === conn.userId } });
    }
  }

  broadcastRemoved(communityId: string, messageId: number, reason: 'hidden' | 'deleted') {
    for (const conn of this.conns.values()) {
      if (conn.rooms.has(communityId)) this.send(conn.id, { type: 'message_removed', treeId: communityId, messageId, reason });
    }
  }

  /** Called when someone leaves a Tree so they stop receiving its chat. */
  leaveRoom(userId: string, communityId: string) {
    for (const id of this.byUser.get(userId) ?? []) this.conns.get(id)?.rooms.delete(communityId);
  }

  // ----------------------------------------------------------------- calls

  /** Both users must share a Tree (the given one, if any) and neither may have blocked the other. */
  async canCall(callerId: string, calleeId: string, communityId: string | null): Promise<string | null> {
    if (callerId === calleeId) return 'You cannot call yourself.';
    const blocked = await get(
      this.db,
      "SELECT 1 FROM blocks WHERE kind = 'block' AND ((user_id = ? AND target_user_id = ?) OR (user_id = ? AND target_user_id = ?))",
      [callerId, calleeId, calleeId, callerId],
    );
    if (blocked) return 'Calls are not possible between these listeners.';
    if (communityId) {
      if (!(await isMember(this.db, communityId, callerId)) || !(await isMember(this.db, communityId, calleeId))) return 'You can only call members of a Tree you share.';
    } else {
      const shared = await get(
        this.db,
        'SELECT 1 FROM community_memberships a JOIN community_memberships b ON a.community_id = b.community_id WHERE a.user_id = ? AND b.user_id = ? LIMIT 1',
        [callerId, calleeId],
      );
      if (!shared) return 'You can only call members of a Tree you share.';
    }
    const callee = await get<{ is_demo: number }>(this.db, 'SELECT is_demo FROM users WHERE id = ?', [calleeId]);
    if (!callee) return 'User not found.';
    if (callee.is_demo === 2) return 'Demo listeners are fictional and cannot take calls.';
    return null;
  }

  private busy(userId: string) {
    for (const c of this.calls.values()) if (c.callerId === userId || c.calleeId === userId) return true;
    return false;
  }

  private async invite(conn: Conn, msg: Record<string, unknown>) {
    if (!this.config.calls.enabled) return this.error(conn.id, 'calls_disabled', 'Calls are disabled on this server.');
    if (this.limiter.check(`call:${conn.userId}`, LIMITS.callInvite.limit, LIMITS.callInvite.windowMs) > 0) {
      return this.error(conn.id, 'rate_limited', 'Too many call attempts. Wait a minute.');
    }
    const media = msg.media === 'video' ? 'video' : 'audio';
    const communityId = typeof msg.treeId === 'string' ? msg.treeId : null;
    const calleeId = typeof msg.to === 'string' ? msg.to : '';
    const denied = await this.canCall(conn.userId, calleeId, communityId);
    if (denied) return this.error(conn.id, 'call_denied', denied);
    if (!this.isOnline(calleeId)) return this.error(conn.id, 'callee_offline', 'That listener is not online right now.');
    if (this.busy(conn.userId) || this.busy(calleeId)) return this.error(conn.id, 'busy', 'One of you is already in a call.');

    const [caller, callee] = await Promise.all(
      [conn.userId, calleeId].map(async (id) => (await get<{ handle: string; display_name: string }>(this.db, 'SELECT handle, display_name FROM users WHERE id = ?', [id]))!),
    );
    // Re-check after the awaits: either side may have gone offline or started another call meanwhile.
    if (!this.isOnline(calleeId)) return this.error(conn.id, 'callee_offline', 'That listener is not online right now.');
    if (this.busy(conn.userId) || this.busy(calleeId)) return this.error(conn.id, 'busy', 'One of you is already in a call.');

    const call: ActiveCall = { id: newId(9), callerId: conn.userId, calleeId, communityId, media, status: 'ringing', timer: null, log: Promise.resolve() };
    this.calls.set(call.id, call);
    this.record(call, "INSERT INTO calls (id, caller_id, callee_id, community_id, media, status, created_at) VALUES (?, ?, ?, ?, ?, 'ringing', ?)", [
      call.id, call.callerId, call.calleeId, communityId, media, nowIso(),
    ]);
    const ice = this.callConfig();
    this.sendToUser(conn.userId, { type: 'call:ringing', callId: call.id, media, peer: { id: calleeId, handle: callee.handle, displayName: callee.display_name }, ice });
    this.sendToUser(calleeId, { type: 'call:incoming', callId: call.id, media, treeId: communityId, peer: { id: conn.userId, handle: caller.handle, displayName: caller.display_name }, ice });
    call.timer = setTimeout(() => this.finishCall(call, 'missed', 'no_answer'), this.ringTimeoutMs);
    call.timer.unref?.();
  }

  /** Append a write to the call's log so its rows are written in order. */
  private record(call: ActiveCall, sql: string, params: (string | null)[]) {
    call.log = call.log.then(async () => {
      await this.track(run(this.db, sql, params));
    });
    void this.track(call.log);
  }

  private participant(conn: Conn, callId: string): ActiveCall | null {
    const call = this.calls.get(callId);
    if (!call || (call.callerId !== conn.userId && call.calleeId !== conn.userId)) {
      this.error(conn.id, 'no_call', 'That call is not active.', callId);
      return null;
    }
    return call;
  }

  private accept(conn: Conn, callId: string) {
    const call = this.participant(conn, callId);
    if (!call) return;
    if (call.calleeId !== conn.userId || call.status !== 'ringing') return this.error(conn.id, 'bad_state', 'Only the person being called can answer.', callId);
    if (call.timer) clearTimeout(call.timer);
    call.status = 'active';
    this.record(call, "UPDATE calls SET status = 'active', answered_at = ? WHERE id = ?", [nowIso(), call.id]);
    this.sendToUser(call.callerId, { type: 'call:accepted', callId });
    // Tell the callee's other devices to stop ringing.
    this.sendToUser(call.calleeId, { type: 'call:answered', callId, byConnection: conn.id });
  }

  private reject(conn: Conn, callId: string) {
    const call = this.participant(conn, callId);
    if (!call) return;
    if (call.calleeId !== conn.userId) return this.error(conn.id, 'bad_state', 'Only the person being called can decline.', callId);
    this.finishCall(call, 'rejected', 'declined');
  }

  private signal(conn: Conn, callId: string, data: unknown, size: number) {
    const call = this.participant(conn, callId);
    if (!call) return;
    if (size > MAX_SIGNAL_BYTES) return this.error(conn.id, 'too_large', 'Signalling payload too large.', callId);
    const d = data as { sdp?: { type?: string; sdp?: string }; candidate?: unknown } | null;
    const valid = d && typeof d === 'object' && ((d.sdp && typeof d.sdp.sdp === 'string' && ['offer', 'answer'].includes(String(d.sdp.type))) || d.candidate !== undefined);
    if (!valid) return this.error(conn.id, 'bad_signal', 'Invalid signalling data.', callId);
    if (call.status !== 'active' && !(d?.candidate !== undefined)) return this.error(conn.id, 'bad_state', 'The call has not been answered yet.', callId);
    const other = call.callerId === conn.userId ? call.calleeId : call.callerId;
    this.sendToUser(other, { type: 'call:signal', callId, data: d });
  }

  private end(conn: Conn, callId: string) {
    const call = this.participant(conn, callId);
    if (!call) return;
    this.finishCall(call, 'ended', conn.userId === call.callerId ? 'caller_hung_up' : 'callee_hung_up');
  }

  private finishCall(call: ActiveCall, status: 'ended' | 'rejected' | 'missed' | 'failed', reason: string) {
    if (!this.calls.has(call.id)) return;
    if (call.timer) clearTimeout(call.timer);
    this.calls.delete(call.id);
    this.record(call, 'UPDATE calls SET status = ?, end_reason = ?, ended_at = ? WHERE id = ?', [status, reason, nowIso(), call.id]);
    const payload = { type: 'call:ended', callId: call.id, status, reason };
    this.sendToUser(call.callerId, payload);
    this.sendToUser(call.calleeId, payload);
  }

  activeCallCount() {
    return this.calls.size;
  }

  /** Close everything (server shutdown / tests); resolves once pending writes have finished. */
  async closeAll(): Promise<void> {
    for (const call of [...this.calls.values()]) this.finishCall(call, 'failed', 'server_shutdown');
    for (const conn of [...this.conns.values()]) {
      try {
        conn.socket.close(1001, 'server shutdown');
      } catch {
        /* ignore */
      }
      this.disconnect(conn.id);
    }
    await this.idle();
  }

  async onlineMembers(communityId: string): Promise<string[]> {
    return (await all<{ user_id: string }>(this.db, 'SELECT user_id FROM community_memberships WHERE community_id = ?', [communityId]))
      .map((m) => m.user_id)
      .filter((id) => this.isOnline(id));
  }
}
