"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "kiosk:dispenser-id";
const CHANGE_EVENT = "kiosk:dispenser-change";

function read(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked (privacy mode, policies) — treat as "not configured".
    return null;
  }
}

function notify() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange); // other tabs
  window.addEventListener(CHANGE_EVENT, onChange); // this tab
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** Throws if the browser refuses to persist the value. */
export function saveDispenserId(id: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch (cause) {
    throw new Error("This browser blocked local storage, so the dispenser can't be saved.", {
      cause,
    });
  }
  notify();
}

export function clearDispenserId() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clear
  }
  notify();
}

/**
 * The dispenser id stored on this kiosk.
 * `undefined` while rendering on the server / before hydration, `null` if unset.
 */
export function useStoredDispenserId(): string | null | undefined {
  return useSyncExternalStore(subscribe, read, () => undefined);
}
