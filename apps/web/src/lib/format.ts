const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** `184 MB`, `1.2 GB`: one decimal only when the number is small enough to need it. */
export const formatBytes = (bytes: number): string => {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = value < 10 && unit > 0 ? 1 : 0;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
};

// en-CA gives ISO order (2026-09-15), the shape developers read fastest.
const DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `2026-09-15` */
export const formatDate = (iso: string): string => DATE_FORMAT.format(new Date(iso));

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"}`;

/** Falls back to the absolute date once a month has passed. */
export const formatTimeAgo = (iso: string, now: number): string => {
  const elapsed = now - new Date(iso).getTime();
  if (elapsed < MINUTE_MS) {
    return "just now";
  }
  if (elapsed < HOUR_MS) {
    return `${plural(Math.floor(elapsed / MINUTE_MS), "minute")} ago`;
  }
  if (elapsed < DAY_MS) {
    return `${plural(Math.floor(elapsed / HOUR_MS), "hour")} ago`;
  }
  if (elapsed < MONTH_MS) {
    return `${plural(Math.floor(elapsed / DAY_MS), "day")} ago`;
  }
  return `on ${formatDate(iso)}`;
};

/** `2 days`, `5 hours`, or null inside the last hour: how long until a temporary resource is removed. */
export const formatRemaining = (iso: string, now: number): string | null => {
  const remaining = new Date(iso).getTime() - now;
  if (remaining < HOUR_MS) {
    return null;
  }
  if (remaining < DAY_MS) {
    return plural(Math.floor(remaining / HOUR_MS), "hour");
  }
  return plural(Math.ceil(remaining / DAY_MS), "day");
};
