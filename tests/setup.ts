import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'production' : 'test';

// jsdom lacks a few browser APIs the client uses.
if (typeof window !== 'undefined') {
  class RO {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(target: Element) {
      this.cb([{ target, contentRect: { width: 800, height: 600 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver ??= RO;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  window.scrollTo = () => {};
  // jsdom has no canvas: behave like a browser without canvas support (and skip its "not implemented" noise).
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  Element.prototype.scrollIntoView ??= () => {};
  // Testing Library only auto-cleans with Vitest globals enabled; unmount explicitly.
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => cleanup());
}
