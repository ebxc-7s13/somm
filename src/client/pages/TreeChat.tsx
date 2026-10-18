import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { isIdle } from '../activity';
import { api, ApiError, errorMessage } from '../api';
import { useClientConfig } from '../clientConfig';
import { Icon } from '../components/Icon';
import { ErrorState, Loading } from '../components/States';
import { canHover } from '../fx/motion';
import { realtime, type RealtimeStatus } from '../realtime';
import { Link } from '../router';
import { useToast } from '../state';
import type { ChatMessage, LibraryPage, TreeSummary } from '../types';

const MAX = 1000;
const REASONS = [
  ['spam', 'Spam'],
  ['harassment', 'Harassment'],
  ['hate', 'Hate'],
  ['sexual', 'Sexual content'],
  ['copyright', 'Copyright'],
  ['other', 'Something else'],
] as const;

const STATUS_TEXT: Record<RealtimeStatus, string> = {
  idle: 'Connecting…',
  connecting: 'Connecting…',
  open: 'Live',
  reconnecting: 'Reconnecting…',
  closed: 'Offline — messages will sync',
};

function time(iso: string) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function mergeMessages(prev: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

function TrackPicker({ onPick, onClose }: { onPick: (t: { id: string; label: string }) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<LibraryPage['tracks']>([]);
  useEffect(() => {
    const t = window.setTimeout(async () => {
      try {
        const r = await api.get<LibraryPage>(`/api/library/tracks?pageSize=8&sort=title${q ? `&q=${encodeURIComponent(q)}` : ''}`);
        setRows(r.tracks);
      } catch {
        setRows([]);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);
  return (
    <div className="panel panel-tight" style={{ background: 'var(--surface-2)' }}>
      <div className="row-between">
        <label htmlFor="pick-q" className="label">
          Share a track from your library
        </label>
        <button type="button" className="link-btn small" onClick={onClose}>
          Cancel
        </button>
      </div>
      <input id="pick-q" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your library…" autoFocus />
      <ul className="list-plain" style={{ gap: 4, marginTop: 8 }}>
        {rows.map((t) => (
          <li key={t.id}>
            <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => onPick({ id: t.id, label: `${t.title} — ${t.artist.name}` })}>
              <Icon name="note" size={16} /> <span className="truncate">{t.title} — {t.artist.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TreeChat({ tree, isModerator }: { tree: TreeSummary; isModerator: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>(realtime().status);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [ref, setRef] = useState<{ id: string; label: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [reporting, setReporting] = useState<ChatMessage | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastId = useRef(0);
  const toast = useToast();

  useEffect(() => {
    lastId.current = messages.length ? messages[messages.length - 1]!.id : lastId.current;
  }, [messages]);

  const loadLatest = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await api.get<{ messages: ChatMessage[]; hasMore: boolean }>(`/api/trees/${tree.slug}/messages?limit=50`);
      setMessages(r.messages);
      setHasMore(r.hasMore);
      stickToBottom.current = true;
    } catch (err) {
      setLoadError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }, [tree.slug]);

  const fillGap = useCallback(async () => {
    if (!lastId.current) return loadLatest();
    try {
      let after = lastId.current;
      for (let i = 0; i < 5; i++) {
        const r = await api.get<{ messages: ChatMessage[]; hasMore: boolean }>(`/api/trees/${tree.slug}/messages?after=${after}&limit=100`);
        setMessages((prev) => mergeMessages(prev, r.messages));
        if (!r.hasMore || r.messages.length === 0) break;
        after = r.messages[r.messages.length - 1]!.id;
      }
    } catch {
      /* the next reconnect will try again */
    }
  }, [tree.slug, loadLatest]);

  /** Quietly reload the latest page: picks up hidden and deleted messages without a spinner. */
  const refreshLatest = useCallback(async () => {
    try {
      const r = await api.get<{ messages: ChatMessage[]; hasMore: boolean }>(`/api/trees/${tree.slug}/messages?limit=50`);
      const ids = new Set(r.messages.map((m) => m.id));
      const oldest = r.messages[0]?.id ?? Infinity;
      setMessages((prev) => mergeMessages(prev.filter((m) => m.id < oldest || ids.has(m.id)), r.messages));
    } catch {
      /* try again on the next tick */
    }
  }, [tree.slug]);

  const cfg = useClientConfig();
  const polling = cfg?.realtime === 'poll';

  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);

  // Serverless hosts have no WebSocket push: check for new messages every few seconds while
  // the page is visible and in use, and reload the latest page each minute for hidden or deleted ones.
  useEffect(() => {
    if (!polling) return;
    let ticks = 0;
    const tick = () => {
      if (document.visibilityState !== 'visible' || isIdle()) return;
      ticks++;
      void (ticks % 15 === 0 || !lastId.current ? refreshLatest() : fillGap());
    };
    const timer = window.setInterval(tick, 4000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [polling, fillGap, refreshLatest]);

  useEffect(() => {
    if (!cfg || polling) return;
    const rt = realtime();
    rt.connect();
    rt.subscribe(tree.id);
    const offs = [
      rt.on('status', (m) => setStatus(m.status)),
      rt.on('message', (m) => {
        if (m.treeId === tree.id) setMessages((prev) => mergeMessages(prev, [m.message]));
      }),
      rt.on('message_removed', (m) => {
        if (m.treeId !== tree.id) return;
        setMessages((prev) =>
          m.reason === 'deleted' ? prev.filter((x) => x.id !== m.messageId) : prev.map((x) => (x.id === m.messageId ? { ...x, hidden: true, body: null, link: null } : x)),
        );
      }),
      rt.on('reconnected', () => void fillGap()),
    ];
    setStatus(rt.status);
    return () => {
      offs.forEach((off) => off());
      rt.unsubscribe(tree.id);
    };
  }, [cfg, polling, tree.id, fillGap]);

  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const loadEarlier = async () => {
    const first = messages[0];
    if (!first) return;
    const el = logRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    stickToBottom.current = false;
    try {
      const r = await api.get<{ messages: ChatMessage[]; hasMore: boolean }>(`/api/trees/${tree.slug}/messages?before=${first.id}&limit=50`);
      setMessages((prev) => mergeMessages(prev, r.messages));
      setHasMore(r.hasMore);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const send = async () => {
    const body = draft.trim();
    if ((!body && !ref) || body.length > MAX) return;
    setSending(true);
    setSendError(null);
    try {
      const r = await api.post<{ message: ChatMessage }>(`/api/trees/${tree.slug}/messages`, { body, replyToId: replyTo?.id ?? null, ref: ref ? { type: 'track', id: ref.id } : null });
      stickToBottom.current = true;
      setMessages((prev) => mergeMessages(prev, [r.message]));
      setDraft('');
      setReplyTo(null);
      setRef(null);
    } catch (err) {
      setSendError(err instanceof ApiError && err.isNetwork ? 'Not sent — you seem to be offline. Your message is kept; try again.' : errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const action = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  if (loading && messages.length === 0) return <Loading label="Loading chat…" lines={5} />;
  if (loadError && messages.length === 0) return <ErrorState error={loadError} onRetry={loadLatest} />;

  return (
    <section className="chat" aria-label={`${tree.name} chat`}>
      <div className="chat-head">
        <strong className="truncate">{tree.name}</strong>
        <span className="status-pill" data-status={polling ? 'open' : status} role="status" aria-live="polite">
          {polling ? 'Updates every few seconds' : STATUS_TEXT[status]}
        </span>
      </div>
      <div
        className="chat-log"
        ref={logRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {hasMore && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'center' }} onClick={loadEarlier}>
            Load earlier messages
          </button>
        )}
        {messages.length === 0 && <p className="muted small" style={{ alignSelf: 'center' }}>No messages yet. Start with a song you think this Tree should hear.</p>}
        {messages.map((m) => (
          <article key={m.id} className="msg" data-mine={m.mine} aria-label={`${m.author.displayName} at ${time(m.createdAt)}`}>
            <div className="msg-meta">
              <strong>{m.author.displayName}</strong>
              <span>@{m.author.handle}</span>
              <time dateTime={m.createdAt}>{time(m.createdAt)}</time>
            </div>
            {m.replyTo && (
              <div className="msg-reply">
                Replying to {m.replyTo.author}: {m.replyTo.excerpt ?? 'hidden message'}
              </div>
            )}
            {m.hidden ? <p className="msg-hidden" style={{ margin: 0 }}>This message was hidden pending review.</p> : m.body && <div className="msg-body">{m.body}</div>}
            {m.ref && !m.hidden && m.ref.type === 'playlist' && (
              <Link to={`/trees/${tree.slug}/music?p=${encodeURIComponent(m.ref.id)}`} className="msg-ref msg-ref-playlist">
                <Icon name="list" size={14} /> <span className="truncate">Shared playlist: {m.ref.label}</span>
              </Link>
            )}
            {m.ref && !m.hidden && m.ref.type !== 'playlist' && (
              <span className="msg-ref">
                <Icon name="note" size={14} /> <span className="truncate">{m.ref.label}</span>
              </span>
            )}
            {m.link && !m.hidden && (
              <a className="msg-link" href={m.link.url} target="_blank" rel="noopener noreferrer nofollow ugc">
                <Icon name="link" size={14} /> {m.link.provider ? `Open in ${m.link.provider}` : new URL(m.link.url).hostname} ↗
              </a>
            )}
            {!m.hidden && (
              <div className="msg-actions">
                <button type="button" onClick={() => setReplyTo(m)}>
                  Reply
                </button>
                {m.mine ? (
                  <button type="button" onClick={() => action(() => api.del(`/api/trees/${tree.slug}/messages/${m.id}`).then(() => setMessages((p) => p.filter((x) => x.id !== m.id))), 'Message deleted.')}>
                    Delete
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={() => setReporting(m)}>
                      Report
                    </button>
                    <button type="button" onClick={() => action(() => api.post('/api/blocks', { handle: m.author.handle, kind: 'mute' }).then(loadLatest), `Muted @${m.author.handle}.`)}>
                      Mute
                    </button>
                    {isModerator && (
                      <button type="button" onClick={() => action(() => api.post(`/api/trees/${tree.slug}/messages/${m.id}/hide`), 'Message hidden.')}>
                        Hide
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
      <div className="composer">
        {reporting && (
          <form
            className="panel panel-tight"
            onSubmit={async (e) => {
              e.preventDefault();
              const reason = new FormData(e.currentTarget).get('reason');
              await action(() => api.post('/api/reports', { targetType: 'message', targetId: String(reporting.id), reason }), 'Report sent. Thank you.');
              setReporting(null);
            }}
          >
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label">Report this message from @{reporting.author.handle}</legend>
              <div className="row" style={{ marginTop: 8 }}>
                {REASONS.map(([v, l]) => (
                  <label key={v} className="chip" style={{ cursor: 'pointer' }}>
                    <input type="radio" name="reason" value={v} defaultChecked={v === 'spam'} /> {l}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="row" style={{ marginTop: 8 }}>
              <button type="submit" className="btn btn-danger btn-sm">
                Send report
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReporting(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}
        {picking && <TrackPicker onPick={(t) => (setRef(t), setPicking(false))} onClose={() => setPicking(false)} />}
        {(replyTo || ref) && (
          <div className="row small">
            {replyTo && (
              <span className="chip">
                Replying to {replyTo.author.displayName}
                <button type="button" className="link-btn" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>
                  ×
                </button>
              </span>
            )}
            {ref && (
              <span className="chip">
                <Icon name="note" size={14} /> {ref.label}
                <button type="button" className="link-btn" aria-label="Remove shared track" onClick={() => setRef(null)}>
                  ×
                </button>
              </span>
            )}
          </div>
        )}
        <div className="composer-row">
          <button type="button" className="icon-btn" aria-label="Share a track from your library" onClick={() => setPicking((p) => !p)}>
            <Icon name="note" />
          </button>
          <Link to={`/trees/${tree.slug}/music`} className="icon-btn" aria-label="Share a playlist with this Tree" title="Share a playlist">
            <Icon name="list" />
          </Link>
          <label htmlFor="chat-input" className="sr-only">
            Message {tree.name}
          </label>
          <textarea
            id="chat-input"
            className="textarea"
            rows={1}
            value={draft}
            maxLength={MAX + 50}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            placeholder={canHover() ? 'Talk about music… (Enter to send, Shift+Enter for a new line)' : 'Talk about music…'}
            aria-describedby="chat-count"
          />
          <button type="button" className="btn btn-primary" onClick={() => void send()} disabled={sending || (!draft.trim() && !ref) || draft.length > MAX}>
            Send
          </button>
        </div>
        <div className="row-between xsmall">
          <span id="chat-count" className={draft.length > MAX ? 'error-text' : 'faint'}>
            {draft.length}/{MAX}
          </span>
          {sendError && (
            <span className="error-text" role="alert">
              {sendError}
            </span>
          )}
          <Link to={`/trees/${tree.slug}/members`} className="faint">
            Members & safety
          </Link>
        </div>
      </div>
    </section>
  );
}
