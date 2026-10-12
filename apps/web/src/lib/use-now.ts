import { useEffect, useState } from "react";

const CLOCK_MS = 60_000;

/**
 * One clock per screen so "3 days ago" agrees across rows and keeps moving while the tab is open.
 * A screen that counts seconds ticks every `everyMs` instead.
 */
export const useNow = (everyMs = CLOCK_MS) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, everyMs);
    return () => {
      clearInterval(timer);
    };
  }, [everyMs]);
  return now;
};
