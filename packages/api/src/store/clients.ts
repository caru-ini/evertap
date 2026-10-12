import { createHash } from "node:crypto";

import { customAlphabet } from "nanoid";

import type { Store } from "../context.ts";
import {
  PAIRING_CODE_ALPHABET,
  PAIRING_WINDOW_MS,
  PENDING_REQUESTS_MAX,
  REQUESTS_PER_SITE_MAX,
  REQUESTS_PER_SOURCE_MAX,
  SESSION_WINDOW_MS,
} from "../rules.ts";
import type { Client, Pairing } from "../schemas.ts";

const newId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
const newSecret = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  40,
);
const newPairingLetters = customAlphabet(PAIRING_CODE_ALPHABET, 8);

/** Writing on every call would turn each API request into a disk write. */
const TOUCH_INTERVAL_MS = 60_000;

/** Tokens are long random strings, so a plain hash is enough to keep them unusable at rest. */
const hash = (secret: string) => createHash("sha256").update(secret).digest("hex");

/** The eight 16-bit groups of an IPv6 address, its zone (`%eth0`) dropped; null for anything else. */
const ipv6Groups = (address: string) => {
  const [bare = ""] = address.split("%");
  const halves = bare.split("::");
  if (!bare.includes(":") || halves.length > 2) {
    return null;
  }
  const [head = [], tail = []] = halves.map((half) =>
    half === ""
      ? []
      : half.split(":").flatMap((group) => {
          if (!group.includes(".")) {
            return [Number.parseInt(group, 16)];
          }
          // A dotted IPv4 tail, as in ::ffff:192.0.2.1, fills the last two groups.
          const [a = NaN, b = NaN, c = NaN, d = NaN] = group.split(".").map(Number);
          return [a * 256 + b, c * 256 + d];
        }),
  );
  const groups =
    halves.length === 2
      ? [...head, ...Array.from({ length: 8 - head.length - tail.length }, () => 0), ...tail]
      : head;
  return groups.length === 8 && groups.every((group) => group >= 0 && group <= 0xffff)
    ? groups
    : null;
};

/** `::ffff:0:0/96`: how an IPv6 socket shows an IPv4 caller. */
const IPV4_MAPPED = [0, 0, 0, 0, 0, 0xffff];

/**
 * What the caps per source count: an IPv6 host is handed a whole /64 and can switch addresses
 * within it, so the /64 is one source, and its /48 is its site. IPv4, and IPv4 mapped into IPv6,
 * count by address and have no site.
 */
const sourceKeys = (source: string) => {
  const groups = ipv6Groups(source);
  if (!groups) {
    return { host: source, site: null };
  }
  if (IPV4_MAPPED.every((group, index) => groups[index] === group)) {
    const [g = 0, h = 0] = groups.slice(6);
    return { host: `${g >> 8}.${g & 255}.${h >> 8}.${h & 255}`, site: null };
  }
  const prefix = (bits: number) =>
    `${groups
      .slice(0, bits / 16)
      .map((group) => group.toString(16))
      .join(":")}::/${bits}`;
  return { host: prefix(64), site: prefix(48) };
};

export type ClientRecord = Client & {
  tokenHash: string;
  /** Browsers only: signed out after this unless used again. */
  expiresAt: string | null;
  /** The browser session that approved it; null when approved on the machine running evertap. */
  approvedBy: string | null;
};

export type RequestRecord = Pairing & {
  requestHash: string;
  status: "pending" | "approved" | "denied";
  /** The client an approval created, until the requester claims it. */
  clientId: string | null;
};

/** Where clients and requests are kept: memory for the demo and tests, SQLite when live. */
export type ClientTables = {
  listClients: () => ClientRecord[];
  getClient: (id: string) => ClientRecord | null;
  findClient: (tokenHash: string) => ClientRecord | null;
  putClient: (record: ClientRecord) => void;
  deleteClient: (id: string) => void;
  listRequests: () => RequestRecord[];
  getRequest: (code: string) => RequestRecord | null;
  findRequest: (requestHash: string) => RequestRecord | null;
  putRequest: (record: RequestRecord) => void;
  deleteRequest: (code: string) => void;
};

export const memoryClientTables = (): ClientTables => {
  const clients = new Map<string, ClientRecord>();
  const requests = new Map<string, RequestRecord>();
  return {
    listClients: () => [...clients.values()],
    getClient: (id) => clients.get(id) ?? null,
    findClient: (tokenHash) =>
      [...clients.values()].find((record) => record.tokenHash === tokenHash) ?? null,
    putClient: (record) => {
      clients.set(record.id, record);
    },
    deleteClient: (id) => {
      clients.delete(id);
    },
    listRequests: () => [...requests.values()],
    getRequest: (code) => requests.get(code) ?? null,
    findRequest: (requestHash) =>
      [...requests.values()].find((record) => record.requestHash === requestHash) ?? null,
    putRequest: (record) => {
      requests.set(record.code, record);
    },
    deleteRequest: (code) => {
      requests.delete(code);
    },
  };
};

type ClientStore = Pick<
  Store,
  | "listClients"
  | "revokeClient"
  | "createApiKey"
  | "startPairing"
  | "resumePairing"
  | "getPairing"
  | "approvePairing"
  | "denyPairing"
  | "claimPairing"
  | "authenticate"
>;

const publicClient = ({ tokenHash: _t, expiresAt: _e, approvedBy: _a, ...client }: ClientRecord) =>
  client;

const publicPairing = ({
  requestHash: _h,
  status: _s,
  clientId: _c,
  ...pairing
}: RequestRecord): Pairing => pairing;

/**
 * Paired CLIs, API keys, and browser sessions, and the requests that lead to them. A request is
 * approved by code and claimed by its secret, as in RFC 8628, so only the requester gets the token.
 */
export const createClientRegistry = (
  tables: ClientTables,
  now: () => Date = () => new Date(),
): ClientStore => {
  const expired = (record: { expiresAt: string | null }) =>
    record.expiresAt !== null && new Date(record.expiresAt) <= now();

  const sweep = () => {
    for (const request of tables.listRequests()) {
      if (expired(request)) {
        tables.deleteRequest(request.code);
        // Approved but never claimed: nobody holds a token for it.
        if (request.clientId !== null) {
          tables.deleteClient(request.clientId);
        }
      }
    }
  };

  const addClient = (
    kind: Client["kind"],
    name: string,
    tokenHash: string,
    approvedBy: string | null,
  ) => {
    const record: ClientRecord = {
      id: newId(),
      kind,
      name,
      lastUsedAt: null,
      lastUsedIp: null,
      createdAt: now().toISOString(),
      tokenHash,
      expiresAt:
        kind === "browser" ? new Date(now().getTime() + SESSION_WINDOW_MS).toISOString() : null,
      approvedBy,
    };
    tables.putClient(record);
    return record;
  };

  const pending = (code: string) => {
    const request = tables.getRequest(code);
    return request?.status === "pending" && !expired(request) ? request : null;
  };

  return {
    listClients: () => {
      // Approved but not yet claimed (an unopened sign-in link): nothing holds its token yet.
      const unclaimed = new Set(tables.listRequests().map((request) => request.clientId));
      return Promise.resolve(
        tables
          .listClients()
          .filter((record) => !expired(record) && !unclaimed.has(record.id))
          .map(publicClient)
          .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
    },

    revokeClient: (id) => {
      tables.deleteClient(id);
      return Promise.resolve();
    },

    createApiKey: (name) => {
      const key = `evertap_${newSecret()}`;
      return Promise.resolve({
        client: publicClient(addClient("api-key", name, hash(key), null)),
        key,
      });
    },

    startPairing: ({ kind, name, source }) => {
      sweep();
      const open = tables.listRequests();
      if (source !== null) {
        const { host, site } = sourceKeys(source);
        const others = open.flatMap((request) =>
          request.source === null ? [] : [sourceKeys(request.source)],
        );
        if (
          open.length >= PENDING_REQUESTS_MAX ||
          others.filter((other) => other.host === host).length >= REQUESTS_PER_SOURCE_MAX ||
          (site !== null &&
            others.filter((other) => other.site === site).length >= REQUESTS_PER_SITE_MAX)
        ) {
          return Promise.resolve(null);
        }
      }
      const letters = newPairingLetters();
      const requestedAt = now();
      const requestId = newSecret();
      const request: RequestRecord = {
        code: `${letters.slice(0, 4)}-${letters.slice(4)}`,
        kind,
        name,
        requestedAt: requestedAt.toISOString(),
        expiresAt: new Date(requestedAt.getTime() + PAIRING_WINDOW_MS).toISOString(),
        requestHash: hash(requestId),
        source,
        status: "pending",
        clientId: null,
      };
      tables.putRequest(request);
      return Promise.resolve({ code: request.code, expiresAt: request.expiresAt, requestId });
    },

    resumePairing: (requestId) => {
      const request = tables.findRequest(hash(requestId));
      return Promise.resolve(
        request?.status === "pending" && !expired(request)
          ? { code: request.code, expiresAt: request.expiresAt }
          : null,
      );
    },

    getPairing: (code) => {
      const request = pending(code);
      return Promise.resolve(request ? publicPairing(request) : null);
    },

    approvePairing: (code, approvedBy) => {
      const request = pending(code);
      if (!request) {
        throw new Error(`pairing not found: ${code}`);
      }
      // A hash nobody holds the secret of, until the claim swaps in a fresh token.
      const record = addClient(request.kind, request.name, hash(newSecret()), approvedBy);
      tables.putRequest({
        ...request,
        status: "approved",
        clientId: record.id,
        // A fresh window: an approval in the code's last seconds would lapse before the next poll.
        expiresAt: new Date(now().getTime() + PAIRING_WINDOW_MS).toISOString(),
      });
      return Promise.resolve(publicClient(record));
    },

    denyPairing: (code) => {
      const request = pending(code);
      if (request) {
        tables.putRequest({ ...request, status: "denied" });
      }
      return Promise.resolve();
    },

    claimPairing: (requestId, name) => {
      // An approval past its window is gone too, or an old sign-in link would still sign in.
      sweep();
      const request = tables.findRequest(hash(requestId));
      if (!request) {
        return Promise.resolve({ status: "expired" as const });
      }
      if (request.status === "pending") {
        return Promise.resolve({ status: "pending" as const });
      }
      tables.deleteRequest(request.code);
      const client = request.clientId === null ? null : tables.getClient(request.clientId);
      if (request.status === "denied" || !client) {
        return Promise.resolve({ status: "denied" as const });
      }
      const token = `evertap_${newSecret()}`;
      tables.putClient({ ...client, name: name ?? client.name, tokenHash: hash(token) });
      return Promise.resolve({ status: "approved" as const, token });
    },

    authenticate: (token, seen) => {
      const tokenHash = hash(token);
      // A request's secret is never a token, even where an older approval stored its hash as one.
      if (tables.findRequest(tokenHash)) {
        return Promise.resolve(null);
      }
      const record = tables.findClient(tokenHash);
      if (!record) {
        return Promise.resolve(null);
      }
      if (expired(record)) {
        tables.deleteClient(record.id);
        return Promise.resolve(null);
      }
      const at = now();
      const last = record.lastUsedAt === null ? 0 : new Date(record.lastUsedAt).getTime();
      if (at.getTime() - last >= TOUCH_INTERVAL_MS || record.lastUsedIp !== seen.ip) {
        const touched: ClientRecord = {
          ...record,
          lastUsedAt: at.toISOString(),
          lastUsedIp: seen.ip,
          expiresAt:
            record.kind === "browser"
              ? new Date(at.getTime() + SESSION_WINDOW_MS).toISOString()
              : record.expiresAt,
        };
        tables.putClient(touched);
        return Promise.resolve(publicClient(touched));
      }
      return Promise.resolve(publicClient(record));
    },
  };
};
