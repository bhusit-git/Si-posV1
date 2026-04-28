import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PRINT_LIFECYCLE_FALLBACK_CLOSE_MS,
  PRINT_LIFECYCLE_FOCUS_GRACE_MS,
  PRINT_LIFECYCLE_PRINT_DELAY_MS,
  startPrintWindowLifecycle,
} from "@/lib/print-window-lifecycle";

type ListenerMap = Map<string, Set<EventListener>>;

function addListener(map: ListenerMap, type: string, listener: EventListener): void {
  const listeners = map.get(type) ?? new Set<EventListener>();
  listeners.add(listener);
  map.set(type, listeners);
}

function removeListener(map: ListenerMap, type: string, listener: EventListener): void {
  const listeners = map.get(type);
  if (!listeners) return;
  listeners.delete(listener);
  if (listeners.size === 0) {
    map.delete(type);
  }
}

function dispatch(map: ListenerMap, type: string, event: Event): void {
  for (const listener of map.get(type) ?? []) {
    listener(event);
  }
}

function createLifecycleTarget() {
  const windowListeners: ListenerMap = new Map();
  const documentListeners: ListenerMap = new Map();
  let visibilityState = "visible";
  let nextAnimationFrameHandle = 1;

  const target = {
    addEventListener(type: string, listener: EventListener) {
      addListener(windowListeners, type, listener);
    },
    removeEventListener(type: string, listener: EventListener) {
      removeListener(windowListeners, type, listener);
    },
    setTimeout(handler: () => void, timeout?: number) {
      return window.setTimeout(handler, timeout);
    },
    clearTimeout(handle: number) {
      window.clearTimeout(handle);
    },
    requestAnimationFrame(callback: FrameRequestCallback) {
      const handle = nextAnimationFrameHandle++;
      window.setTimeout(() => callback(0), 0);
      return handle;
    },
    cancelAnimationFrame(handle: number) {
      return handle;
    },
    print: vi.fn(),
    close: vi.fn(),
    performance: {
      now: () => Date.now(),
    },
    document: {
      addEventListener(type: string, listener: EventListener) {
        addListener(documentListeners, type, listener);
      },
      removeEventListener(type: string, listener: EventListener) {
        removeListener(documentListeners, type, listener);
      },
      get visibilityState() {
        return visibilityState;
      },
      readyState: "complete",
    },
  };

  return {
    target,
    dispatchWindow(type: string) {
      dispatch(windowListeners, type, new Event(type));
    },
    dispatchDocument(type: string) {
      dispatch(documentListeners, type, new Event(type));
    },
    setVisibilityState(nextState: "visible" | "hidden") {
      visibilityState = nextState;
      dispatch(documentListeners, "visibilitychange", new Event("visibilitychange"));
    },
  };
}

function advancePastAnimationFrames(): void {
  vi.advanceTimersByTime(1);
  vi.advanceTimersByTime(1);
}

describe("print-window-lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("prints exactly once after the lifecycle delay", () => {
    const lifecycle = createLifecycleTarget();

    startPrintWindowLifecycle(lifecycle.target, { autoClose: false });
    advancePastAnimationFrames();

    expect(lifecycle.target.print).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(lifecycle.target.print).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60);
    expect(lifecycle.target.print).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(lifecycle.target.print).toHaveBeenCalledTimes(1);
  });

  it("does not close before print starts", () => {
    const lifecycle = createLifecycleTarget();

    startPrintWindowLifecycle(lifecycle.target, { autoClose: true });
    advancePastAnimationFrames();

    lifecycle.dispatchWindow("focus");
    lifecycle.dispatchWindow("afterprint");
    vi.advanceTimersByTime(0);

    expect(lifecycle.target.close).not.toHaveBeenCalled();
  });

  it("closes immediately after afterprint", () => {
    const lifecycle = createLifecycleTarget();

    startPrintWindowLifecycle(lifecycle.target, { autoClose: true });
    advancePastAnimationFrames();

    vi.advanceTimersByTime(PRINT_LIFECYCLE_PRINT_DELAY_MS);
    expect(lifecycle.target.print).toHaveBeenCalledTimes(1);

    lifecycle.dispatchWindow("afterprint");
    vi.advanceTimersByTime(0);

    expect(lifecycle.target.close).toHaveBeenCalledTimes(1);
  });

  it("closes on focus after the grace period when afterprint never fires", () => {
    const lifecycle = createLifecycleTarget();

    startPrintWindowLifecycle(lifecycle.target, { autoClose: true });
    advancePastAnimationFrames();

    vi.advanceTimersByTime(PRINT_LIFECYCLE_PRINT_DELAY_MS);
    expect(lifecycle.target.print).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(PRINT_LIFECYCLE_FOCUS_GRACE_MS - 250);
    lifecycle.dispatchWindow("focus");
    vi.advanceTimersByTime(0);
    expect(lifecycle.target.close).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    lifecycle.dispatchWindow("focus");
    vi.advanceTimersByTime(0);
    expect(lifecycle.target.close).toHaveBeenCalledTimes(1);
  });

  it("force-closes on the fallback timeout", () => {
    const lifecycle = createLifecycleTarget();

    startPrintWindowLifecycle(lifecycle.target, { autoClose: true });
    advancePastAnimationFrames();

    vi.advanceTimersByTime(PRINT_LIFECYCLE_PRINT_DELAY_MS);
    expect(lifecycle.target.print).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(PRINT_LIFECYCLE_FALLBACK_CLOSE_MS - PRINT_LIFECYCLE_PRINT_DELAY_MS);
    vi.advanceTimersByTime(0);

    expect(lifecycle.target.close).toHaveBeenCalledTimes(1);
  });

  it("never closes more than once", () => {
    const lifecycle = createLifecycleTarget();

    startPrintWindowLifecycle(lifecycle.target, { autoClose: true });
    advancePastAnimationFrames();

    vi.advanceTimersByTime(PRINT_LIFECYCLE_PRINT_DELAY_MS);
    lifecycle.dispatchWindow("afterprint");
    vi.advanceTimersByTime(0);

    lifecycle.dispatchWindow("focus");
    lifecycle.setVisibilityState("hidden");
    vi.advanceTimersByTime(PRINT_LIFECYCLE_FALLBACK_CLOSE_MS);

    expect(lifecycle.target.close).toHaveBeenCalledTimes(1);
  });

  it("removes listeners and timers on cleanup", () => {
    const lifecycle = createLifecycleTarget();
    const cleanup = startPrintWindowLifecycle(lifecycle.target, { autoClose: true });

    cleanup();

    vi.advanceTimersByTime(PRINT_LIFECYCLE_FALLBACK_CLOSE_MS + PRINT_LIFECYCLE_PRINT_DELAY_MS);
    lifecycle.dispatchWindow("afterprint");
    lifecycle.dispatchWindow("focus");
    lifecycle.dispatchDocument("visibilitychange");

    expect(lifecycle.target.print).not.toHaveBeenCalled();
    expect(lifecycle.target.close).not.toHaveBeenCalled();
  });
});
