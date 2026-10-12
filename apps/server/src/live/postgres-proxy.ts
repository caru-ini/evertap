import type { Socket, SocketHandler } from "bun";

import { trackConnections } from "./connections.ts";
import { type Address, listenAt } from "./listener.ts";
import { type Ends, end, flush, send, side } from "./pipe.ts";

/** PostgreSQL's own cap on a startup packet. */
export const STARTUP_MAX = 10_000;
const PRELUDE_TIMEOUT_S = 10;

const SSL_REQUEST = 80_877_103;
const GSSENC_REQUEST = 80_877_104;
const CANCEL_REQUEST = 80_877_102;
/** Protocol 3.0 sends a 4-byte cancel key; 3.2 lets it run to 256. */
const CANCEL_MAX = 12 + 256;
/** A client asks for GSSAPI, then TLS, before it starts up. */
const NEGOTIATIONS_MAX = 2;
/** The instance's messages before its BackendKeyData are short; past this it sent none. */
const WATCH_MAX = 64 * 1024;

const BACKEND_KEY = 75; // K
const READY = 90; // Z
const ERROR = 69; // E

/** An ErrorResponse that ends the connection; the client shows `message` as the server's. */
export const errorResponse = (code: string, message: string) => {
  const fields = new TextEncoder().encode(
    `${["SFATAL", "VFATAL", `C${code}`, `M${message}`].join("\0")}\0\0`,
  );
  const out = new Uint8Array(5 + fields.length);
  out[0] = ERROR;
  new DataView(out.buffer).setInt32(1, 4 + fields.length);
  out.set(fields, 5);
  return out;
};

const INVALID = errorResponse("08P01", "Connect with a PostgreSQL client and the database's URL");
const OLD_PROTOCOL = errorResponse("0A000", "Update the PostgreSQL client and connect again");
const UNKNOWN_USER = errorResponse(
  "28000",
  "Connect with the user in the database's URL. evertap url <name> prints it",
);
const UNREACHABLE = errorResponse("57P03", "This database is not answering. Try again in a moment");

export type Prelude =
  | { kind: "incomplete" }
  /** Encryption the entry does not offer: it answers `N`, and the client goes on in the clear. */
  | { kind: "decline"; length: number }
  | { kind: "user"; username: string }
  | { kind: "cancel"; key: string }
  | { kind: "reject"; reply: Uint8Array };

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

/** How a session's BackendKeyData and its CancelRequest both name it. */
const cancelKey = (pid: number, secret: Uint8Array) => `${pid}:${hex(secret)}`;

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** The `user` of a protocol 3 startup packet: name and value pairs, each ending in a zero byte. */
const startupUser = (body: Uint8Array) => {
  const decoder = new TextDecoder();
  let position = 0;
  for (;;) {
    const nameEnd = body.indexOf(0, position);
    if (nameEnd <= position) {
      return null;
    }
    const valueEnd = body.indexOf(0, nameEnd + 1);
    if (valueEnd === -1) {
      return null;
    }
    if (decoder.decode(body.subarray(position, nameEnd)) === "user") {
      return decoder.decode(body.subarray(nameEnd + 1, valueEnd)) || null;
    }
    position = valueEnd + 1;
  }
};

/**
 * Reads the client's first packet, which may arrive over several reads: a request for encryption,
 * a startup packet and the user it logs in as, or a request to cancel another session's query. The
 * password is left for the instance to check.
 */
export const parsePrelude = (buffer: Uint8Array): Prelude => {
  // Every packet's length fits in its last two bytes, so anything else, such as TLS sent without
  // asking first, is known from the first byte.
  if (buffer.length > 0 && buffer[0] !== 0) {
    return { kind: "reject", reply: new Uint8Array() };
  }
  if (buffer.length < 8) {
    return { kind: "incomplete" };
  }
  const length = view(buffer).getInt32(0);
  if (length < 8 || length > STARTUP_MAX) {
    return { kind: "reject", reply: INVALID };
  }
  if (buffer.length < length) {
    return { kind: "incomplete" };
  }
  const code = view(buffer).getInt32(4);
  if (code === SSL_REQUEST || code === GSSENC_REQUEST) {
    return length === 8 ? { kind: "decline", length } : { kind: "reject", reply: INVALID };
  }
  if (code === CANCEL_REQUEST) {
    return length >= 16 && length <= CANCEL_MAX
      ? { kind: "cancel", key: cancelKey(view(buffer).getInt32(8), buffer.subarray(12, length)) }
      : { kind: "reject", reply: INVALID };
  }
  if (code >>> 16 !== 3) {
    return { kind: "reject", reply: OLD_PROTOCOL };
  }
  const username = startupUser(buffer.subarray(8, length));
  return username === null ? { kind: "reject", reply: UNKNOWN_USER } : { kind: "user", username };
};

const concat = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

interface Pipe extends Ends<Pipe> {
  state: "prelude" | "routing" | "piped" | "closed";
  /** The client's bytes until the instance is connected. */
  prelude: Uint8Array;
  negotiations: number;
  /** The resource of a client's session once piped; a cancel request is not a client's use. */
  id: string | null;
  /** What the instance sent so far, kept until its BackendKeyData; null once past it. */
  watch: Uint8Array | null;
  /** The cancel key the instance gave this session, while it is open. */
  key: string | null;
}

export type PostgresRoute = { id: string; port: number };

export type PostgresProxyOptions = {
  hostname: string;
  port: number;
  /** The resource that logs in with this username and its instance's port, or null. */
  resolve: (username: string) => Promise<PostgresRoute | null>;
  /** The port from `resolve` refused the connection; it may have changed. */
  unreachable: (id: string) => void;
};

export type PostgresProxy = {
  /** Whether a client was connected to the resource since the last call, which resets it. */
  takeConnected: (id: string) => boolean;
  /** Listens at `address` instead; see `listenAt`. */
  move: (address: Address) => void;
  stop: () => void;
};

/**
 * One port for every PostgreSQL resource: routes each connection by the user of its startup
 * packet, then pipes bytes both ways unchanged, so the session is the instance's own. A cancel
 * request names no user, only the key the instance gave the session, so the entry notes each
 * session's key on its way to the client.
 */
export const startPostgresProxy = (options: PostgresProxyOptions): PostgresProxy => {
  const connections = trackConnections();
  /** Each open session's cancel key → the user it logged in as. */
  const keys = new Map<string, string>();

  const close = (pipe: Pipe) => {
    if (pipe.state === "closed") {
      return;
    }
    pipe.state = "closed";
    end(pipe);
    if (pipe.key !== null) {
      keys.delete(pipe.key);
    }
    if (pipe.id !== null) {
      connections.closed(pipe.id);
    }
  };

  /** Reads the instance's first messages, passed on as they are, until it names the cancel key. */
  const watch = (pipe: Pipe, username: string, chunk: Uint8Array) => {
    let watched = concat(pipe.watch ?? new Uint8Array(), chunk);
    while (watched.length >= 5) {
      const type = watched[0];
      const length = view(watched).getInt32(1);
      if (length < 4 || length > WATCH_MAX) {
        pipe.watch = null;
        return;
      }
      if (watched.length < 1 + length) {
        break;
      }
      if (type === BACKEND_KEY && length >= 8) {
        pipe.key = cancelKey(view(watched).getInt32(5), watched.subarray(9, 1 + length));
        keys.set(pipe.key, username);
      }
      if (type === BACKEND_KEY || type === READY || type === ERROR) {
        pipe.watch = null;
        return;
      }
      watched = watched.subarray(1 + length);
    }
    pipe.watch = watched.length > WATCH_MAX ? null : watched;
  };

  /** `session` is false for a cancel request, which is forwarded and closed by the instance. */
  const route = async (pipe: Pipe, client: Socket<Pipe>, username: string, session: boolean) => {
    let target: PostgresRoute | null;
    try {
      target = await options.resolve(username);
    } catch (error) {
      console.error("postgres entry:", error);
      client.end(UNREACHABLE);
      return;
    }
    if (pipe.state === "closed") {
      return;
    }
    if (!target) {
      // A server answers nothing to a cancel request.
      client.end(session ? UNKNOWN_USER : undefined);
      return;
    }
    try {
      await Bun.connect<Pipe>({
        hostname: "127.0.0.1",
        port: target.port,
        data: pipe,
        socket: {
          open: (backend) => {
            if (pipe.state === "closed") {
              backend.end();
              return;
            }
            pipe.state = "piped";
            pipe.backend.socket = backend;
            if (session) {
              pipe.id = target.id;
              pipe.watch = new Uint8Array();
              connections.opened(target.id);
            }
            client.timeout(0);
            send(pipe, pipe.backend, pipe.prelude);
            pipe.prelude = new Uint8Array();
            client.resume();
          },
          data: (_backend, chunk) => {
            if (pipe.watch) {
              watch(pipe, username, chunk);
            }
            send(pipe, pipe.client, chunk);
          },
          drain: () => {
            flush(pipe, pipe.backend);
          },
          close: () => {
            close(pipe);
          },
          error: () => {
            close(pipe);
          },
        },
      });
    } catch {
      options.unreachable(target.id);
      client.end(UNREACHABLE);
    }
  };

  const socket: SocketHandler<Pipe> = {
    open: (client) => {
      client.data = {
        state: "prelude",
        prelude: new Uint8Array(),
        negotiations: 0,
        client: side(client),
        backend: side(),
        id: null,
        watch: null,
        key: null,
      };
      client.timeout(PRELUDE_TIMEOUT_S);
    },
    data: (client, chunk) => {
      const pipe = client.data;
      if (pipe.state === "piped") {
        send(pipe, pipe.backend, chunk);
        return;
      }
      if (pipe.state === "closed") {
        return;
      }
      // While routing, the client is paused and what already arrived waits here.
      pipe.prelude = concat(pipe.prelude, chunk);
      if (pipe.state === "routing") {
        return;
      }
      for (;;) {
        const prelude = parsePrelude(pipe.prelude);
        if (prelude.kind === "incomplete") {
          return;
        }
        if (prelude.kind === "reject") {
          client.end(prelude.reply);
          return;
        }
        if (prelude.kind !== "decline") {
          const username = prelude.kind === "user" ? prelude.username : keys.get(prelude.key);
          if (username === undefined) {
            client.end();
            return;
          }
          pipe.state = "routing";
          client.pause();
          void route(pipe, client, username, prelude.kind === "user");
          return;
        }
        pipe.negotiations += 1;
        if (pipe.negotiations > NEGOTIATIONS_MAX) {
          client.end(INVALID);
          return;
        }
        client.write("N");
        pipe.prelude = pipe.prelude.subarray(prelude.length);
      }
    },
    drain: (client) => {
      flush(client.data, client.data.client);
    },
    timeout: (client) => {
      client.end();
    },
    close: (client) => {
      close(client.data);
    },
    error: (client) => {
      close(client.data);
    },
  };
  const listener = listenAt({ hostname: options.hostname, port: options.port }, (address) =>
    Bun.listen<Pipe>({ ...address, socket }),
  );

  return {
    takeConnected: connections.takeConnected,
    move: listener.move,
    stop: listener.stop,
  };
};
