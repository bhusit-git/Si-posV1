const HIDDEN_PRINT_FRAME_ATTRIBUTE = "data-hidden-print-frame";
const PRINT_FRAME_FALLBACK_CLEANUP_MS = 5 * 60 * 1000;

function createHiddenPrintFrame(): HTMLIFrameElement | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  if (!document.body) return null;

  const iframe = document.createElement("iframe");
  iframe.setAttribute(HIDDEN_PRINT_FRAME_ATTRIBUTE, "1");
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "1px";
  iframe.style.height = "1px";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  iframe.style.border = "0";
  iframe.style.zIndex = "-1";
  document.body.appendChild(iframe);
  return iframe;
}

function attachCleanupLifecycle(
  iframe: HTMLIFrameElement,
  revokeUrl?: () => void
): HTMLIFrameElement {
  let cleanedUp = false;

  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    revokeUrl?.();
    iframe.remove();
  };

  const fallbackHandle = window.setTimeout(cleanup, PRINT_FRAME_FALLBACK_CLEANUP_MS);

  iframe.addEventListener(
    "load",
    () => {
      const frameWindow = iframe.contentWindow;
      if (!frameWindow) return;

      frameWindow.addEventListener(
        "afterprint",
        () => {
          window.clearTimeout(fallbackHandle);
          window.setTimeout(cleanup, 0);
        },
        { once: true }
      );
    },
    { once: true }
  );

  return iframe;
}

export function printUrlInHiddenFrame(url: string): HTMLIFrameElement | null {
  const iframe = createHiddenPrintFrame();
  if (!iframe) return null;

  attachCleanupLifecycle(iframe);
  iframe.src = url;
  return iframe;
}

export function printHtmlInHiddenFrame(html: string): HTMLIFrameElement | null {
  const iframe = createHiddenPrintFrame();
  if (!iframe) return null;

  attachCleanupLifecycle(iframe);
  iframe.srcdoc = html;
  return iframe;
}
