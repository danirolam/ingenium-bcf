// The workspace can be driven from either end of the same pipeline:
//
//   law-first    pick a bill   → see which clients it exposes → brief them
//   client-first pick a client → rank the bills that threaten it → brief them
//
// Both share Stage 2 (Legal delta) and Stage 4 (Client brief + email); only the
// entry differs. This module is the single source of truth for which way the
// user is working. It is a tiny external store (localStorage-backed) so the rail
// switch, the overview, and the pages can all read/flip it without prop-drilling.
import { useSyncExternalStore } from "react";

export type ViewMode = "law-first" | "client-first";

const STORAGE_KEY = "ingenium.viewMode";
const listeners = new Set<() => void>();

function readStored(): ViewMode {
  if (typeof window === "undefined") return "law-first";
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "client-first"
      ? "client-first"
      : "law-first";
  } catch {
    return "law-first";
  }
}

let current: ViewMode = readStored();

export function getViewMode(): ViewMode {
  return current;
}

export function setViewMode(mode: ViewMode): void {
  if (mode === current) return;
  current = mode;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Private-mode / disabled storage: keep the in-memory value, skip persisting.
  }
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Reactive read of the current orientation. */
export function useViewMode(): ViewMode {
  return useSyncExternalStore(subscribe, getViewMode, () => "law-first");
}
