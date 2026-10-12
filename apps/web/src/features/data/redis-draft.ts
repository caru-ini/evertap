import type { RedisValue } from "@evertap/api/schemas";

/** A Redis value as the editor holds it: scores stay text until saved, so typing "1." is allowed. */
export type RedisDraft =
  | { type: "string"; value: string }
  | { type: "hash"; entries: { field: string; value: string }[] }
  | { type: "list"; items: string[] }
  | { type: "set"; members: string[] }
  | { type: "zset"; members: { member: string; score: string }[] };

export type RedisType = RedisDraft["type"];

export const REDIS_TYPES: readonly { id: RedisType; label: string }[] = [
  { id: "string", label: "String" },
  { id: "hash", label: "Hash" },
  { id: "list", label: "List" },
  { id: "set", label: "Set" },
  { id: "zset", label: "Sorted set" },
];

export const toDraft = (value: RedisValue): RedisDraft => {
  switch (value.type) {
    case "zset":
      return {
        type: "zset",
        members: value.members.map((item) => ({ member: item.member, score: String(item.score) })),
      };
    case "hash":
      return { type: "hash", entries: value.entries.map((entry) => ({ ...entry })) };
    case "list":
      return { type: "list", items: [...value.items] };
    case "set":
      return { type: "set", members: [...value.members] };
    default:
      return { type: "string", value: value.value };
  }
};

/** An empty draft of a type, with one blank entry so there is something to type into. */
export const emptyDraft = (type: RedisType): RedisDraft => {
  switch (type) {
    case "string":
      return { type, value: "" };
    case "hash":
      return { type, entries: [{ field: "", value: "" }] };
    case "list":
      return { type, items: [""] };
    case "set":
      return { type, members: [""] };
    default:
      return { type: "zset", members: [{ member: "", score: "0" }] };
  }
};

const firstDuplicate = (values: string[]) =>
  values.find((value, index) => values.indexOf(value) !== index);

/** The value to write, or the sentence that says what to fix first. */
export const fromDraft = (
  draft: RedisDraft,
): { ok: true; value: RedisValue } | { ok: false; error: string } => {
  // Redis removes a collection's key once it is empty, so saving one would delete the key.
  const empty = "Add at least one item, or delete the key.";
  switch (draft.type) {
    case "string":
      return { ok: true, value: draft };
    case "hash": {
      if (draft.entries.length === 0) return { ok: false, error: empty };
      const duplicate = firstDuplicate(draft.entries.map((entry) => entry.field));
      return duplicate === undefined
        ? { ok: true, value: draft }
        : { ok: false, error: `Two fields are named "${duplicate}". Rename or remove one.` };
    }
    case "list":
      return draft.items.length === 0 ? { ok: false, error: empty } : { ok: true, value: draft };
    case "set": {
      if (draft.members.length === 0) return { ok: false, error: empty };
      const duplicate = firstDuplicate(draft.members);
      return duplicate === undefined
        ? { ok: true, value: draft }
        : { ok: false, error: `"${duplicate}" is listed twice. Remove one.` };
    }
    default: {
      if (draft.members.length === 0) return { ok: false, error: empty };
      const duplicate = firstDuplicate(draft.members.map((item) => item.member));
      if (duplicate !== undefined) {
        return { ok: false, error: `"${duplicate}" is listed twice. Remove one.` };
      }
      const members = draft.members.map((item) => ({
        member: item.member,
        score: item.score.trim() === "" ? Number.NaN : Number(item.score),
      }));
      const bad = members.find((item) => !Number.isFinite(item.score));
      return bad === undefined
        ? { ok: true, value: { type: "zset", members } }
        : { ok: false, error: `Give "${bad.member}" a number as its score.` };
    }
  }
};

/** What the editor last read or saved; `at` is when, so an untouched expiry keeps counting down. */
export type KeyBase = { value: RedisValue | null; ttlMs: number | null; at: number };

export type Expiry = { mode: "never" | "after"; seconds: string };

export const toExpiry = (ttlMs: number | null): Expiry =>
  ttlMs === null
    ? { mode: "never", seconds: "" }
    : { mode: "after", seconds: String(Math.max(1, Math.ceil(ttlMs / 1000))) };

export const expiryError = (expiry: Expiry): string | null => {
  const seconds = Number(expiry.seconds);
  return expiry.mode === "after" && (!Number.isInteger(seconds) || seconds < 1)
    ? "Enter whole seconds, 1 or more."
    : null;
};

/** Compared as saved values, so a score typed as "1.50" matches a stored 1.5. */
export const isValueDirty = (base: RedisValue | null, draft: RedisDraft | null): boolean => {
  if (base === null || draft === null) return false;
  const parsed = fromDraft(draft);
  return !parsed.ok || JSON.stringify(toDraft(parsed.value)) !== JSON.stringify(toDraft(base));
};

export type SavePlan =
  | { kind: "write"; value: RedisValue; ttlMs: number | null }
  | { kind: "expire"; ttlMs: number | null };

/**
 * What Save sends, or null when there is nothing valid to send. The value is written only when it
 * changed, because a write replaces it whole and would corrupt values the editor cannot hold.
 */
export const planSave = ({
  base,
  draft,
  expiry,
  expiryTouched,
  editable,
  now,
}: {
  base: KeyBase;
  draft: RedisDraft | null;
  expiry: Expiry;
  expiryTouched: boolean;
  editable: boolean;
  now: number;
}): SavePlan | null => {
  if (expiryError(expiry) !== null) return null;
  const ttlMs =
    expiry.mode === "never"
      ? null
      : expiryTouched || base.ttlMs === null
        ? Number(expiry.seconds) * 1000
        : Math.max(1, base.ttlMs - (now - base.at));
  if (editable && draft !== null && isValueDirty(base.value, draft)) {
    const parsed = fromDraft(draft);
    return parsed.ok ? { kind: "write", value: parsed.value, ttlMs } : null;
  }
  return expiryTouched ? { kind: "expire", ttlMs } : null;
};

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** `45 s`, `12 min`, `3 h`, `2 days`: how long until a key expires. */
export const formatTtl = (ms: number): string => {
  if (ms < MINUTE_MS) return `${Math.max(1, Math.round(ms / SECOND_MS))} s`;
  if (ms < HOUR_MS) return `${Math.round(ms / MINUTE_MS)} min`;
  if (ms < DAY_MS) return `${Math.round(ms / HOUR_MS)} h`;
  const days = Math.round(ms / DAY_MS);
  return `${days} ${days === 1 ? "day" : "days"}`;
};
