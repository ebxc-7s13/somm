/**
 * When the listener last touched SOMM. Background checks (notifications, chat
 * polling) stop once nobody has used the page for a while, so a tab left open
 * all day does not keep the free database awake; any tap, click, key or scroll
 * resumes them.
 */
let last = Date.now();
const listeners = new Set<() => void>();
let installed = false;

/** Stop background checks after this long without any interaction. */
export const IDLE_AFTER_MS = 30 * 60_000;

function touch() {
  const wasIdle = isIdle();
  last = Date.now();
  if (wasIdle) for (const fn of listeners) fn();
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const) {
    window.addEventListener(type, touch, { passive: true, capture: true });
  }
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && touch());
}

export function isIdle(now = Date.now()): boolean {
  install();
  return now - last > IDLE_AFTER_MS;
}

/** Called when the listener comes back after being idle. Returns an unsubscribe function. */
export function onActive(fn: () => void): () => void {
  install();
  listeners.add(fn);
  return () => listeners.delete(fn);
}
