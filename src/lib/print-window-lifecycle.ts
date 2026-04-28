export const PRINT_LIFECYCLE_PRINT_DELAY_MS = 100;
export const PRINT_LIFECYCLE_FOCUS_GRACE_MS = 1500;
export const PRINT_LIFECYCLE_FALLBACK_CLOSE_MS = 15000;

export interface PrintLifecycleOptions {
  autoClose?: boolean;
}

interface PrintLifecycleDocument {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  visibilityState?: string;
  readyState?: string;
}

interface PrintLifecycleWindow {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  setTimeout(handler: () => void, timeout?: number): number;
  clearTimeout(handle: number): void;
  requestAnimationFrame?(callback: FrameRequestCallback): number;
  cancelAnimationFrame?(handle: number): void;
  print(): void;
  close(): void;
  performance?: {
    now?: () => number;
  };
  document?: PrintLifecycleDocument;
}

function getNow(target: PrintLifecycleWindow): number {
  return target.performance?.now?.() ?? Date.now();
}

export function startPrintWindowLifecycle(
  target: PrintLifecycleWindow,
  options: PrintLifecycleOptions = {}
): () => void {
  const autoClose = options.autoClose ?? false;
  const timeoutHandles = new Set<number>();
  const animationFrameHandles = new Set<number>();
  const cleanupCallbacks: Array<() => void> = [];

  let disposed = false;
  let closed = false;
  let printRequested = false;
  let sawPrintSignal = false;
  let printRequestedAt = 0;

  const scheduleTimeout = (callback: () => void, timeout: number): number => {
    const handle = target.setTimeout(() => {
      timeoutHandles.delete(handle);
      callback();
    }, timeout);
    timeoutHandles.add(handle);
    return handle;
  };

  const clearScheduledWork = (): void => {
    for (const handle of timeoutHandles) {
      target.clearTimeout(handle);
    }
    timeoutHandles.clear();

    if (typeof target.cancelAnimationFrame === "function") {
      for (const handle of animationFrameHandles) {
        target.cancelAnimationFrame(handle);
      }
    }
    animationFrameHandles.clear();
  };

  const cleanup = (): void => {
    disposed = true;
    clearScheduledWork();
    for (const dispose of cleanupCallbacks.splice(0)) {
      dispose();
    }
  };

  const closeOnce = (): void => {
    if (disposed || closed) return;
    closed = true;
    clearScheduledWork();
    target.setTimeout(() => {
      if (!disposed) target.close();
    }, 0);
  };

  const notePrintSignal = (): void => {
    if (!printRequested || closed) return;
    sawPrintSignal = true;
  };

  if (autoClose) {
    const handleBeforePrint: EventListener = () => {
      notePrintSignal();
    };
    const handleAfterPrint: EventListener = () => {
      if (!printRequested || closed) return;
      notePrintSignal();
      closeOnce();
    };
    const handleFocus: EventListener = () => {
      if (!printRequested || closed) return;
      const elapsed = getNow(target) - printRequestedAt;
      if (sawPrintSignal || elapsed >= PRINT_LIFECYCLE_FOCUS_GRACE_MS) {
        closeOnce();
      }
    };

    target.addEventListener("beforeprint", handleBeforePrint);
    target.addEventListener("afterprint", handleAfterPrint);
    target.addEventListener("focus", handleFocus);
    cleanupCallbacks.push(() => target.removeEventListener("beforeprint", handleBeforePrint));
    cleanupCallbacks.push(() => target.removeEventListener("afterprint", handleAfterPrint));
    cleanupCallbacks.push(() => target.removeEventListener("focus", handleFocus));

    if (target.document) {
      const handleVisibilityChange: EventListener = () => {
        if (target.document?.visibilityState === "hidden") {
          notePrintSignal();
        }
      };
      target.document.addEventListener("visibilitychange", handleVisibilityChange);
      cleanupCallbacks.push(() =>
        target.document?.removeEventListener("visibilitychange", handleVisibilityChange)
      );
    }

    scheduleTimeout(() => {
      if (printRequested && !closed) {
        closeOnce();
      }
    }, PRINT_LIFECYCLE_FALLBACK_CLOSE_MS);
  }

  const queuePrintAfterFrames = (remainingFrames: number): void => {
    if (disposed || closed) return;

    if (remainingFrames <= 0) {
      scheduleTimeout(() => {
        if (disposed || closed || printRequested) return;
        printRequested = true;
        printRequestedAt = getNow(target);
        target.print();
      }, PRINT_LIFECYCLE_PRINT_DELAY_MS);
      return;
    }

    if (typeof target.requestAnimationFrame === "function") {
      const handle = target.requestAnimationFrame(() => {
        animationFrameHandles.delete(handle);
        queuePrintAfterFrames(remainingFrames - 1);
      });
      animationFrameHandles.add(handle);
      return;
    }

    scheduleTimeout(() => queuePrintAfterFrames(remainingFrames - 1), 16);
  };

  queuePrintAfterFrames(2);
  return cleanup;
}

export function buildPrintLifecycleScript(options: PrintLifecycleOptions = {}): string {
  const autoClose = options.autoClose ?? false;

  return `
      (() => {
        const autoClose = ${JSON.stringify(autoClose)};
        const printDelayMs = ${PRINT_LIFECYCLE_PRINT_DELAY_MS};
        const focusGraceMs = ${PRINT_LIFECYCLE_FOCUS_GRACE_MS};
        const fallbackCloseMs = ${PRINT_LIFECYCLE_FALLBACK_CLOSE_MS};
        let closed = false;
        let printRequested = false;
        let sawPrintSignal = false;
        let printRequestedAt = 0;
        let fallbackHandle = null;

        const now = () => window.performance?.now?.() ?? Date.now();
        const closeOnce = () => {
          if (closed) return;
          closed = true;
          if (fallbackHandle !== null) {
            window.clearTimeout(fallbackHandle);
            fallbackHandle = null;
          }
          window.setTimeout(() => window.close(), 0);
        };
        const notePrintSignal = () => {
          if (!printRequested || closed) return;
          sawPrintSignal = true;
        };
        const schedulePrint = () => {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
              window.setTimeout(() => {
                if (closed || printRequested) return;
                printRequested = true;
                printRequestedAt = now();
                window.print();
              }, printDelayMs);
            });
          });
        };

        if (autoClose) {
          window.addEventListener("beforeprint", notePrintSignal);
          window.addEventListener("afterprint", () => {
            notePrintSignal();
            closeOnce();
          });
          window.addEventListener("focus", () => {
            if (!printRequested || closed) return;
            const elapsed = now() - printRequestedAt;
            if (sawPrintSignal || elapsed >= focusGraceMs) {
              closeOnce();
            }
          });
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") {
              notePrintSignal();
            }
          });
          fallbackHandle = window.setTimeout(() => {
            if (printRequested && !closed) {
              closeOnce();
            }
          }, fallbackCloseMs);
        }

        if (document.readyState === "complete") {
          schedulePrint();
        } else {
          window.addEventListener("load", schedulePrint, { once: true });
        }
      })();
    `;
}
