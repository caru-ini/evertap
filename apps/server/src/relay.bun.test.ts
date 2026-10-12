import { afterAll, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";

import { RESOURCE_ENGINES, type ResourceEngine } from "@evertap/api/rules";
import type { Socket } from "bun";

import { relayRefusal, startConnect } from "./cli/connect.ts";
import { freePort } from "./live/testing.ts";
import { PAUSE, PING_INTERVAL_MS, RELAY_PATH, RELAY_PROTOCOL, createRelay } from "./relay.ts";

// Only for the tests of the pings: the CLI drops a WebSocket that has not opened within two
// intervals, which a busy machine can take. Long enough that a pause of the event loop (a GC
// during the larger tests) is not two missed pings.
const PING_MS = 200;
const MIB = 1024 * 1024;
const decode = (chunk: Uint8Array) => new TextDecoder().decode(chunk);

// Stand-in entries: each answers with its engine's name and what it got, upper-cased.
const entries = Object.fromEntries(
  RESOURCE_ENGINES.map((engine) => [
    engine,
    Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data: (socket, chunk) => {
          socket.write(`${engine}:${decode(chunk).toUpperCase()}`);
        },
      },
    }),
  ]),
);

type Counted = Socket<{ got: number; sent: number }>;

/** An entry that counts what it gets; the test decides what else it does. */
const manualEntry = (handlers: {
  open?: (socket: Counted) => void;
  drain?: (socket: Counted) => void;
}) => {
  const closed = Promise.withResolvers<void>();
  const listener = Bun.listen<{ got: number; sent: number }>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open: (socket) => {
        socket.data = { got: 0, sent: 0 };
        handlers.open?.(socket);
      },
      data: (socket, chunk) => {
        socket.data.got += chunk.length;
      },
      drain: (socket) => {
        handlers.drain?.(socket);
      },
      close: () => {
        closed.resolve();
      },
    },
  });
  return { listener, closed: closed.promise };
};

const relayServer = (
  entry: (engine: ResourceEngine) => number,
  {
    allowed = new Set(["a", "b"]),
    connectionsPerClient = 256,
    pingIntervalMs = PING_INTERVAL_MS,
  } = {},
) => {
  const relay = createRelay({
    entry: (engine) => ({ hostname: "127.0.0.1", port: entry(engine) }),
    caller: (request) => {
      const token = request.headers.get("authorization");
      return Promise.resolve(token === "Bearer good" ? "a" : token === "Bearer other" ? "b" : null);
    },
    stillAllowed: (caller) => Promise.resolve(allowed.has(caller)),
    pingIntervalMs,
    connectionsPerClient,
  });
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    websocket: relay.websocket,
    // As the server does: what is not for the relay goes on to the app.
    fetch: async (request, bun) => {
      const relayed = await relay.upgrade(request, bun);
      return relayed === undefined ? new Response("the app") : (relayed ?? undefined);
    },
  });
};

const server = relayServer((engine) => entries[engine]?.port ?? 0);

const connect = (
  url: string,
  engines: ResourceEngine[],
  {
    token = "good",
    refused,
    pingIntervalMs = PING_INTERVAL_MS,
  }: { token?: string; refused?: (message: string) => void; pingIntervalMs?: number } = {},
) => {
  const ports = Object.fromEntries(engines.map((engine) => [engine, freePort()]));
  const running = startConnect({
    url,
    token,
    hostname: "127.0.0.1",
    engines,
    ports,
    unavailable: () => {},
    refused,
    pingIntervalMs,
  });
  return { ports, stop: running.stop };
};

/** An app's connection to the relay: what it has received, and when it closed. */
const app = async (port: number) => {
  const state = { received: "", bytes: 0 };
  const closed = Promise.withResolvers<void>();
  const socket = await Bun.connect({
    hostname: "127.0.0.1",
    port,
    socket: {
      data: (_socket, chunk) => {
        state.bytes += chunk.length;
        state.received += decode(chunk);
      },
      close: () => {
        closed.resolve();
      },
    },
  });
  return { socket, state, closed: closed.promise };
};

const until = async (done: () => boolean | Promise<boolean>, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!(await done())) {
    if (Date.now() > deadline) {
      throw new Error("timed out");
    }
    await Bun.sleep(10);
  }
};

const exchange = async (port: number, text: string) => {
  const connection = await app(port);
  connection.socket.write(text);
  await Promise.race([
    until(() => connection.state.received.endsWith(text.toUpperCase())),
    connection.closed,
  ]);
  connection.socket.end();
  return connection.state.received;
};

const within = <T>(promise: Promise<T>, ms = 3000) =>
  Promise.race([
    promise,
    Bun.sleep(ms).then(() => {
      throw new Error("timed out");
    }),
  ]);

afterAll(() => {
  for (const entry of Object.values(entries)) {
    entry.stop(true);
  }
  void server.stop(true);
});

test("carries a connection's bytes both ways through the relay", async () => {
  const { ports, stop } = connect(`http://127.0.0.1:${server.port}`, ["postgresql"]);
  try {
    expect(await exchange(ports.postgresql ?? 0, "select 1")).toBe("postgresql:SELECT 1");
    // Each connection gets its own WebSocket.
    const both = await Promise.all([
      exchange(ports.postgresql ?? 0, "one"),
      exchange(ports.postgresql ?? 0, "two"),
    ]);
    expect(both).toEqual(["postgresql:ONE", "postgresql:TWO"]);
  } finally {
    stop();
  }
});

test("carries each engine to its own entry, buckets included", async () => {
  const { ports, stop } = connect(`http://127.0.0.1:${server.port}`, [...RESOURCE_ENGINES]);
  try {
    for (const engine of RESOURCE_ENGINES) {
      expect(await exchange(ports[engine] ?? 0, "hello")).toBe(`${engine}:HELLO`);
    }
  } finally {
    stop();
  }
});

test("closes the connection when the token is refused, and says how to sign in", async () => {
  const url = `http://127.0.0.1:${server.port}`;
  const told: string[] = [];
  const { ports, stop } = connect(url, ["postgresql"], {
    token: "bad",
    refused: (message) => told.push(message),
  });
  try {
    expect(await exchange(ports.postgresql ?? 0, "select 1")).toBe("");
    await until(() => told.length > 0);
    expect(told).toEqual([`Run evertap login ${url} again`]);
    // Told once, however many connections are turned away.
    expect(await exchange(ports.postgresql ?? 0, "select 1")).toBe("");
    await Bun.sleep(100);
    expect(told).toHaveLength(1);
  } finally {
    stop();
  }
});

test("refuses another relay version, naming the machine to update", async () => {
  const url = `http://127.0.0.1:${server.port}`;
  const offer = async (protocol: string | null) => {
    const response = await fetch(`${url}${RELAY_PATH}postgresql`, {
      headers: {
        authorization: "Bearer good",
        ...(protocol === null ? {} : { "sec-websocket-protocol": protocol }),
      },
    });
    return { status: response.status, text: await response.text() };
  };
  const older = "Update evertap on this machine to match the one running evertap serve";
  expect(await offer(null)).toEqual({ status: 426, text: older });
  expect(await offer("evertap.relay.1")).toEqual({ status: 426, text: older });
  expect(await offer("evertap.relay.3")).toEqual({
    status: 426,
    text: "Update evertap on the machine running evertap serve to match this one",
  });
  expect(await relayRefusal(url, "good")).toBeNull();
  expect(await relayRefusal(url, "bad")).toBe(`Run evertap login ${url} again`);
});

test("leaves a request whose Host does not parse to the app", async () => {
  const response = await fetch(`http://127.0.0.1:${server.port}${RELAY_PATH}postgresql`, {
    headers: { host: "[", authorization: "Bearer good", "sec-websocket-protocol": RELAY_PROTOCOL },
  });
  expect(await response.text()).toBe("the app");
});

test("refuses engines it does not relay", async () => {
  const response = await fetch(`http://127.0.0.1:${server.port}${RELAY_PATH}minio`);
  expect(response.status).toBe(404);
});

test("keeps a quiet connection open across many pings", async () => {
  const relay = relayServer((engine) => entries[engine]?.port ?? 0, { pingIntervalMs: PING_MS });
  const { ports, stop } = connect(`http://127.0.0.1:${relay.port}`, ["redis"], {
    pingIntervalMs: PING_MS,
  });
  try {
    const connection = await app(ports.redis ?? 0);
    connection.socket.write("ping");
    await until(() => connection.state.received === "redis:PING");
    await Bun.sleep(PING_MS * 10);
    connection.socket.write("again");
    await until(() => connection.state.received.endsWith("redis:AGAIN"));
    connection.socket.end();
  } finally {
    stop();
    void relay.stop(true);
  }
});

test("closes the entry's side when the CLI stops answering", async () => {
  const entry = manualEntry({});
  const quiet = relayServer(() => entry.listener.port, { pingIntervalMs: PING_MS });
  // A WebSocket that opens and then never reads, so no ping gets an answer.
  const socket = await Bun.connect({
    hostname: "127.0.0.1",
    port: quiet.port ?? 0,
    socket: { data: () => {} },
  });
  socket.write(
    [
      `GET ${RELAY_PATH}postgresql HTTP/1.1`,
      `Host: 127.0.0.1:${quiet.port}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
      "Sec-WebSocket-Version: 13",
      `Sec-WebSocket-Protocol: ${RELAY_PROTOCOL}`,
      "Authorization: Bearer good",
      "",
      "",
    ].join("\r\n"),
  );
  try {
    await within(entry.closed);
  } finally {
    socket.end();
    entry.listener.stop(true);
    void quiet.stop(true);
  }
});

test("closes the app's connection when the relay stops answering", async () => {
  // Accepts the WebSocket, then never answers a ping.
  const silent = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data: (socket, chunk) => {
        const key = /Sec-WebSocket-Key: (\S+)/i.exec(decode(chunk))?.[1];
        if (key === undefined) {
          return;
        }
        const accept = createHash("sha1")
          .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
          .digest("base64");
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
      },
    },
  });
  const { ports, stop } = connect(`http://127.0.0.1:${silent.port}`, ["mysql"], {
    pingIntervalMs: PING_MS,
  });
  try {
    const connection = await app(ports.mysql ?? 0);
    await within(connection.closed);
  } finally {
    stop();
    silent.stop(true);
  }
});

test("gives a slow app every byte, in order", async () => {
  const size = 24 * MIB;
  const body = randomBytes(size);
  const push = (socket: Counted) => {
    socket.data.sent += Math.max(socket.write(body.subarray(socket.data.sent)), 0);
    if (socket.data.sent === size) {
      socket.end();
    }
  };
  const entry = manualEntry({ open: push, drain: push });
  const relay = relayServer(() => entry.listener.port, { pingIntervalMs: PING_MS });
  const { ports, stop } = connect(`http://127.0.0.1:${relay.port}`, ["redis"], {
    pingIntervalMs: PING_MS,
  });
  try {
    const received: Uint8Array[] = [];
    let bytes = 0;
    const done = Promise.withResolvers<void>();
    const socket = await Bun.connect({
      hostname: "127.0.0.1",
      port: ports.redis ?? 0,
      socket: {
        data: (_socket, chunk) => {
          received.push(new Uint8Array(chunk));
          bytes += chunk.length;
        },
        close: () => {
          done.resolve();
        },
      },
    });
    socket.write("GET");
    // Long enough for several pings while the CLI has stopped reading the relay.
    socket.pause();
    await Bun.sleep(PING_MS * 8);
    socket.resume();
    await within(done.promise, 10_000);
    expect(bytes).toBe(size);
    expect(Buffer.concat(received).equals(body)).toBe(true);
  } finally {
    stop();
    entry.listener.stop(true);
    void relay.stop(true);
  }
});

test("pauses the app for a slow entry instead of growing the queue", async () => {
  const size = 24 * MIB;
  let entrySocket: Counted | undefined;
  const entry = manualEntry({
    open: (socket) => {
      entrySocket = socket;
      socket.pause();
    },
  });
  const relay = relayServer(() => entry.listener.port, { pingIntervalMs: PING_MS });
  const { ports, stop } = connect(`http://127.0.0.1:${relay.port}`, ["garage"], {
    pingIntervalMs: PING_MS,
  });
  try {
    const connection = await app(ports.garage ?? 0);
    const body = new Uint8Array(size);
    let sent = 0;
    const timer = setInterval(() => {
      while (sent < size) {
        const written = connection.socket.write(body.subarray(sent, sent + MIB));
        sent += Math.max(written, 0);
        if (written < MIB) {
          return;
        }
      }
      clearInterval(timer);
    }, 1);
    await Bun.sleep(PING_MS * 8);
    entrySocket?.resume();
    await until(() => (entrySocket?.data.got ?? 0) >= size, 10_000);
    clearInterval(timer);
    expect(entrySocket?.data.got).toBe(size);
  } finally {
    stop();
    entry.listener.stop(true);
    void relay.stop(true);
  }
});

test("hands a slow entry what the app sent before it closed", async () => {
  const size = 4 * MIB;
  let entrySocket: Counted | undefined;
  const entry = manualEntry({
    open: (socket) => {
      entrySocket = socket;
      socket.pause();
    },
  });
  const relay = relayServer(() => entry.listener.port);
  const { ports, stop } = connect(`http://127.0.0.1:${relay.port}`, ["postgresql"]);
  try {
    const connection = await app(ports.postgresql ?? 0);
    const body = new Uint8Array(size);
    let sent = 0;
    await until(() => {
      sent += Math.max(connection.socket.write(body.subarray(sent)), 0);
      return sent === size;
    });
    connection.socket.end();
    await connection.closed;
    entrySocket?.resume();
    await within(entry.closed, 5000);
    expect(entrySocket?.data.got).toBe(size);
  } finally {
    stop();
    entry.listener.stop(true);
    void relay.stop(true);
  }
});

/** WebSockets straight to a relay, as the CLI opens them, and what a plain request gets back. */
const direct = (port: number | undefined) => {
  const url = `127.0.0.1:${port}${RELAY_PATH}postgresql`;
  const open = (token = "good") =>
    new Promise<{ ws: WebSocket; closed: Promise<number> }>((resolve, reject) => {
      const ws = new WebSocket(`ws://${url}`, {
        headers: { authorization: `Bearer ${token}` },
        protocols: [RELAY_PROTOCOL],
      });
      const closed = new Promise<number>((done) => {
        ws.addEventListener("close", (event) => {
          done(event.code);
        });
      });
      ws.addEventListener("open", () => {
        resolve({ ws, closed });
      });
      ws.addEventListener("error", reject);
    });
  // 400: refused only for not upgrading, so a slot was free.
  const status = async (token = "good") =>
    (
      await fetch(`http://${url}`, {
        headers: { authorization: `Bearer ${token}`, "sec-websocket-protocol": RELAY_PROTOCOL },
      })
    ).status;
  return { open, status };
};

const sendMany = (ws: WebSocket, bytes: number) => {
  const chunk = new Uint8Array(64 * 1024);
  for (let sent = 0; sent < bytes; sent += chunk.length) {
    ws.send(chunk);
  }
};

test("cuts off a client that keeps sending after a pause", async () => {
  const entry = manualEntry({
    open: (socket) => {
      socket.pause();
    },
  });
  const relay = relayServer(() => entry.listener.port);
  try {
    const { ws, closed } = await direct(relay.port).open();
    const texts: string[] = [];
    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        texts.push(event.data);
      }
    });
    sendMany(ws, 32 * MIB);
    expect(await within(closed, 5000)).toBe(1008);
    expect(texts).toContain(PAUSE);
  } finally {
    entry.listener.stop(true);
    void relay.stop(true);
  }
});

test("caps open connections per client", async () => {
  const relay = relayServer((engine) => entries[engine]?.port ?? 0, { connectionsPerClient: 2 });
  const { open, status } = direct(relay.port);
  const sockets = [await open(), await open()];
  try {
    expect(await status()).toBe(429);
    // Another client has its own count.
    expect(await status("other")).toBe(400);
    sockets[0]?.ws.close();
    await until(async () => (await status()) === 400);
    sockets[0] = await open();
  } finally {
    for (const { ws } of sockets) {
      ws.close();
    }
    void relay.stop(true);
  }
});

test("gives a client's slot back when the entry closes first", async () => {
  const entry = manualEntry({
    open: (socket) => {
      socket.end();
    },
  });
  const relay = relayServer(() => entry.listener.port, { connectionsPerClient: 1 });
  const { open, status } = direct(relay.port);
  try {
    const { closed } = await open();
    await within(closed);
    await until(async () => (await status()) === 400);
  } finally {
    entry.listener.stop(true);
    void relay.stop(true);
  }
});

test("keeps a client's slot until an entry that stops reading is cut off after a close", async () => {
  const entry = manualEntry({
    open: (socket) => {
      socket.pause();
    },
  });
  const relay = relayServer(() => entry.listener.port, {
    connectionsPerClient: 1,
    pingIntervalMs: PING_MS,
  });
  const { open, status } = direct(relay.port);
  try {
    const { ws, closed } = await open();
    sendMany(ws, 12 * MIB);
    await until(() => ws.bufferedAmount === 0);
    ws.close();
    await within(closed);
    // The entry's side is still open with bytes waiting, so it still counts.
    expect(await status()).toBe(429);
    await within(entry.closed);
    await until(async () => (await status()) === 400);
  } finally {
    entry.listener.stop(true);
    void relay.stop(true);
  }
});

test("closes a client's relays once it is revoked", async () => {
  const allowed = new Set(["a"]);
  const relay = relayServer((engine) => entries[engine]?.port ?? 0, {
    allowed,
    pingIntervalMs: PING_MS,
  });
  const { ports, stop } = connect(`http://127.0.0.1:${relay.port}`, ["redis"]);
  try {
    const connection = await app(ports.redis ?? 0);
    connection.socket.write("ping");
    await until(() => connection.state.received === "redis:PING");
    allowed.delete("a");
    await within(connection.closed);
  } finally {
    stop();
    void relay.stop(true);
  }
});
