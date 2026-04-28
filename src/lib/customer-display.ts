import { useEffect, useState } from "react";

const CUSTOMER_ID_DISPLAY_STORAGE_KEY = "superice-show-customer-id-with-name";
const CUSTOMER_ID_DISPLAY_CHANGE_EVENT = "superice-customer-id-display-change";

function parseBooleanString(value: string | null, fallback: boolean): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export function readShowCustomerIdWithName(defaultValue = true): boolean {
  if (typeof window === "undefined") return defaultValue;
  return parseBooleanString(
    window.localStorage.getItem(CUSTOMER_ID_DISPLAY_STORAGE_KEY),
    defaultValue
  );
}

export function writeShowCustomerIdWithName(next: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CUSTOMER_ID_DISPLAY_STORAGE_KEY, String(next));
  window.dispatchEvent(new CustomEvent(CUSTOMER_ID_DISPLAY_CHANGE_EVENT));
}

export function useShowCustomerIdWithName(defaultValue = true): boolean {
  const [value, setValue] = useState<boolean>(() =>
    readShowCustomerIdWithName(defaultValue)
  );

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== CUSTOMER_ID_DISPLAY_STORAGE_KEY) return;
      setValue(readShowCustomerIdWithName(defaultValue));
    };
    const handlePreferenceChange = () => {
      setValue(readShowCustomerIdWithName(defaultValue));
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(
      CUSTOMER_ID_DISPLAY_CHANGE_EVENT,
      handlePreferenceChange as EventListener
    );
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        CUSTOMER_ID_DISPLAY_CHANGE_EVENT,
        handlePreferenceChange as EventListener
      );
    };
  }, [defaultValue]);

  return value;
}

export function formatCustomerDisplay(
  customerId: number | string | null | undefined,
  customerName: string | null | undefined,
  showCustomerIdWithName: boolean
): string {
  const name = customerName || "-";
  if (!showCustomerIdWithName) return name;
  const id = customerId === null || customerId === undefined || customerId === ""
    ? "-"
    : String(customerId);
  return `${id} | ${name}`;
}
