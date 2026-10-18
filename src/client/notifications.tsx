/**
 * Tree chat notifications: unread counts for badges, an in-app notice when a new
 * message arrives in one of your Trees, and a phone/desktop notification while
 * SOMM is in the background (when the listener has turned those on).
 *
 * Checks every 45 seconds while SOMM is visible and every 3 minutes in the
 * background — cheap on serverless hosts — and right away when SOMM comes back
 * into view or the listener opens a Tree. After 30 minutes without any use the
 * checks pause (so a forgotten tab does not keep the database awake) and resume
 * on the next tap, click, key or scroll.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isIdle, onActive } from './activity';
import { api } from './api';
import { useLocation, useNavigate } from './router';
import { useAuth, useToast } from './state';
import { onNativeNotificationTap, showSystemNotification, systemNotificationsWanted } from './systemNotify';
import type { TreeActivity } from './types';

const VISIBLE_MS = 45_000;
const HIDDEN_MS = 180_000;

interface NotificationsState {
  totalUnread: number;
  trees: TreeActivity[];
  refresh: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsState>({ totalUnread: 0, trees: [], refresh: async () => undefined });

export function useNotifications() {
  return useContext(NotificationsContext);
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [data, setData] = useState<{ totalUnread: number; trees: TreeActivity[] }>({ totalUnread: 0, trees: [] });
  /** Newest message id seen per Tree; null until the first check (which never alerts). */
  const seen = useRef<Map<string, number> | null>(null);
  const path = useRef(pathname);
  path.current = pathname;
  const busy = useRef(false);
  const signedIn = !!me;

  const refresh = useCallback(async () => {
    if (!signedIn || busy.current) return;
    busy.current = true;
    try {
      const r = await api.get<{ trees: TreeActivity[]; totalUnread: number }>('/api/notifications');
      const previous = seen.current;
      const next = new Map<string, number>();
      for (const t of r.trees) {
        const last = t.lastMessage;
        next.set(t.id, last?.id ?? 0);
        if (!previous || !last || last.mine || t.unread === 0 || last.id <= (previous.get(t.id) ?? 0)) continue;
        const chat = `/trees/${t.slug}/chat`;
        const visible = document.visibilityState === 'visible';
        if (visible && path.current === chat) continue; // the chat shows it already
        const text = `${last.author}: ${last.excerpt}`;
        if (visible) toast(`New in ${t.name} · ${text}`, 'info', { label: 'Open', to: chat });
        else if (systemNotificationsWanted()) void showSystemNotification({ title: t.name, body: text, url: chat, tag: `tree-${t.id}` });
      }
      seen.current = next;
      setData({ totalUnread: r.totalUnread, trees: r.trees });
    } catch {
      /* offline or signed out: the next check tries again */
    } finally {
      busy.current = false;
    }
  }, [signedIn, toast]);

  useEffect(() => {
    if (!signedIn) {
      seen.current = null;
      setData({ totalUnread: 0, trees: [] });
      return;
    }
    let stopped = false;
    let paused = false;
    let timer = 0;
    const schedule = () => {
      if (stopped) return;
      if (isIdle()) {
        paused = true;
        return;
      }
      timer = window.setTimeout(
        () => void refresh().then(schedule),
        document.visibilityState === 'visible' ? VISIBLE_MS : HIDDEN_MS,
      );
    };
    void refresh().then(schedule);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    const offActive = onActive(() => {
      if (!paused) return;
      paused = false;
      void refresh().then(schedule);
    });
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      stopped = true;
      offActive();
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [signedIn, refresh]);

  // Opening a Tree reads its messages: update the badges shortly after.
  useEffect(() => {
    if (!signedIn || !pathname.startsWith('/trees')) return;
    const t = window.setTimeout(() => void refresh(), 1500);
    return () => window.clearTimeout(t);
  }, [signedIn, pathname, refresh]);

  // Android app: a tapped notification opens its chat.
  useEffect(() => {
    let off = () => undefined as void;
    void onNativeNotificationTap((url) => navigate(url)).then((f) => (off = f));
    return () => off();
  }, [navigate]);

  const value = useMemo(() => ({ ...data, refresh }), [data, refresh]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
