import { RESOURCE_ENGINES, type ResourceEngine } from "@evertap/api/rules";
import type { Server, ServerWebSocket, Socket, WebSocketHandler } from "bun";

import type { Address } from "./live/listener.ts";
import { writeQueue } from "./live/pipe.ts";

/** Where the relay path is served; the CLI opens one WebSocket per connection. */
export const RELAY_PATH = "/api/client/tcp/";

/**
 * What the CLI and the relay agree on, as a WebSocket subprotocol; raise it whenever what crosses
 * the relay changes. Version 1 was raw bytes alone, and such a CLI would write `pause` into the
 * app's stream.
 */
const RELAY_VERSION = 2;
export const RELAY_PROTOCOL = `evertap.relay.${RELAY_VERSION}`;

/**
 * Both ends ping this often. Proxies close a quiet WebSocket (nginx after 60 s, Cloudflare after
 * about 100), and Bun pings on its own only near its 120 s idle limit.
 */
export const PING_INTERVAL_MS = 25_000;

/** An end that hears nothing back for this many pings in a row closes both sides. */
export const UNANSWERED_PINGS_MAX = 2;

/** A relay's caller is looked up again this many pings apart, so a revoked client's relays close. */
const CALLER_CHECK_PINGS = 2;

/**
 * Text frames carry flow control; the bytes always go as binary frames. Bun cannot stop reading a
 * server WebSocket, so the relay asks the CLI to stop reading from the app instead.
 */
export const PAUSE = "pause";
export const RESUME = "resume";

/** Waiting bytes past which the CLI is asked to pause. */
const QUEUE_PAUSE_BYTES = 1024 * 1024;

/** Leaves room for what was in flight when the pause went out; a CLI that sends past it is cut off. */
const QUEUE_MAX_BYTES = 16 * 1024 * 1024;

/** Far above a connection pool or a test run; with the queue cap, it bounds one client's memory. */
const CONNECTIONS_PER_CLIENT_MAX = 256;

type Relay = {
  entry: Address;
  /** Counted against this key's limit until the entry's side is gone. */
  caller: string;
  ws: ServerWebSocket<Relay> | null;
  tcp: Socket<Relay> | null;
  /** What arrived before the entry answered, or what the entry did not take yet. */
  queue: Uint8Array[];
  queued: number;
  /** The CLI was asked to stop sending. */
  paused: boolean;
  /** Something arrived from the CLI since the last ping. */
  heard: boolean;
  unanswered: number;
  pings: number;
  timer: ReturnType<typeof setInterval> | undefined;
  /** The WebSocket is closed; the entry still gets what is queued, until `deadline`. */
  closed: boolean;
  deadline: ReturnType<typeof setTimeout> | undefined;
  /** The entry's side is gone and the caller has its slot back. */
  finished: boolean;
};

export type RelayOptions = {
  /** Where each engine's entry answers on this machine. */
  entry: (engine: ResourceEngine) => Address;
  /**
   * The key open relays are counted under: one per paired CLI or API key, and one for the local
   * socket. Null when the request may not use the relay.
   */
  caller: (request: Request, server: Server<Relay>) => Promise<string | null>;
  /** Whether a key `caller` returned may still use the relay; false once it is revoked. */
  stillAllowed: (caller: string) => Promise<boolean>;
  pingIntervalMs?: number;
  connectionsPerClient?: number;
};

/** The next step for a client that offered other relay versions than this one. */
const versionMismatch = (offered: string[]) => {
  const newer = offered.some(
    (protocol) => Number(/^evertap\.relay\.(\d+)$/.exec(protocol)?.[1]) > RELAY_VERSION,
  );
  return newer
    ? "Update evertap on the machine running evertap serve to match this one"
    : "Update evertap on this machine to match the one running evertap serve";
};

/**
 * TCP over WebSocket to a database's or a bucket's entry, for the CLI's relay behind a tunnel. The
 * bytes pass unchanged, so the entry still checks the database's password or the S3 signature.
 */
export const createRelay = (options: RelayOptions) => {
  const pingIntervalMs = options.pingIntervalMs ?? PING_INTERVAL_MS;
  const connectionsPerClient = options.connectionsPerClient ?? CONNECTIONS_PER_CLIENT_MAX;
  const open = new Map<string, number>();

  const engineOf = (pathname: string) =>
    RESOURCE_ENGINES.find((engine) => pathname === `${RELAY_PATH}${engine}`);

  const release = (caller: string) => {
    const count = (open.get(caller) ?? 1) - 1;
    if (count > 0) {
      open.set(caller, count);
    } else {
      open.delete(caller);
    }
  };

  /** The entry's side is gone; only now does the caller get its slot back. */
  const finish = (relay: Relay) => {
    if (relay.finished) {
      return;
    }
    relay.finished = true;
    clearTimeout(relay.deadline);
    release(relay.caller);
  };

  const close = (relay: Relay, code?: number, reason?: string) => {
    if (relay.closed) {
      return;
    }
    relay.closed = true;
    clearInterval(relay.timer);
    relay.ws?.close(code, reason);
    // What the CLI sent before closing still reaches the entry; `flush` ends it after.
    if (relay.queue.length === 0) {
      relay.tcp?.end();
    }
    // An entry that stops reading must not keep the bytes, or the caller's slot, for good.
    relay.deadline = setTimeout(() => {
      relay.queue = [];
      relay.tcp?.terminate();
      finish(relay);
    }, 2 * pingIntervalMs);
  };

  const flush = (relay: Relay) => {
    const { tcp } = relay;
    if (!tcp) {
      return;
    }
    relay.queued -= writeQueue(tcp, relay.queue);
    if (relay.queue.length > 0) {
      return;
    }
    if (relay.closed) {
      tcp.end();
    } else if (relay.paused) {
      relay.paused = false;
      relay.ws?.send(RESUME);
    }
  };

  const recheck = async (relay: Relay) => {
    // A failed lookup is no proof of revocation; the next check asks again.
    const allowed = await options.stillAllowed(relay.caller).catch(() => true);
    if (!allowed) {
      close(relay, 1008, "Sign in with evertap login");
    }
  };

  const ping = (relay: Relay) => {
    if (relay.heard) {
      relay.unanswered = 0;
    }
    relay.heard = false;
    if (relay.unanswered >= UNANSWERED_PINGS_MAX) {
      close(relay);
      return;
    }
    relay.ws?.ping();
    relay.unanswered += 1;
    relay.pings += 1;
    if (relay.pings % CALLER_CHECK_PINGS === 0) {
      void recheck(relay);
    }
  };

  /** A Response when the request was for the relay and could not be upgraded; undefined otherwise. */
  const upgrade = async (request: Request, server: Server<Relay>) => {
    // A Host that does not parse, such as `[`, breaks the URL; the app's Host check refuses it.
    if (!URL.canParse(request.url)) {
      return undefined;
    }
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith(RELAY_PATH)) {
      return undefined;
    }
    const engine = engineOf(pathname);
    if (!engine) {
      return new Response("Not found", { status: 404 });
    }
    const caller = await options.caller(request, server);
    if (caller === null) {
      return new Response("Sign in with evertap login", { status: 401 });
    }
    const offered = (request.headers.get("sec-websocket-protocol") ?? "")
      .split(",")
      .map((protocol) => protocol.trim());
    if (!offered.includes(RELAY_PROTOCOL)) {
      return new Response(versionMismatch(offered), { status: 426 });
    }
    const count = open.get(caller) ?? 0;
    if (count >= connectionsPerClient) {
      return new Response("Too many open connections. Close some, then try again", {
        status: 429,
      });
    }
    const relay: Relay = {
      entry: options.entry(engine),
      caller,
      ws: null,
      tcp: null,
      queue: [],
      queued: 0,
      paused: false,
      heard: false,
      unanswered: 0,
      pings: 0,
      timer: undefined,
      closed: false,
      deadline: undefined,
      finished: false,
    };
    open.set(caller, count + 1);
    if (
      server.upgrade(request, {
        data: relay,
        headers: { "sec-websocket-protocol": RELAY_PROTOCOL },
      })
    ) {
      return null;
    }
    release(caller);
    return new Response("Expected a WebSocket", { status: 400 });
  };

  const websocket: WebSocketHandler<Relay> = {
    open: (ws) => {
      const relay = ws.data;
      relay.ws = ws;
      relay.timer = setInterval(() => {
        ping(relay);
      }, pingIntervalMs);
      Bun.connect<Relay>({
        ...relay.entry,
        data: relay,
        socket: {
          open: (tcp) => {
            relay.tcp = tcp;
            flush(relay);
          },
          data: (tcp, chunk) => {
            const sent = ws.send(chunk);
            // 0: dropped, which would break the stream. -1: queued past the limit; wait for drain.
            if (sent === 0) {
              close(relay);
            } else if (sent === -1) {
              tcp.pause();
            }
          },
          drain: () => {
            flush(relay);
          },
          close: () => {
            close(relay);
            finish(relay);
          },
          error: () => {
            close(relay);
            finish(relay);
          },
        },
      }).catch(() => {
        close(relay, 1011, "The service is not answering");
        finish(relay);
      });
    },
    message: (ws, message) => {
      const relay = ws.data;
      relay.heard = true;
      const chunk =
        typeof message === "string" ? new TextEncoder().encode(message) : new Uint8Array(message);
      relay.queue.push(chunk);
      relay.queued += chunk.length;
      if (relay.queue.length === 1) {
        flush(relay);
      }
      if (relay.queued > QUEUE_MAX_BYTES) {
        relay.queue = [];
        close(relay, 1008, "Kept sending after a pause");
      } else if (relay.queued > QUEUE_PAUSE_BYTES && !relay.paused) {
        relay.paused = true;
        ws.send(PAUSE);
      }
    },
    ping: (ws) => {
      ws.data.heard = true;
    },
    pong: (ws) => {
      ws.data.heard = true;
    },
    drain: (ws) => {
      ws.data.tcp?.resume();
    },
    close: (ws) => {
      close(ws.data);
    },
  };

  return { upgrade, websocket };
};
