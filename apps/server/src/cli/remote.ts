import { stat } from "node:fs/promises";
import { join } from "node:path";

import type { AppRouterClient } from "@evertap/api/router";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import { config } from "../config.ts";
import { readSettings } from "./settings.ts";

/** How this CLI reaches evertap, as `evertap status` reports it. */
export type Target =
  | { kind: "local"; socket: string }
  | { kind: "remote"; url: string; token: string | null; source: "api-key" | "login" | "none" };

/** The socket of evertap running on this machine, or null. */
export const localSocket = async () => {
  const socket = join(config.dataDir, "evertap.sock");
  try {
    return (await stat(socket)).isSocket() ? socket : null;
  } catch {
    return null;
  }
};

/**
 * `EVERTAP_API_KEY` first (CI), then the local socket on the machine running evertap, then what
 * `evertap login` saved.
 */
export const findTarget = async (): Promise<Target | null> => {
  const settings = await readSettings();
  const key = process.env.EVERTAP_API_KEY;
  if (key) {
    const url = process.env.EVERTAP_URL ?? settings?.url;
    return url ? { kind: "remote", url, token: key, source: "api-key" } : null;
  }
  const socket = await localSocket();
  if (socket) {
    return { kind: "local", socket };
  }
  return settings ? { kind: "remote", ...settings, source: "login" } : null;
};

/** The next step when `findTarget` finds nothing. */
export const signInHint = () =>
  process.env.EVERTAP_API_KEY
    ? "Set EVERTAP_URL to the address you open evertap at; EVERTAP_API_KEY needs it"
    : "Not signed in. Run evertap login <url> first";

export const clientFor = (target: Target): AppRouterClient => {
  if (target.kind === "local") {
    return createORPCClient(
      new RPCLink({
        url: "http://localhost/api/client/rpc",
        fetch: (request, init) => fetch(request, { ...init, unix: target.socket }),
      }),
    );
  }
  return createORPCClient(
    new RPCLink({
      url: `${target.url}/api/client/rpc`,
      headers: () => (target.token ? { authorization: `Bearer ${target.token}` } : {}),
    }),
  );
};
