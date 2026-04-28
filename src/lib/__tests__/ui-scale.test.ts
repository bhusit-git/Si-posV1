import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeUIScale,
  readUIScale,
  UI_SCALE_CHANGE_EVENT,
  UI_SCALE_STORAGE_KEY,
  useUIScale,
  writeUIScale,
} from "@/lib/ui-scale";

describe("ui scale preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("falls back to normal for missing or invalid values", () => {
    expect(normalizeUIScale(null)).toBe("normal");
    expect(normalizeUIScale("huge")).toBe("normal");
    expect(readUIScale()).toBe("normal");
  });

  it("reads valid stored values", () => {
    window.localStorage.setItem(UI_SCALE_STORAGE_KEY, "compact");
    expect(readUIScale()).toBe("compact");

    window.localStorage.setItem(UI_SCALE_STORAGE_KEY, "large");
    expect(readUIScale()).toBe("large");
  });

  it("writes the selected value and broadcasts an update event", () => {
    const handler = vi.fn();
    window.addEventListener(UI_SCALE_CHANGE_EVENT, handler as EventListener);

    writeUIScale("large");

    expect(window.localStorage.getItem(UI_SCALE_STORAGE_KEY)).toBe("large");
    expect(handler).toHaveBeenCalledTimes(1);

    window.removeEventListener(UI_SCALE_CHANGE_EVENT, handler as EventListener);
  });

  it("updates the hook value when the preference changes", () => {
    const { result } = renderHook(() => useUIScale());

    expect(result.current).toBe("normal");

    act(() => {
      writeUIScale("compact");
    });
    expect(result.current).toBe("compact");

    act(() => {
      writeUIScale("large");
    });
    expect(result.current).toBe("large");
  });
});
