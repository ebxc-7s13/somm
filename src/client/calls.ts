/**
 * 1:1 WebRTC calls. Signalling goes through SOMM's WebSocket (authorised on the
 * server); media flows peer-to-peer or through a configured TURN relay.
 */
import type { RealtimeClient } from './realtime';

export interface Peer {
  id: string;
  handle: string;
  displayName: string;
}

export type CallState =
  | { phase: 'idle' }
  | { phase: 'requesting-media'; peer: Peer; media: 'audio' | 'video' }
  | { phase: 'outgoing'; callId: string | null; peer: Peer; media: 'audio' | 'video' }
  | { phase: 'incoming'; callId: string; peer: Peer; media: 'audio' | 'video' }
  | { phase: 'connecting' | 'connected'; callId: string; peer: Peer; media: 'audio' | 'video'; muted: boolean; cameraOff: boolean }
  | { phase: 'ended'; peer: Peer | null; reason: string }
  | { phase: 'error'; peer: Peer | null; message: string };

type Ice = { iceServers: RTCIceServer[]; hasTurn: boolean };

const END_REASONS: Record<string, string> = {
  declined: 'Call declined.',
  no_answer: 'No answer.',
  caller_hung_up: 'Call ended.',
  callee_hung_up: 'Call ended.',
  peer_disconnected: 'The other person disconnected.',
  server_shutdown: 'The server restarted.',
};

function mediaError(err: unknown): string {
  const name = (err as DOMException)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone/camera permission was denied. Allow access in your browser settings to call.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone or camera was found on this device.';
  if (name === 'NotReadableError') return 'Your microphone or camera is in use by another app.';
  return 'Could not access your microphone or camera.';
}

export class CallController {
  state: CallState = { phase: 'idle' };
  local: MediaStream | null = null;
  remote: MediaStream | null = null;
  private pc: RTCPeerConnection | null = null;
  private ice: Ice = { iceServers: [], hasTurn: false };
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private listeners = new Set<() => void>();
  private resetTimer: number | null = null;

  constructor(private readonly rt: RealtimeClient) {
    rt.on('hello', (m) => {
      if (m.calls?.iceServers) this.ice = { iceServers: m.calls.iceServers, hasTurn: !!m.calls.hasTurn };
    });
    rt.on('call:ringing', (m) => {
      if (this.state.phase === 'outgoing') this.set({ ...this.state, callId: m.callId });
      if (m.ice) this.ice = m.ice;
    });
    rt.on('call:incoming', (m) => {
      if (this.state.phase !== 'idle' && this.state.phase !== 'ended' && this.state.phase !== 'error') {
        rt.send({ type: 'call:reject', callId: m.callId });
        return;
      }
      if (m.ice) this.ice = m.ice;
      this.set({ phase: 'incoming', callId: m.callId, peer: m.peer, media: m.media });
    });
    rt.on('call:answered', (m) => {
      if (this.state.phase === 'incoming' && this.state.callId === m.callId) this.set({ phase: 'idle' });
    });
    rt.on('call:accepted', (m) => void this.onAccepted(m.callId));
    rt.on('call:signal', (m) => void this.onSignal(m.callId, m.data));
    rt.on('call:ended', (m) => this.finish(END_REASONS[m.reason] ?? (m.status === 'missed' ? 'No answer.' : 'Call ended.')));
    rt.on('error', (m) => {
      if (['call_denied', 'callee_offline', 'busy', 'calls_disabled', 'rate_limited', 'no_call', 'bad_state'].includes(m.code) && this.state.phase !== 'idle') {
        if (m.code === 'bad_state' || m.code === 'no_call') return;
        this.cleanup();
        this.set({ phase: 'error', peer: 'peer' in this.state ? (this.state.peer as Peer) : null, message: m.message });
      }
    });
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(s: CallState) {
    this.state = s;
    if (this.resetTimer) window.clearTimeout(this.resetTimer);
    if (s.phase === 'ended' || s.phase === 'error') this.resetTimer = window.setTimeout(() => this.set({ phase: 'idle' }), 6000);
    for (const fn of this.listeners) fn();
  }

  get supported(): boolean {
    return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof RTCPeerConnection !== 'undefined';
  }

  async start(peer: Peer, media: 'audio' | 'video', treeId?: string) {
    if (!this.supported) return this.set({ phase: 'error', peer, message: 'This browser does not support calls.' });
    if (this.state.phase !== 'idle' && this.state.phase !== 'ended' && this.state.phase !== 'error') return;
    this.set({ phase: 'requesting-media', peer, media });
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: media === 'video' });
    } catch (err) {
      return this.set({ phase: 'error', peer, message: mediaError(err) });
    }
    if (!this.rt.send({ type: 'call:invite', to: peer.id, media, treeId })) {
      this.cleanup();
      return this.set({ phase: 'error', peer, message: 'Not connected to SOMM right now. Try again in a moment.' });
    }
    this.set({ phase: 'outgoing', callId: null, peer, media });
  }

  async accept() {
    if (this.state.phase !== 'incoming') return;
    const { callId, peer, media } = this.state;
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: media === 'video' });
    } catch (err) {
      this.rt.send({ type: 'call:reject', callId });
      return this.set({ phase: 'error', peer, message: mediaError(err) });
    }
    this.createPeer(callId);
    this.rt.send({ type: 'call:accept', callId });
    this.set({ phase: 'connecting', callId, peer, media, muted: false, cameraOff: false });
  }

  reject() {
    if (this.state.phase !== 'incoming') return;
    this.rt.send({ type: 'call:reject', callId: this.state.callId });
    this.set({ phase: 'idle' });
  }

  hangup() {
    const s = this.state;
    if ((s.phase === 'outgoing' && s.callId) || s.phase === 'connecting' || s.phase === 'connected') {
      this.rt.send({ type: 'call:end', callId: s.callId });
    }
    this.finish('Call ended.');
  }

  toggleMute() {
    if (this.state.phase !== 'connecting' && this.state.phase !== 'connected') return;
    const muted = !this.state.muted;
    this.local?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.set({ ...this.state, muted });
  }

  toggleCamera() {
    if (this.state.phase !== 'connecting' && this.state.phase !== 'connected') return;
    const cameraOff = !this.state.cameraOff;
    this.local?.getVideoTracks().forEach((t) => (t.enabled = !cameraOff));
    this.set({ ...this.state, cameraOff });
  }

  private createPeer(callId: string) {
    const pc = new RTCPeerConnection({ iceServers: this.ice.iceServers });
    this.pc = pc;
    this.remote = new MediaStream();
    for (const t of this.local?.getTracks() ?? []) pc.addTrack(t, this.local!);
    pc.ontrack = (ev) => {
      for (const t of ev.streams[0]?.getTracks() ?? [ev.track]) this.remote!.addTrack(t);
      for (const fn of this.listeners) fn();
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.rt.send({ type: 'call:signal', callId, data: { candidate: ev.candidate.toJSON() } });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected' && (this.state.phase === 'connecting' || this.state.phase === 'connected')) {
        this.set({ ...this.state, phase: 'connected' });
      }
      if (pc.connectionState === 'failed') {
        const peer = 'peer' in this.state ? (this.state.peer as Peer) : null;
        this.rt.send({ type: 'call:end', callId });
        this.cleanup();
        this.set({
          phase: 'error',
          peer,
          message: this.ice.hasTurn
            ? 'The call could not connect.'
            : 'The call could not connect. This network may need a TURN relay, which this server has not configured.',
        });
      }
    };
    return pc;
  }

  private async onAccepted(callId: string) {
    if (this.state.phase !== 'outgoing') return;
    const { peer, media } = this.state;
    const pc = this.createPeer(callId);
    this.set({ phase: 'connecting', callId, peer, media, muted: false, cameraOff: false });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.rt.send({ type: 'call:signal', callId, data: { sdp: { type: offer.type, sdp: offer.sdp } } });
  }

  private async onSignal(callId: string, data: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) {
    const pc = this.pc;
    if (!pc || !('callId' in this.state) || this.state.callId !== callId) return;
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        for (const c of this.pendingCandidates.splice(0)) await pc.addIceCandidate(c);
        if (data.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.rt.send({ type: 'call:signal', callId, data: { sdp: { type: answer.type, sdp: answer.sdp } } });
        }
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
        else this.pendingCandidates.push(data.candidate);
      }
    } catch {
      /* A bad candidate should not end the call; connectionstatechange reports real failures. */
    }
  }

  private cleanup() {
    this.pc?.close();
    this.pc = null;
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
    this.remote = null;
    this.pendingCandidates = [];
  }

  private finish(reason: string) {
    const peer = 'peer' in this.state ? (this.state.peer as Peer) : null;
    const wasActive = this.state.phase !== 'idle';
    this.cleanup();
    if (wasActive) this.set({ phase: 'ended', peer, reason });
  }
}
