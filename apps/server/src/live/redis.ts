import { createHash } from "node:crypto";

import { DataError } from "@evertap/api/context";
import {
  REDIS_STRING_MAX,
  REDIS_VALUE_MAX,
  type Database,
  type RedisKey,
  type RedisValue,
  type WriteKeyInput,
} from "@evertap/api/schemas";
import { RedisClient } from "bun";

import type { ContainerSpec } from "./docker.ts";
import type { DriverContext, RedisDriver, Usage } from "./driver.ts";
import { DATABASE_IMAGES } from "./images.ts";
import { startRedisProxy, type RedisProxy } from "./redis-proxy.ts";

const USER_PREFIX = "evertap_";
const REDIS_PORT = "6379/tcp";
const instanceImage = (version: string) => DATABASE_IMAGES.redis[version] ?? `redis:${version}`;
const READY_TIMEOUT_MS = 60_000;

const credentials = (resource: Database) => {
  const url = new URL(resource.connectionUrl);
  return {
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
};

const isRedisReply = (error: unknown): error is Error =>
  error instanceof Error && "code" in error && error.code === "ERR_REDIS_SERVER_ERROR";

/** A Redis error reply is about the request; anything else (a lost connection) is a fault. */
const passRedisErrors = async <T>(run: () => Promise<T>) => {
  try {
    return await run();
  } catch (error) {
    if (isRedisReply(error)) {
      throw new DataError(error.message, { cause: error });
    }
    throw error;
  }
};

const strict = new TextDecoder("utf-8", { fatal: true });

/**
 * Bun decodes every reply as UTF-8 and puts U+FFFD where the bytes are not; such a value cannot be
 * written back as it was. A real U+FFFD in the data is caught too and only costs editing.
 */
const lossy = (texts: string[]) => texts.some((text) => text.includes("\uFFFD"));

const READ_ONLY = { value: null, truncated: false };

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item)) : [];

const pairs = (flat: string[]) => {
  const out: [string, string][] = [];
  for (let index = 0; index + 1 < flat.length; index += 2) {
    out.push([flat[index] ?? "", flat[index + 1] ?? ""]);
  }
  return out;
};

const connect = (port: number, username: string, password: string) =>
  new RedisClient(
    `redis://${encodeURIComponent(username)}:${encodeURIComponent(password)}@127.0.0.1:${port}`,
    { autoReconnect: false, connectionTimeout: 5000 },
  );

/** HSCAN / SSCAN until `REDIS_VALUE_MAX` elements (each `width` strings) or the end. */
const scanAll = async (client: RedisClient, command: string, key: string, width: number) => {
  const out: string[] = [];
  let cursor = "0";
  do {
    const reply: unknown = await client.send(command, [key, cursor, "COUNT", "500"]);
    const [next, batch] = Array.isArray(reply) ? reply : [];
    cursor = String(next ?? "0");
    out.push(...strings(batch));
  } while (cursor !== "0" && out.length < REDIS_VALUE_MAX * width);
  // A dict can be rehashing mid-scan and return an element twice; keep each once.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (let index = 0; index < out.length; index += width) {
    const element = out[index] ?? "";
    if (!seen.has(element)) {
      seen.add(element);
      unique.push(...out.slice(index, index + width));
    }
  }
  return unique.slice(0, REDIS_VALUE_MAX * width);
};

const read = async (
  client: RedisClient,
  key: string,
  type: string,
): Promise<{ value: RedisValue | null; truncated: boolean }> => {
  switch (type) {
    case "string": {
      if (Number(await client.send("STRLEN", [key])) > REDIS_STRING_MAX) {
        return READ_ONLY;
      }
      const bytes = await client.getBuffer(key);
      if (bytes === null) {
        return READ_ONLY;
      }
      try {
        return { value: { type, value: strict.decode(bytes) }, truncated: false };
      } catch {
        return READ_ONLY;
      }
    }
    case "hash": {
      const [length, fields] = await Promise.all([
        client.send("HLEN", [key]),
        scanAll(client, "HSCAN", key, 2),
      ]);
      if (lossy(fields)) {
        return READ_ONLY;
      }
      const entries = pairs(fields).map(([field, value]) => ({ field, value }));
      return { value: { type, entries }, truncated: Number(length) > entries.length };
    }
    case "list": {
      const [length, items] = await Promise.all([
        client.send("LLEN", [key]),
        client.send("LRANGE", [key, "0", String(REDIS_VALUE_MAX - 1)]),
      ]);
      const list = strings(items);
      if (lossy(list)) {
        return READ_ONLY;
      }
      return { value: { type, items: list }, truncated: Number(length) > list.length };
    }
    case "set": {
      const [length, members] = await Promise.all([
        client.send("SCARD", [key]),
        scanAll(client, "SSCAN", key, 1),
      ]);
      if (lossy(members)) {
        return READ_ONLY;
      }
      return { value: { type, members }, truncated: Number(length) > members.length };
    }
    case "zset": {
      const [length, range] = await Promise.all([
        client.send("ZCARD", [key]),
        client.send("ZRANGE", [key, "0", String(REDIS_VALUE_MAX - 1), "WITHSCORES"]),
      ]);
      // RESP3 answers WITHSCORES as [member, score] pairs.
      const members = (Array.isArray(range) ? range : []).map((pair: unknown) => ({
        member: String(Array.isArray(pair) ? pair[0] : ""),
        score: Number(Array.isArray(pair) ? pair[1] : Number.NaN),
      }));
      // JSON has no infinity, so such a score could not travel to the browser and back.
      if (
        lossy(members.map(({ member }) => member)) ||
        members.some(({ score }) => !Number.isFinite(score))
      ) {
        return READ_ONLY;
      }
      return { value: { type, members }, truncated: Number(length) > members.length };
    }
    default:
      return READ_ONLY;
  }
};

const EXISTING_KEY = "A key with that name already exists. Choose another name";
const MISSING_KEY = "That key no longer exists. Search the keys again";

const writeCommands = ({ key, value, ttlMs }: WriteKeyInput): [string, string[]][] => {
  const commands: [string, string[]][] = [["DEL", [key]]];
  switch (value.type) {
    case "string":
      commands.push(["SET", [key, value.value]]);
      break;
    case "hash":
      commands.push(["HSET", [key, ...value.entries.flatMap(({ field, value: v }) => [field, v])]]);
      break;
    case "list":
      commands.push(["RPUSH", [key, ...value.items]]);
      break;
    case "set":
      commands.push(["SADD", [key, ...value.members]]);
      break;
    case "zset":
      commands.push([
        "ZADD",
        [key, ...value.members.flatMap(({ member, score }) => [String(score), member])],
      ]);
      break;
  }
  if (ttlMs !== null) {
    commands.push(["PEXPIRE", [key, String(ttlMs)]]);
  }
  return commands;
};

const empty = (value: RedisValue) =>
  (value.type === "hash" && value.entries.length === 0) ||
  (value.type === "list" && value.items.length === 0) ||
  ((value.type === "set" || value.type === "zset") && value.members.length === 0);

/**
 * One Redis instance per resource: ACLs cannot confine a user to one logical database, so a shared
 * instance would let one resource read or flush another's keys. Clients reach every instance
 * through one entry that routes by username.
 */
export const createRedisDriver = (context: DriverContext): RedisDriver => {
  const { docker, metadata, prefix } = context;
  const containerName = (id: string) => `${prefix}-redis-${id}`;
  /** Host ports of the instances, filled as they are started or looked up. */
  const ports = new Map<string, number>();
  /** Evertap's own connection per resource, straight to its instance. */
  const clients = new Map<string, RedisClient>();
  let proxy: RedisProxy | null = null;

  const spec = (id: string, version: string, password: string): ContainerSpec => ({
    name: containerName(id),
    image: instanceImage(version),
    cmd: [
      "redis-server",
      "--appendonly",
      "yes",
      "--user",
      "default",
      "off",
      // The hash keeps the password out of `docker inspect`.
      "--user",
      `${USER_PREFIX}${id}`,
      "on",
      `#${createHash("sha256").update(password).digest("hex")}`,
      "~*",
      "&*",
      "+@all",
    ],
    ports: { [REDIS_PORT]: { hostIp: "127.0.0.1", hostPort: 0 } },
    volumes: { [containerName(id)]: "/data" },
  });

  const ensure = async (id: string, version: string, password: string) => {
    const info = await docker.ensureContainer(spec(id, version, password));
    const port = info.ports[REDIS_PORT];
    if (!port) {
      throw new Error(`${containerName(id)} has no published port`);
    }
    ports.set(id, port);
    return port;
  };

  const portOf = async (id: string) => {
    const known = ports.get(id);
    if (known !== undefined) {
      return known;
    }
    const port = (await docker.inspect(containerName(id)))?.ports[REDIS_PORT];
    if (port === undefined) {
      throw new Error(`${containerName(id)} is not running`);
    }
    ports.set(id, port);
    return port;
  };

  const waitReady = async (port: number, username: string, password: string) => {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    for (;;) {
      const client = connect(port, username, password);
      try {
        // PING also fails while the instance is still loading its data.
        await client.send("PING", []);
        return;
      } catch (error) {
        if (Date.now() > deadline) {
          throw error;
        }
      } finally {
        client.close();
      }
      await Bun.sleep(200);
    }
  };

  const forget = (id: string) => {
    ports.delete(id);
    clients.get(id)?.close();
    clients.delete(id);
  };

  const clientFor = async (resource: Database) => {
    const port = await portOf(resource.id);
    const existing = clients.get(resource.id);
    if (existing) {
      return existing;
    }
    const { username, password } = credentials(resource);
    const client = connect(port, username, password);
    // The next request looks the port up again: a recreated instance gets a new one.
    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- RedisClient has no addEventListener
    client.onclose = () => {
      if (clients.get(resource.id) === client) {
        forget(resource.id);
      }
    };
    clients.set(resource.id, client);
    return client;
  };

  const resolve = async (username: string) => {
    if (!username.startsWith(USER_PREFIX)) {
      return null;
    }
    const id = username.slice(USER_PREFIX.length);
    if (!ports.has(id)) {
      const row = metadata.getResource(id);
      if (row?.kind !== "database" || row.engine !== "redis") {
        return null;
      }
    }
    return { id, port: await portOf(id) };
  };

  return {
    images: (version) => [instanceImage(version)],

    start: async (resources) => {
      if (!proxy) {
        proxy = startRedisProxy({
          ...context.entry(),
          resolve,
          unreachable: forget,
        });
      }
      for (const resource of resources) {
        try {
          await ensure(resource.id, resource.version, credentials(resource).password);
        } catch (error) {
          console.error(`starting ${resource.name}:`, error);
        }
      }
    },

    provision: async ({ id, version, password }) => {
      const username = `${USER_PREFIX}${id}`;
      try {
        await waitReady(await ensure(id, version, password), username, password);
      } catch (error) {
        // Nothing records a resource that failed to provision, so leave no instance behind.
        forget(id);
        await docker.remove(containerName(id), [containerName(id)]);
        throw error;
      }
      return {
        connectionUrl: `redis://${username}:${password}@${context.urlHost}:${context.urlPort}/0`,
      };
    },

    drop: async (resource) => {
      forget(resource.id);
      await docker.remove(containerName(resource.id), [containerName(resource.id)]);
    },

    usage: async (resources) => {
      const usage = new Map<string, Usage>();
      await Promise.all(
        resources.map(async (resource) => {
          try {
            const client = await clientFor(resource);
            const info = String(await client.send("INFO", ["persistence"]));
            const size = /^aof_current_size:(\d+)/m.exec(info)?.[1];
            usage.set(resource.id, {
              // The append-only file's size on disk: INFO memory reports ~0.5 MB for an empty
              // instance, which would read as data.
              sizeBytes: Number(size ?? 0),
              connected: proxy?.takeConnected(resource.id) ?? false,
            });
          } catch (error) {
            console.error(`usage for ${resource.name}:`, error);
          }
        }),
      );
      return usage;
    },

    rebind: () => {
      proxy?.move(context.entry());
    },

    close: async () => {
      proxy?.stop();
      proxy = null;
      for (const id of clients.keys()) {
        forget(id);
      }
    },

    scanKeys: async (resource, input) => {
      const client = await clientFor(resource);
      return passRedisErrors(async () => {
        const reply: unknown = await client.send("SCAN", [
          input.cursor,
          "MATCH",
          input.pattern,
          "COUNT",
          String(input.count),
        ]);
        const [cursor, batch] = Array.isArray(reply) ? reply : [];
        const keys = strings(batch);
        const details = await Promise.all(
          keys.map(async (key) => {
            const [type, pttl] = await Promise.all([
              client.send("TYPE", [key]),
              client.send("PTTL", [key]),
            ]);
            return { key, type: String(type), ttl: Number(pttl) };
          }),
        );
        return {
          // A key can expire between SCAN and TYPE; TYPE then answers "none".
          keys: details
            .filter(({ type }) => type !== "none")
            .map(({ key, type, ttl }) => ({ key, type, ttlMs: ttl >= 0 ? ttl : null })),
          cursor: String(cursor ?? "0"),
        };
      });
    },

    readKey: async (resource, key) => {
      const client = await clientFor(resource);
      return passRedisErrors(async (): Promise<RedisKey | null> => {
        const [type, pttl] = await Promise.all([
          client.send("TYPE", [key]),
          client.send("PTTL", [key]),
        ]);
        if (type === "none") {
          return null;
        }
        const { value, truncated } = await read(client, key, String(type));
        const ttl = Number(pttl);
        return { key, type: String(type), ttlMs: ttl >= 0 ? ttl : null, value, truncated };
      });
    },

    writeKey: async (resource, input) => {
      if (empty(input.value)) {
        throw new DataError("Add at least one item, or delete the key");
      }
      // A connection of its own: another request's commands on the shared client would land
      // inside this MULTI.
      const { username, password } = credentials(resource);
      const client = connect(await portOf(resource.id), username, password);
      try {
        await passRedisErrors(async () => {
          if (input.createOnly) {
            // EXEC runs nothing if the key changed after WATCH, so no one else's key is replaced.
            await client.send("WATCH", [input.key]);
            if (Number(await client.send("EXISTS", [input.key])) > 0) {
              throw new DataError(EXISTING_KEY);
            }
          }
          await client.send("MULTI", []);
          for (const [command, args] of writeCommands(input)) {
            await client.send(command, args);
          }
          const results: unknown = await client.send("EXEC", []);
          if (results === null) {
            throw new DataError(EXISTING_KEY);
          }
          const failed = Array.isArray(results)
            ? results.find((result) => result instanceof Error)
            : undefined;
          if (failed instanceof Error) {
            throw new DataError(failed.message, { cause: failed });
          }
        });
      } finally {
        client.close();
      }
    },

    expireKey: async (resource, { key, ttlMs }) => {
      const client = await clientFor(resource);
      await passRedisErrors(async () => {
        const changed = Number(
          ttlMs === null
            ? await client.send("PERSIST", [key])
            : await client.send("PEXPIRE", [key, String(ttlMs)]),
        );
        // PERSIST also answers 0 for a key that had no expiry.
        if (changed === 0 && Number(await client.send("EXISTS", [key])) === 0) {
          throw new DataError(MISSING_KEY);
        }
      });
    },

    deleteKey: async (resource, key) => {
      const client = await clientFor(resource);
      await passRedisErrors(() => client.send("UNLINK", [key]));
    },
  };
};
