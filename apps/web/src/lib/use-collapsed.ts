import { useState } from "react";

/** Which groups of a list page are folded, remembered in this browser per page. */
export const useCollapsed = (page: string) => {
  const key = `collapsed:${page}`;
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      return Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : [];
    } catch {
      return [];
    }
  });

  const toggle = (id: string) => {
    const next = collapsed.includes(id)
      ? collapsed.filter((item) => item !== id)
      : [...collapsed, id];
    setCollapsed(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Storage can be blocked; the fold still holds until reload.
    }
  };

  return { isCollapsed: (id: string) => collapsed.includes(id), toggle };
};
