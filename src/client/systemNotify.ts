/**
 * Phone and desktop notifications for new Tree messages.
 *
 *   Android app (Capacitor): local notifications (@capacitor/local-notifications).
 *   Browsers: the service worker shows them (works on Android Chrome too) with
 *   `new Notification` as a fallback; a tap opens the chat.
 *
 * They are shown while SOMM is open or in the background; true push while the
 * app is closed would need a push service and is not used.
 */
import { isNativeApp } from './install';

export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported';

const PREF_KEY = 'somm:notify:system';

/** The listener has turned phone/desktop notifications on in SOMM (they are off until asked). */
export function systemNotificationsWanted(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setSystemNotificationsWanted(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable */
  }
}

async function native() {
  return (await import('@capacitor/local-notifications')).LocalNotifications;
}

export async function notificationPermission(): Promise<NotifyPermission> {
  if (isNativeApp()) {
    try {
      const p = await (await native()).checkPermissions();
      return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'default';
    } catch {
      return 'unsupported'; // an older app without the plugin
    }
  }
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotifyPermission> {
  if (isNativeApp()) {
    try {
      const p = await (await native()).requestPermissions();
      return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'default';
    } catch {
      return 'unsupported';
    }
  }
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.requestPermission();
}

let nextId = Math.floor(Date.now() / 1000) % 1_000_000;

/** Show one notification; `url` is opened when it is tapped. Never throws. */
export async function showSystemNotification(n: { title: string; body: string; url: string; tag: string }): Promise<boolean> {
  try {
    if ((await notificationPermission()) !== 'granted') return false;
    if (isNativeApp()) {
      await (await native()).schedule({ notifications: [{ id: nextId++, title: n.title, body: n.body, extra: { url: n.url }, group: n.tag }] });
      return true;
    }
    const icon = '/icons/icon-192.png';
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) {
      await reg.showNotification(n.title, { body: n.body, tag: n.tag, icon, badge: icon, data: { url: n.url } });
      return true;
    }
    const shown = new Notification(n.title, { body: n.body, tag: n.tag, icon });
    shown.onclick = () => {
      window.focus();
      window.location.assign(n.url);
    };
    return true;
  } catch {
    return false;
  }
}

/** Android app: open the chat when a notification is tapped. Returns a cleanup function. */
export async function onNativeNotificationTap(open: (url: string) => void): Promise<() => void> {
  if (!isNativeApp()) return () => undefined;
  try {
    const handle = await (await native()).addListener('localNotificationActionPerformed', (e) => {
      const url = (e.notification.extra as { url?: string } | undefined)?.url;
      if (url) open(url);
    });
    return () => void handle.remove();
  } catch {
    return () => undefined;
  }
}
