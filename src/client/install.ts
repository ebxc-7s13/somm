/**
 * Installable app support: registers the service worker (production builds only)
 * and keeps the browser's deferred install prompt so Settings can offer it.
 */
import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function setupInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err: unknown) => console.warn('[somm] service worker registration failed', err));
    });
  }
}

/** Running inside the Android app shell (Capacitor injects its bridge into the page). */
export function isNativeApp(): boolean {
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as { standalone?: boolean }).standalone === true;
}

export function useInstallApp() {
  const [, rerender] = useState(0);
  useEffect(() => {
    const l = () => rerender((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return {
    native: isNativeApp(),
    standalone: isStandalone(),
    canPrompt: deferred !== null,
    ios: /iphone|ipad|ipod/i.test(navigator.userAgent),
    async install(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
      const e = deferred;
      if (!e) return 'unavailable';
      deferred = null;
      notify();
      await e.prompt();
      return (await e.userChoice).outcome;
    },
  };
}
