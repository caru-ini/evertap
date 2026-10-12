import type { ResourceEngine } from "@evertap/api/rules";
import { useSyncExternalStore } from "react";

type CreateState = { open: boolean; engine?: ResourceEngine };

// One creation dialog for the whole app, so opening it never leaves the current page.
let state: CreateState = { open: false };
const listeners = new Set<() => void>();

const set = (next: CreateState) => {
  state = next;
  for (const listener of listeners) listener();
};

/** Opens creation at Service, or at Details when an engine is given. */
export const openCreateResource = (engine?: ResourceEngine) => {
  set({ open: true, engine });
};

// The engine stays so the closing animation does not swap the dialog's content.
export const closeCreateResource = () => {
  set({ ...state, open: false });
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useCreateResource = () => useSyncExternalStore(subscribe, () => state);
