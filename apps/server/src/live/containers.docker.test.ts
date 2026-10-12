import { afterAll, beforeAll, expect, test } from "bun:test";
import { isIP } from "node:net";

import { RedisClient } from "bun";
import { z } from "zod";

import { fromProxy } from "../address.ts";
import { config } from "../config.ts";
import { type ContainerSpec, createDocker } from "./docker.ts";
import { DATABASE_IMAGES } from "./images.ts";
import { containerId } from "./testing.ts";

const PREFIX = "evertap-test-containers";
const NAME = `${PREFIX}-redis`;
const PORT = "6379/tcp";

const docker = await createDocker({ socket: config.dockerSocket, network: PREFIX });

const spec = (image: string): ContainerSpec => ({
  name: NAME,
  image,
  cmd: ["redis-server", "--appendonly", "yes"],
  ports: { [PORT]: { hostIp: "127.0.0.1", hostPort: 0 } },
  volumes: { [NAME]: "/data" },
});

const image = async () => {
  const response = await fetch(`http://docker/containers/${NAME}/json`, {
    unix: config.dockerSocket,
  });
  return z.object({ Config: z.object({ Image: z.string() }) }).parse(await response.json()).Config
    .Image;
};

/** The container's IPv4 address on `network`. */
const addressOn = async (name: string, network: string) => {
  const response = await fetch(`http://docker/containers/${name}/json`, {
    unix: config.dockerSocket,
  });
  const { Networks } = z
    .object({
      NetworkSettings: z.object({
        Networks: z.record(z.string(), z.object({ IPAddress: z.string() })),
      }),
    })
    .parse(await response.json()).NetworkSettings;
  const address = Networks[network]?.IPAddress ?? "";
  expect(isIP(address)).toBe(4);
  return address;
};

/** The volumes Docker made for an image's `VOLUME` that a container was given none for. */
const anonymousVolumes = async () => {
  const response = await fetch(
    `http://docker/volumes?filters=${encodeURIComponent(JSON.stringify({ label: ["com.docker.volume.anonymous"] }))}`,
    { unix: config.dockerSocket },
  );
  const { Volumes } = z
    .object({ Volumes: z.array(z.object({ Name: z.string() })).nullable() })
    .parse(await response.json());
  return (Volumes ?? []).map((volume) => volume.Name);
};

/** A client once the instance answers; it needs a moment after it starts. */
const ready = async (port: number | undefined) => {
  for (let attempt = 0; ; attempt++) {
    const client = new RedisClient(`redis://127.0.0.1:${port}`, { autoReconnect: false });
    try {
      await client.send("PING", []);
      return client;
    } catch (error) {
      client.close();
      if (attempt > 100) {
        throw error;
      }
      await Bun.sleep(100);
    }
  }
};

beforeAll(async () => {
  await docker.removeByPrefix(PREFIX);
});

afterAll(async () => {
  await docker.removeByPrefix(PREFIX);
});

test("a new image tag replaces the container, which shuts down cleanly and keeps its volume", async () => {
  const first = await docker.ensureContainer(spec("redis:7.4"));
  const before = await ready(first.ports[PORT]);
  await before.set("kept", "yes");
  before.close();
  const id = await containerId(NAME);

  await docker.ensureContainer(spec("redis:7.4"));
  expect(await containerId(NAME)).toBe(id);

  const replaced = await docker.ensureContainer(spec("redis:8.10"));
  expect(await containerId(NAME)).not.toBe(id);
  expect(await image()).toBe("redis:8.10");
  // Written just before the stop: a kill instead of a clean shutdown could lose it.
  const after = await ready(replaced.ports[PORT]);
  expect(await after.get("kept")).toBe("yes");
  after.close();
});

test("a container an older evertap made, without a spec, is replaced", async () => {
  await docker.remove(NAME);
  const created = await fetch(`http://docker/containers/create?name=${NAME}`, {
    unix: config.dockerSocket,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ Image: "redis:8.10", Labels: { "evertap.managed": "true" } }),
  });
  expect(created.status).toBe(201);
  const id = await containerId(NAME);
  await docker.ensureContainer(spec("redis:8.10"));
  expect(await containerId(NAME)).not.toBe(id);
});

test("a container on a Docker network passes for a proxy, and one on the isolated network does not", async () => {
  const isolated = `${PREFIX}-isolated-redis`;
  await docker.ensureContainer(spec("redis:8.10"));
  await docker.ensureContainer({ name: isolated, image: "redis:8.10", network: "isolated" });
  expect(fromProxy(await addressOn(NAME, PREFIX))).toBe(true);
  expect(fromProxy(await addressOn(isolated, `${PREFIX}-isolated`))).toBe(false);
});

test("a throwaway container leaves no volume behind for its image's VOLUME", async () => {
  const before = new Set(await anonymousVolumes());
  // Unlike Redis, the PostgreSQL image declares a VOLUME.
  await docker.run(
    `${PREFIX}-throwaway`,
    DATABASE_IMAGES.postgresql["18"] ?? "pgvector/pgvector:pg18",
    ["true"],
  );
  expect((await anonymousVolumes()).filter((name) => !before.has(name))).toEqual([]);
});
