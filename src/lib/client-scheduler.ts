"use client";

type BackgroundCallback = () => void | Promise<void>;
type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number }
  ) => number;
  cancelIdleCallback?: (id: number) => void;
};

export function scheduleBackgroundTask(
  callback: BackgroundCallback,
  timeoutMs = 400
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const idleWindow = window as IdleWindow;

  if (
    typeof idleWindow.requestIdleCallback === "function" &&
    typeof idleWindow.cancelIdleCallback === "function"
  ) {
    const idleId = idleWindow.requestIdleCallback(() => {
      void callback();
    }, { timeout: timeoutMs });

    return () => idleWindow.cancelIdleCallback?.(idleId);
  }

  const timerId = window.setTimeout(() => {
    void callback();
  }, timeoutMs);

  return () => window.clearTimeout(timerId);
}
