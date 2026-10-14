import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { CallController, type CallState } from '../calls';
import { realtime } from '../realtime';
import { Icon } from './Icon';

const CallContext = createContext<CallController | null>(null);

export function CallProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const ref = useRef<CallController | null>(null);
  if (enabled && !ref.current) ref.current = new CallController(realtime());
  return (
    <CallContext.Provider value={enabled ? ref.current : null}>
      {children}
      {enabled && ref.current && <CallOverlay controller={ref.current} />}
    </CallContext.Provider>
  );
}

export function useCalls() {
  return useContext(CallContext);
}

function useCallState(c: CallController): CallState {
  return useSyncExternalStore(
    (fn) => c.subscribe(fn),
    () => c.state,
  );
}

function Video({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

export function CallOverlay({ controller }: { controller: CallController }) {
  const state = useCallState(controller);
  if (state.phase === 'idle') return null;
  const peerName = 'peer' in state && state.peer ? state.peer.displayName : '';

  return (
    <aside className="call-overlay" role={state.phase === 'incoming' ? 'alertdialog' : 'dialog'} aria-live="assertive" aria-label="Call">
      {state.phase === 'requesting-media' && (
        <>
          <strong>Allow microphone{state.media === 'video' ? ' and camera' : ''} access</strong>
          <p className="small muted">Your browser will ask for permission before SOMM calls {peerName}. Nothing is recorded.</p>
        </>
      )}
      {state.phase === 'outgoing' && (
        <>
          <strong>Calling {peerName}…</strong>
          <p className="small muted">{state.media === 'video' ? 'Video' : 'Voice'} call · ringing for up to 45 seconds</p>
          <button type="button" className="btn btn-danger" onClick={() => controller.hangup()}>
            Cancel call
          </button>
        </>
      )}
      {state.phase === 'incoming' && (
        <>
          <strong>
            {peerName} is {state.media === 'video' ? 'video' : 'voice'} calling you
          </strong>
          <p className="small muted">@{state.peer.handle} · from a Tree you share</p>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => void controller.accept()}>
              <Icon name="phone" /> Accept
            </button>
            <button type="button" className="btn btn-danger" onClick={() => controller.reject()}>
              Decline
            </button>
          </div>
        </>
      )}
      {(state.phase === 'connecting' || state.phase === 'connected') && (
        <>
          <div className="row-between">
            <strong>{peerName}</strong>
            <span className="status-pill" data-status={state.phase === 'connected' ? 'open' : 'connecting'}>
              {state.phase === 'connected' ? 'Connected' : 'Connecting…'}
            </span>
          </div>
          {state.media === 'video' ? (
            <div className="call-videos">
              <Video stream={controller.remote} />
              <Video stream={controller.local} muted className="local" />
            </div>
          ) : (
            <audio
              ref={(el) => {
                if (el && controller.remote && el.srcObject !== controller.remote) el.srcObject = controller.remote;
              }}
              autoPlay
            />
          )}
          <div className="row">
            <button type="button" className="icon-btn" aria-pressed={state.muted} aria-label={state.muted ? 'Unmute microphone' : 'Mute microphone'} onClick={() => controller.toggleMute()}>
              <Icon name={state.muted ? 'mic-off' : 'mic'} />
            </button>
            {state.media === 'video' && (
              <button type="button" className="icon-btn" aria-pressed={state.cameraOff} aria-label={state.cameraOff ? 'Turn camera on' : 'Turn camera off'} onClick={() => controller.toggleCamera()}>
                <Icon name="video" />
              </button>
            )}
            <button type="button" className="btn btn-danger" onClick={() => controller.hangup()}>
              End call
            </button>
          </div>
        </>
      )}
      {state.phase === 'ended' && (
        <>
          <strong>{state.reason}</strong>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => controller.hangup()}>
            Close
          </button>
        </>
      )}
      {state.phase === 'error' && (
        <>
          <strong>Call unavailable</strong>
          <p className="small muted" role="alert">
            {state.message}
          </p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => controller.hangup()}>
            Close
          </button>
        </>
      )}
    </aside>
  );
}
