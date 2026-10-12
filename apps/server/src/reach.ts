/** Whether a URL reaches this evertap: a one-time token sent there has to arrive at its health check. */

import { randomBytes } from "node:crypto";

import type { Arrival, Probe } from "@evertap/api/context";

const TIMEOUT_MS = 5000;

/** How a token arrived: the headers, and whether it still asked for a WebSocket. */
type Seen = { arrival: Arrival; upgrade: boolean };

/** Tokens sent and still waited for, with how each arrived once it has. */
const waiting = new Map<string, Seen | null>();

/** Notes a probe that reached the health check. A token this evertap did not send means nothing. */
export const arrived = (token: string, headers: Headers) => {
  if (waiting.has(token)) {
    waiting.set(token, {
      arrival: {
        host: headers.get("host"),
        forwardedFor: headers.get("x-forwarded-for"),
        forwardedProto: headers.get("x-forwarded-proto"),
      },
      upgrade: headers.get("upgrade")?.toLowerCase() === "websocket",
    });
  }
};

/** Runs `send` with a fresh token in `url`, then tells how that token arrived, if it did. */
const withToken = async <T>(url: string, send: (target: string) => Promise<T>) => {
  const token = randomBytes(16).toString("base64url");
  waiting.set(token, null);
  try {
    const outcome = await send(`${url}/api/health?probe=${token}`);
    return { outcome, seen: waiting.get(token) ?? null };
  } finally {
    waiting.delete(token);
  }
};

const failure = (error: unknown): Extract<Probe, { answered: false }>["failure"] => {
  if (error instanceof Error && error.name === "TimeoutError") {
    return "timeout";
  }
  const code = error instanceof Error && "code" in error ? String(error.code) : "";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "name";
  }
  if (code === "ConnectionRefused" || code === "ECONNREFUSED") {
    return "refused";
  }
  return /CERT|SSL|TLS/.test(code) ? "certificate" : "other";
};

/** Settles once the WebSocket gives up: the health check never upgrades it. */
const tryUpgrade = (target: string) =>
  new Promise<void>((resolve) => {
    const ws = new WebSocket(target.replace(/^http/, "ws"));
    const timer = setTimeout(() => {
      ws.close();
      resolve();
    }, TIMEOUT_MS);
    ws.addEventListener("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * Sends `url`'s health check a one-time token, and when that arrives, a WebSocket upgrade with
 * another, as `evertap connect` needs one through the same way.
 */
export const probeUrl = async (url: string): Promise<Probe> => {
  const plain = await withToken(url, async (target) => {
    try {
      const response = await fetch(target, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      await response.body?.cancel();
      return response.status;
    } catch (error) {
      return failure(error);
    }
  });
  if (typeof plain.outcome !== "number") {
    return { answered: false, failure: plain.outcome };
  }
  if (plain.seen === null) {
    return { answered: true, status: plain.outcome, arrival: null, upgrades: false };
  }
  // A proxy that drops the Upgrade header still passes the request on, as a plain one.
  const upgrade = await withToken(url, tryUpgrade);
  return {
    answered: true,
    status: plain.outcome,
    arrival: plain.seen.arrival,
    upgrades: upgrade.seen?.upgrade ?? false,
  };
};
