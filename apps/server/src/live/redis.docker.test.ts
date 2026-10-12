import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { DataError } from "@evertap/api/context";
import { REDIS_STRING_MAX, REDIS_VALUE_MAX, type Database } from "@evertap/api/schemas";
import { RedisClient } from "bun";

import type { DriverContext, RedisDriver } from "./driver.ts";
import { createRedisDriver } from "./redis.ts";
import { containerId, createTestContext, laterRelease } from "./testing.ts";

const PORT = 16379;

let driver: RedisDriver;
let context: DriverContext;
let cleanup: () => Promise<void>;
let a: Database;
let b: Database;

const resource = (id: string, version: string, connectionUrl: string): Database => ({
  id,
  kind: "database",
  engine: "redis",
  version,
  name: `cache-${id}`,
  description: "",
  connectionUrl,
  extensions: [],
  protected: false,
  expiresAt: null,
  sizeBytes: 0,
  lastConnectedAt: null,
  createdAt: new Date().toISOString(),
});

const open = (url: string) => new RedisClient(url, { autoReconnect: false });

/** Sends raw bytes to the entry, in pieces, and collects what comes back until it closes. */
const raw = async (pieces: string[], waitMs = 300) => {
  let received = "";
  const socket = await Bun.connect({
    hostname: "127.0.0.1",
    port: PORT,
    socket: {
      data: (_socket, chunk) => {
        received += chunk.toString();
      },
    },
  });
  for (const piece of pieces) {
    socket.write(piece);
    await Bun.sleep(50);
  }
  await Bun.sleep(waitMs);
  socket.end();
  return received;
};

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
};

const bulk = (...args: string[]) =>
  `*${args.length}\r\n${args.map((arg) => `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`).join("")}`;

beforeAll(async () => {
  const test = await createTestContext("redis", PORT);
  context = test.context;
  cleanup = test.cleanup;
  driver = createRedisDriver(context);
  await driver.start([]);
  // One at a time, as the live store runs them.
  const createdA = await driver.provision({
    id: "aaaa",
    name: "a",
    version: "8.10",
    extensions: [],
    password: "pwA",
  });
  const createdB = await driver.provision({
    id: "bbbb",
    name: "b",
    version: "7.4",
    extensions: [],
    password: "pwB",
  });
  a = resource("aaaa", "8.10", createdA.connectionUrl);
  b = resource("bbbb", "7.4", createdB.connectionUrl);
  test.context.metadata.putResource(a);
  test.context.metadata.putResource(b);
});

afterAll(async () => {
  await driver?.close();
  await cleanup?.();
});

describe("entry", () => {
  it("hands out a URL on the shared port", () => {
    expect(a.connectionUrl).toBe(`redis://evertap_aaaa:pwA@127.0.0.1:${PORT}/0`);
  });

  it("routes each user to its own version and keys", async () => {
    const clientA = open(a.connectionUrl);
    const clientB = open(b.connectionUrl);
    expect(String(await clientA.send("INFO", ["server"]))).toContain("redis_version:8.");
    expect(String(await clientB.send("INFO", ["server"]))).toContain("redis_version:7.4");
    await clientA.set("only-a", "1");
    expect(await clientB.get("only-a")).toBeNull();
    expect(await clientA.get("only-a")).toBe("1");
    await clientA.del("only-a");
    clientA.close();
    clientB.close();
  });

  it("rejects a wrong password, another resource's password and unknown users", async () => {
    const wrong = open(a.connectionUrl.replace("pwA", "nope"));
    expect(String(await failure(wrong.send("PING", [])))).toContain("WRONGPASS");
    const swapped = open(a.connectionUrl.replace("pwA", "pwB"));
    expect(String(await failure(swapped.send("PING", [])))).toContain("WRONGPASS");
    expect(await raw([bulk("AUTH", "evertap_zzzz", "x")])).toStartWith("-WRONGPASS");
    expect(await raw([bulk("AUTH", "someone", "x")])).toStartWith("-WRONGPASS");
  });

  it("rejects password-only AUTH and commands before AUTH", async () => {
    expect(await raw([bulk("AUTH", "pwA")])).toStartWith("-WRONGPASS");
    expect(await raw([bulk("PING")])).toStartWith("-NOAUTH");
    expect(await raw(["PING\r\n"])).toStartWith("-NOAUTH");
    expect(await raw([bulk("HELLO", "3")])).toStartWith("-NOAUTH");
  });

  it("reads a first command split across packets and passes pipelined bytes on", async () => {
    const auth = bulk("AUTH", "evertap_aaaa", "pwA");
    const reply = await raw([auth.slice(0, 5), auth.slice(5, 23), auth.slice(23) + bulk("PING")]);
    expect(reply).toBe("+OK\r\n+PONG\r\n");
    const hello = await raw([bulk("HELLO", "2", "AUTH", "evertap_bbbb", "pwB", "SETNAME", "t")]);
    expect(hello).toContain("redis");
  });

  it("carries large values both ways", async () => {
    const client = open(a.connectionUrl);
    const big = "x".repeat(8 * 1024 * 1024);
    await client.set("big", big);
    expect((await client.get("big"))?.length).toBe(big.length);
    await client.del("big");
    client.close();
  });
});

describe("data", () => {
  it("writes and reads every editable type", async () => {
    await driver.writeKey(a, {
      id: a.id,
      key: "s",
      value: { type: "string", value: "hi" },
      ttlMs: null,
      createOnly: false,
    });
    await driver.writeKey(a, {
      id: a.id,
      key: "h",
      value: { type: "hash", entries: [{ field: "f", value: "v" }] },
      ttlMs: 60_000,
      createOnly: false,
    });
    await driver.writeKey(a, {
      id: a.id,
      key: "l",
      value: { type: "list", items: ["1", "2"] },
      ttlMs: null,
      createOnly: false,
    });
    await driver.writeKey(a, {
      id: a.id,
      key: "st",
      value: { type: "set", members: ["m"] },
      ttlMs: null,
      createOnly: false,
    });
    await driver.writeKey(a, {
      id: a.id,
      key: "z",
      value: { type: "zset", members: [{ member: "m", score: 1.5 }] },
      ttlMs: null,
      createOnly: false,
    });

    expect(await driver.readKey(a, "s")).toEqual({
      key: "s",
      type: "string",
      ttlMs: null,
      value: { type: "string", value: "hi" },
      truncated: false,
    });
    const hash = await driver.readKey(a, "h");
    expect(hash?.value).toEqual({ type: "hash", entries: [{ field: "f", value: "v" }] });
    expect(hash?.ttlMs).toBeGreaterThan(50_000);
    expect((await driver.readKey(a, "l"))?.value).toEqual({ type: "list", items: ["1", "2"] });
    expect((await driver.readKey(a, "st"))?.value).toEqual({ type: "set", members: ["m"] });
    expect((await driver.readKey(a, "z"))?.value).toEqual({
      type: "zset",
      members: [{ member: "m", score: 1.5 }],
    });
    expect(await driver.readKey(a, "missing")).toBeNull();
    expect(await driver.readKey(b, "s")).toBeNull();
  });

  it("replaces a value, including its type and expiry", async () => {
    await driver.writeKey(a, {
      id: a.id,
      key: "h",
      value: { type: "list", items: ["x"] },
      ttlMs: null,
      createOnly: false,
    });
    const replaced = await driver.readKey(a, "h");
    expect(replaced?.value).toEqual({ type: "list", items: ["x"] });
    expect(replaced?.ttlMs).toBeNull();
  });

  it("refuses an empty collection", async () => {
    const write = driver.writeKey(a, {
      id: a.id,
      key: "e",
      value: { type: "set", members: [] },
      ttlMs: null,
      createOnly: false,
    });
    const error = await failure(write);
    expect(error).toBeInstanceOf(DataError);
    expect(String(error)).toContain("Add at least one item, or delete the key");
  });

  it("truncates long values and leaves other types read-only", async () => {
    const client = open(a.connectionUrl);
    const many = Array.from({ length: REDIS_VALUE_MAX + 5 }, (_, index) => String(index));
    await client.send("RPUSH", ["long-list", ...many]);
    await client.send("SADD", ["long-set", ...many]);
    await client.send("HSET", ["long-hash", ...many.flatMap((item) => [item, item])]);
    await client.send("ZADD", ["long-zset", ...many.flatMap((item) => [item, item])]);
    await client.send("XADD", ["events", "*", "k", "v"]);
    client.close();

    for (const key of ["long-list", "long-set", "long-hash", "long-zset"]) {
      const read = await driver.readKey(a, key);
      expect(read?.truncated).toBe(true);
      const value = read?.value;
      const length =
        value?.type === "list"
          ? value.items.length
          : value?.type === "hash"
            ? value.entries.length
            : value?.type === "set" || value?.type === "zset"
              ? value.members.length
              : -1;
      expect(length).toBe(REDIS_VALUE_MAX);
    }
    expect(await driver.readKey(a, "events")).toEqual({
      key: "events",
      type: "stream",
      ttlMs: null,
      value: null,
      truncated: false,
    });
  });

  it("leaves values it cannot write back as they were read-only", async () => {
    const client = open(a.connectionUrl);
    // Lua builds the byte 0xff, which is not UTF-8.
    await client.send("EVAL", [
      `local bad = 'a' .. string.char(255)
       redis.call('SET', KEYS[1], bad)
       redis.call('RPUSH', KEYS[2], 'ok', bad)
       redis.call('HSET', KEYS[3], bad, 'v')
       redis.call('SADD', KEYS[4], bad)
       redis.call('ZADD', KEYS[5], 1, bad)
       return 1`,
      "5",
      "bin-string",
      "bin-list",
      "bin-hash",
      "bin-set",
      "bin-zset",
    ]);
    await client.send("ZADD", ["inf-zset", "inf", "top", "1", "one"]);
    await client.send("SET", ["huge-string", "x".repeat(REDIS_STRING_MAX + 1)]);
    await client.send("SET", ["max-string", "é".repeat(REDIS_STRING_MAX / 2)]);
    client.close();

    for (const key of ["bin-string", "bin-list", "bin-hash", "bin-set", "bin-zset", "inf-zset"]) {
      const read = await driver.readKey(a, key);
      expect(read?.value, key).toBeNull();
      expect(read?.truncated, key).toBe(false);
    }
    const huge = await driver.readKey(a, "huge-string");
    expect(huge?.type).toBe("string");
    expect(huge?.value).toBeNull();
    const max = await driver.readKey(a, "max-string");
    expect(max?.value?.type === "string" && max.value.value.length).toBe(REDIS_STRING_MAX / 2);
  });

  it("creates only when asked, without replacing an existing key", async () => {
    const write = (key: string, value: string) =>
      driver.writeKey(a, {
        id: a.id,
        key,
        value: { type: "string", value },
        ttlMs: null,
        createOnly: true,
      });
    await write("fresh", "first");
    const error = await failure(write("fresh", "second"));
    expect(error).toBeInstanceOf(DataError);
    expect(String(error)).toContain("A key with that name already exists. Choose another name");
    expect((await driver.readKey(a, "fresh"))?.value).toEqual({ type: "string", value: "first" });
  });

  it("changes the expiry without touching the value", async () => {
    await driver.writeKey(a, {
      id: a.id,
      key: "exp",
      value: { type: "list", items: ["1", "2"] },
      ttlMs: null,
      createOnly: false,
    });
    await driver.expireKey(a, { id: a.id, key: "exp", ttlMs: 60_000 });
    const expiring = await driver.readKey(a, "exp");
    expect(expiring?.ttlMs).toBeGreaterThan(50_000);
    expect(expiring?.value).toEqual({ type: "list", items: ["1", "2"] });

    await driver.expireKey(a, { id: a.id, key: "exp", ttlMs: null });
    expect((await driver.readKey(a, "exp"))?.ttlMs).toBeNull();
    // Removing an expiry that is not there is fine.
    await driver.expireKey(a, { id: a.id, key: "exp", ttlMs: null });

    for (const ttlMs of [60_000, null]) {
      const error = await failure(driver.expireKey(a, { id: a.id, key: "gone", ttlMs }));
      expect(error).toBeInstanceOf(DataError);
      expect(String(error)).toContain("That key no longer exists. Search the keys again");
    }
  });

  it("scans by pattern with type and TTL", async () => {
    const found = new Map<string, { type: string; ttlMs: number | null }>();
    let cursor = "0";
    do {
      const page = await driver.scanKeys(a, { id: a.id, pattern: "long-*", cursor, count: 2 });
      for (const { key, type, ttlMs } of page.keys) {
        found.set(key, { type, ttlMs });
      }
      cursor = page.cursor;
    } while (cursor !== "0");
    expect([...found.keys()].toSorted()).toEqual([
      "long-hash",
      "long-list",
      "long-set",
      "long-zset",
    ]);
    expect(found.get("long-zset")).toEqual({ type: "zset", ttlMs: null });

    await driver.writeKey(a, {
      id: a.id,
      key: "temp",
      value: { type: "string", value: "t" },
      ttlMs: 30_000,
      createOnly: false,
    });
    const temp = await driver.scanKeys(a, { id: a.id, pattern: "temp", cursor: "0", count: 100 });
    expect(temp.keys[0]?.ttlMs).toBeGreaterThan(20_000);
    expect(
      (await driver.scanKeys(b, { id: b.id, pattern: "*", cursor: "0", count: 100 })).keys,
    ).toEqual([]);
  });

  it("passes Redis's complaint on as a DataError", async () => {
    const scan = driver.scanKeys(a, { id: a.id, pattern: "*", cursor: "nope", count: 10 });
    expect(await failure(scan)).toBeInstanceOf(DataError);
  });

  it("deletes keys", async () => {
    await driver.deleteKey(a, "s");
    await driver.deleteKey(a, "never-there");
    expect(await driver.readKey(a, "s")).toBeNull();
  });
});

describe("usage", () => {
  it("reports size and connections that came and went between polls", async () => {
    await driver.usage([a, b]);
    const client = open(a.connectionUrl);
    await client.send("PING", []);
    const during = await driver.usage([a, b]);
    expect(during.get(a.id)?.connected).toBe(true);
    expect(during.get(b.id)?.connected).toBe(false);
    expect(during.get(a.id)?.sizeBytes).toBeGreaterThan(0);

    const shortLived = open(b.connectionUrl);
    await shortLived.send("PING", []);
    shortLived.close();
    client.close();
    await Bun.sleep(100);
    const after = await driver.usage([a, b]);
    expect(after.get(b.id)?.connected).toBe(true);
    expect(after.get(a.id)?.connected).toBe(true);
    const quiet = await driver.usage([a, b]);
    expect(quiet.get(a.id)?.connected).toBe(false);
    expect(quiet.get(b.id)?.connected).toBe(false);
  });
});

describe("lifecycle", () => {
  it("keeps the keys when a later release replaces the instances", async () => {
    const client = open(a.connectionUrl);
    await client.set("kept", "yes");
    client.close();
    const names = [a, b].map((row) => `${context.prefix}-redis-${row.id}`);
    const before = await Promise.all(names.map(containerId));
    await driver.close();
    driver = createRedisDriver(laterRelease(context));
    await driver.start([a, b]);
    const after = await Promise.all(names.map(containerId));
    after.forEach((id, index) => {
      expect(id).not.toBe(before[index]);
    });
    // `start` does not wait for an instance to load its data, so give each a moment to answer.
    const answering = async (url: string) => {
      for (let attempt = 0; ; attempt++) {
        const probe = open(url);
        try {
          await probe.send("PING", []);
          return probe;
        } catch (error) {
          probe.close();
          if (attempt > 100) {
            throw error;
          }
          await Bun.sleep(100);
        }
      }
    };
    const again = await answering(a.connectionUrl);
    try {
      expect(await again.get("kept")).toBe("yes");
    } finally {
      again.close();
    }
    (await answering(b.connectionUrl)).close();
  });
});

describe("drop", () => {
  it("removes the instance and its data", async () => {
    const client = open(b.connectionUrl);
    await client.send("PING", []);
    await driver.drop(b);
    await Bun.sleep(100);
    expect(client.connected).toBe(false);
    const again = open(b.connectionUrl);
    expect(await failure(again.send("PING", []))).toBeInstanceOf(Error);
    expect(await driver.readKey(a, "l")).not.toBeNull();
  });
});
