import { useSyncExternalStore } from "react";

// Shared selection of the active dealer membership (multi-club). One auth.uid()
// can have several `dealers` rows (one per club); this remembers which club's
// schedule the dealer is currently viewing. Persisted in localStorage and shared
// across every component via useSyncExternalStore — no context wiring needed.
const KEY = "vinpoker.dealer.selectedDealerId";

let current: string | null = readInitial();
const listeners = new Set<() => void>();

function readInitial(): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
  } catch {
    return null;
  }
}

export function getSelectedDealerId(): string | null {
  return current;
}

export function setSelectedDealerId(id: string | null): void {
  if (current === id) return;
  current = id;
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore storage errors */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSelectedDealerId(): string | null {
  return useSyncExternalStore(subscribe, getSelectedDealerId, getSelectedDealerId);
}
