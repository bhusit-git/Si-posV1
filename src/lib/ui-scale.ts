import { useEffect, useState } from "react";

export const UI_SCALE_STORAGE_KEY = "superice-ui-scale";
export const UI_SCALE_CHANGE_EVENT = "superice-ui-scale-change";
export const UI_SCALE_VALUES = ["compact", "normal", "large"] as const;

export type UIScale = (typeof UI_SCALE_VALUES)[number];

function isUIScale(value: string | null): value is UIScale {
  return UI_SCALE_VALUES.includes(value as UIScale);
}

export function normalizeUIScale(
  value: string | null | undefined,
  fallback: UIScale = "normal"
): UIScale {
  const candidate = value ?? null;
  return isUIScale(candidate) ? candidate : fallback;
}

export function readUIScale(defaultValue: UIScale = "normal"): UIScale {
  if (typeof window === "undefined") return defaultValue;
  return normalizeUIScale(
    window.localStorage.getItem(UI_SCALE_STORAGE_KEY),
    defaultValue
  );
}

export function writeUIScale(next: UIScale): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(UI_SCALE_STORAGE_KEY, next);
  window.dispatchEvent(
    new CustomEvent(UI_SCALE_CHANGE_EVENT, { detail: { value: next } })
  );
}

export function useUIScale(defaultValue: UIScale = "normal"): UIScale {
  const [value, setValue] = useState<UIScale>(() => readUIScale(defaultValue));

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== UI_SCALE_STORAGE_KEY) return;
      setValue(readUIScale(defaultValue));
    };
    const handleChange = () => {
      setValue(readUIScale(defaultValue));
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(UI_SCALE_CHANGE_EVENT, handleChange as EventListener);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        UI_SCALE_CHANGE_EVENT,
        handleChange as EventListener
      );
    };
  }, [defaultValue]);

  return value;
}
