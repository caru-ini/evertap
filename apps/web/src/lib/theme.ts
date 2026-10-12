import { useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "light" | "dark";

// index.html reads the same key to set `.dark` before the bundle loads.
const STORAGE_KEY = "theme";
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

const readChoice = (): ThemeChoice => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
};

let choice = readChoice();

const apply = () => {
  const dark = choice === "dark" || (choice === "system" && darkQuery.matches);
  document.documentElement.classList.toggle("dark", dark);
};

darkQuery.addEventListener("change", apply);

/** Saves the choice for this browser and repaints at once. */
export const setTheme = (next: ThemeChoice) => {
  choice = next;
  try {
    if (next === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage can be blocked; the choice still holds until reload.
  }
  apply();
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The person's choice, not the resolved theme: "system" stays "system". */
export const useTheme = () => useSyncExternalStore(subscribe, () => choice);
