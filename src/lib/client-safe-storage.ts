"use client";

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getString(key: string): string | null {
  const storage = getStorage();
  if (!storage) return null;

  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function setString(key: string, value: string): boolean {
  const storage = getStorage();
  if (!storage) return false;

  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function remove(key: string): boolean {
  const storage = getStorage();
  if (!storage) return false;

  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function getJson<T>(key: string, fallback: T): T {
  const raw = getString(key);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setJson(key: string, value: unknown): boolean {
  try {
    return setString(key, JSON.stringify(value));
  } catch {
    return false;
  }
}
