import type { Socket, SocketHandler } from "bun";

import { trackConnections } from "./connections.ts";
import { type Address, listenAt } from "./listener.ts";
import { type Ends, end, flush, send, side } from "./pipe.ts";

/** Largest first command the entry buffers before it knows where the connection goes. */
export const PRELUDE_MAX = 16 * 1024;
const PRELUDE_TIMEOUT_S = 10;

const NOAUTH = "-NOAUTH Authentication required.\r\n";
const WRONGPASS = "-WRONGPASS invalid username-password pair or user is disabled.\r\n";
const UNREACHABLE = "-ERR This database is not answering. Try again in a moment\r\n";

export type Prelude =
  | { kind: "incomplete" }
  | { kind: "user"; username: string }
  | { kind: "reject"; reply: string };

const readLine = (buffer: Uint8Array, start: number) => {
  for (let index = start; index + 1 < buffer.length; index++) {
    if (buffer[index] === 13 && buffer[index + 1] === 10) {
      return { line: new TextDecoder().decode(buffer.subarray(start, index)), next: index + 2 };
    }
  }
  return null;
};

const decide = (args: string[]): Prelude => {
  const command = args[0]?.toUpperCase();
  if (command === "AUTH") {
    // Password-only AUTH means the default user, which every instance disables.
    return args.length === 3 && args[1] !== undefined
      ? { kind: "user", username: args[1] }
      : { kind: "reject", reply: WRONGPASS };
  }
  if (command === "HELLO") {
    const auth = args.findIndex((arg, index) => index >= 2 && arg.toUpperCase() === "AUTH");
    const username = auth === -1 ? undefined : args[auth + 1];
    if (username !== undefined && args[auth + 2] !== undefined) {
      return { kind: "user", username };
    }
  }
  return { kind: "reject", reply: NOAUTH };
};

const parseCommand = (buffer: Uint8Array): string[] | "incomplete" | "invalid" => {
  // Inline commands (`PING\r\n`) cannot carry a username.
  if (buffer[0] !== 42) {
    return "invalid";
  }
  const header = readLine(buffer, 1);
  if (!header) {
    return "incomplete";
  }
  const count = Number(header.line);
  // `HELLO 3 AUTH <user> <pass> SETNAME <name>` is the longest form accepted.
  if (!Number.isInteger(count) || count < 1 || count > 7) {
    return "invalid";
  }
  const args: string[] = [];
  let position = header.next;
  while (args.length < count) {
    if (position >= buffer.length) {
      return "incomplete";
    }
    if (buffer[position] !== 36) {
      return "invalid";
    }
    const bulk = readLine(buffer, position + 1);
    if (!bulk) {
      return "incomplete";
    }
    const length = Number(bulk.line);
    if (!Number.isInteger(length) || length < 0 || length > PRELUDE_MAX) {
      return "invalid";
    }
    if (bulk.next + length + 2 > buffer.length) {
      return "incomplete";
    }
    const arg = new TextDecoder().decode(buffer.subarray(bulk.next, bulk.next + length));
    if (args.length === 0 && !["AUTH", "HELLO"].includes(arg.toUpperCase())) {
      return "invalid";
    }
    args.push(arg);
    position = bulk.next + length + 2;
  }
  return args;
};

/**
 * Reads the client's first RESP command, which may arrive over several packets, and finds the
 * username it logs in with. The password is left for the instance to check.
 */
export const parsePrelude = (buffer: Uint8Array): Prelude => {
  if (buffer.length === 0) {
    return { kind: "incomplete" };
  }
  const args = parseCommand(buffer);
  if (args === "incomplete") {
    return buffer.length > PRELUDE_MAX ? { kind: "reject", reply: NOAUTH } : { kind: "incomplete" };
  }
  return args === "invalid" ? { kind: "reject", reply: NOAUTH } : decide(args);
};

interface Pipe extends Ends<Pipe> {
  state: "prelude" | "routing" | "piped" | "closed";
  /** The client's bytes until the instance is connected. */
  prelude: Uint8Array;
  /** The resource, once piped. */
  id: string | null;
}

export type RedisRoute = { id: string; port: number };

export type RedisProxyOptions = {
  hostname: string;
  port: number;
  /** The resource that logs in with this username and its instance's port, or null. */
  resolve: (username: string) => Promise<RedisRoute | null>;
  /** The port from `resolve` refused the connection; it may have changed. */
  unreachable: (id: string) => void;
};

export type RedisProxy = {
  /** Whether a client was connected to the resource since the last call, which resets it. */
  takeConnected: (id: string) => boolean;
  /** Listens at `address` instead; see `listenAt`. */
  move: (address: Address) => void;
  stop: () => void;
};

const concat = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

/**
 * One port for every Redis resource: routes each connection by the username of its first
 * `AUTH` or `HELLO`, then pipes bytes both ways unchanged.
 */
export const startRedisProxy = (options: RedisProxyOptions): RedisProxy => {
  const connections = trackConnections();

  const close = (pipe: Pipe) => {
    if (pipe.state === "closed") {
      return;
    }
    pipe.state = "closed";
    end(pipe);
    if (pipe.id !== null) {
      connections.closed(pipe.id);
    }
  };

  const route = async (pipe: Pipe, client: Socket<Pipe>, username: string) => {
    let target: RedisRoute | null;
    try {
      target = await options.resolve(username);
    } catch (error) {
      console.error("redis entry:", error);
      client.end(UNREACHABLE);
      return;
    }
    if (pipe.state === "closed") {
      return;
    }
    if (!target) {
      client.end(WRONGPASS);
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
            pipe.id = target.id;
            connections.opened(target.id);
            client.timeout(0);
            send(pipe, pipe.backend, pipe.prelude);
            pipe.prelude = new Uint8Array();
            client.resume();
          },
          data: (_backend, chunk) => {
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
        client: side(client),
        backend: side(),
        id: null,
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
      const prelude = parsePrelude(pipe.prelude);
      if (prelude.kind === "incomplete") {
        return;
      }
      if (prelude.kind === "reject") {
        client.end(prelude.reply);
        return;
      }
      pipe.state = "routing";
      client.pause();
      void route(pipe, client, prelude.username);
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
