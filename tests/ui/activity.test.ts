// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDLE_AFTER_MS, isIdle, onActive } from '../../src/client/activity';

afterEach(() => vi.useRealTimers());

describe('activity tracking for background checks', () => {
  it('goes idle after 30 minutes without use and wakes listeners on the next interaction', () => {
    vi.useFakeTimers();
    window.dispatchEvent(new Event('pointerdown'));
    expect(isIdle()).toBe(false);
    const woke = vi.fn();
    const off = onActive(woke);

    vi.advanceTimersByTime(IDLE_AFTER_MS - 1000);
    expect(isIdle()).toBe(false);
    window.dispatchEvent(new Event('keydown'));
    expect(woke).not.toHaveBeenCalled(); // never idle, nothing to resume

    vi.advanceTimersByTime(IDLE_AFTER_MS + 1000);
    expect(isIdle()).toBe(true);
    window.dispatchEvent(new Event('scroll'));
    expect(woke).toHaveBeenCalledTimes(1);
    expect(isIdle()).toBe(false);

    off();
    vi.advanceTimersByTime(IDLE_AFTER_MS + 1000);
    window.dispatchEvent(new Event('pointerdown'));
    expect(woke).toHaveBeenCalledTimes(1);
  });
});
