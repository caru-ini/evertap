import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DataError, UnavailableError } from "@evertap/api/context";
import { z } from "zod";

import { ISOLATED_BRIDGE, createDocker } from "./docker.ts";

// A stand-in Docker that lists everything it is asked about, as its name filter matches anywhere in
// a name, and records what it is told to delete.
const dir = await mkdtemp(join(tmpdir(), "evertap-docker-"));
const socket = join(dir, "docker.sock");
const deleted: string[] = [];
let requests = 0;

const fake = Bun.serve({
  unix: socket,
  fetch: (request) => {
    requests += 1;
    const { pathname } = new URL(request.url);
    if (pathname === "/version") {
      return Response.json({ Version: "27.3.1", ApiVersion: "1.47", MinAPIVersion: "1.24" });
    }
    if (request.method === "DELETE") {
      deleted.push(decodeURIComponent(pathname.replace(/^\/v[\d.]+/, "")));
      return new Response(null, { status: 204 });
    }
    if (pathname.endsWith("/containers/json")) {
      return Response.json([
        { Names: ["/evertap-proxysql"] },
        { Names: ["/evertapx-proxysql"] },
        { Names: ["/x-evertap-proxysql"] },
      ]);
    }
    if (pathname.endsWith("/volumes")) {
      return Response.json({
        Volumes: [
          { Name: "evertap-postgres-18" },
          { Name: "evertap_site_data" },
          { Name: "evertapx-v" },
          { Name: "x-evertap-v" },
        ],
      });
    }
    return Response.json([
      { Name: "evertap" },
      { Name: "evertap-isolated" },
      { Name: "evertap-test-postgresql" },
      { Name: "evertap-test-postgresql-isolated" },
    ]);
  },
});

const docker = await createDocker({ socket, network: "evertap" });

beforeEach(() => {
  deleted.length = 0;
  requests = 0;
});

afterAll(async () => {
  await fake.stop(true);
  await rm(dir, { recursive: true, force: true });
});

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => "",
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

test("refuses a prefix that would match names it does not own, before asking Docker", async () => {
  for (const prefix of ["", "-evertap", "ever tap", "../evertap", "evertap/x"]) {
    expect(await refusal(docker.listByPrefix(prefix))).toContain("is not a name prefix");
    expect(await refusal(docker.removeByPrefix(prefix))).toContain("is not a name prefix");
  }
  expect(requests).toBe(0);
});

test("lists only names that start with the prefix and a dash, and its own two networks", async () => {
  expect(await docker.listByPrefix("evertap")).toEqual({
    containers: ["evertap-proxysql"],
    volumes: ["evertap-postgres-18"],
    networks: ["evertap", "evertap-isolated"],
  });
});

test("removes only what it lists", async () => {
  await docker.removeByPrefix("evertap");
  expect(deleted).toEqual([
    "/containers/evertap-proxysql",
    "/volumes/evertap-postgres-18",
    "/networks/evertap",
    "/networks/evertap-isolated",
  ]);
});

type FakeContainer = { labels: Record<string, string>; running: boolean };

/**
 * A stand-in Docker that keeps containers and images in memory and records each call. A download
 * waits for `downloads.release` when `downloads.hold` is set.
 */
const fakeEngine = async () => {
  const engineDir = await mkdtemp(join(tmpdir(), "evertap-engine-"));
  const engineSocket = join(engineDir, "docker.sock");
  const calls: string[] = [];
  const containers = new Map<string, FakeContainer>();
  /** What each container and network was created with. */
  const bodies = new Map<string, unknown>();
  const networks = new Set(["evertap"]);
  const images = new Set<string>();
  const downloads = { hold: false, release: Promise.withResolvers<void>(), error: "" };
  const server = Bun.serve({
    unix: engineSocket,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/version") {
        return Response.json({ Version: "27.3.1", ApiVersion: "1.47", MinAPIVersion: "1.24" });
      }
      const path = decodeURIComponent(url.pathname.replace(/^\/v[\d.]+/, ""));
      calls.push(`${request.method} ${path}${decodeURIComponent(url.search)}`);
      if (path === "/containers/create") {
        const json: unknown = await request.json();
        const body = z.object({ Labels: z.record(z.string(), z.string()) }).parse(json);
        const name = url.searchParams.get("name") ?? "";
        containers.set(name, { labels: body.Labels, running: false });
        bodies.set(name, json);
        return Response.json({}, { status: 201 });
      }
      if (path === "/networks/create") {
        const json: unknown = await request.json();
        const name = z.object({ Name: z.string() }).parse(json).Name;
        networks.add(name);
        bodies.set(name, json);
        return Response.json({}, { status: 201 });
      }
      if (path === "/images/create") {
        const image = `${url.searchParams.get("fromImage")}:${url.searchParams.get("tag")}`;
        if (downloads.hold) {
          await downloads.release.promise;
        }
        if (downloads.error) {
          return new Response(
            `{"status":"Pulling"}\n{"errorDetail":{"message":"${downloads.error}"}}\n`,
          );
        }
        images.add(image);
        return new Response('{"status":"Pulling"}\n{"status":"Downloaded newer image"}\n');
      }
      if (path.startsWith("/images/")) {
        const image = path.replace(/^\/images\/(.*)\/json$/, "$1");
        return images.has(image) ? Response.json({}) : new Response(null, { status: 404 });
      }
      if (path.startsWith("/networks/")) {
        return networks.has(path.slice("/networks/".length))
          ? Response.json({})
          : new Response(null, { status: 404 });
      }
      const [containerName = "", verb = ""] = path.replace(/^\/containers\//, "").split("/");
      const found = containers.get(containerName);
      if (!found) {
        return new Response(null, { status: 404 });
      }
      if (request.method === "DELETE") {
        containers.delete(containerName);
        return new Response(null, { status: 204 });
      }
      if (verb === "start" || verb === "stop") {
        found.running = verb === "start";
        return new Response(null, { status: 204 });
      }
      return Response.json({
        Config: { Labels: found.labels },
        State: { Running: found.running },
        HostConfig: { PortBindings: null },
        NetworkSettings: { Ports: null },
      });
    },
  });
  const engineDocker = await createDocker({ socket: engineSocket, network: "evertap" });
  const stop = async () => {
    await server.stop(true);
    await rm(engineDir, { recursive: true, force: true });
  };
  return { docker: engineDocker, calls, containers, bodies, images, downloads, stop };
};

const entry = (image: string) => ({
  name: "evertap-proxysql",
  image,
  ports: { "6033/tcp": { hostIp: "127.0.0.1", hostPort: 0 } },
  volumes: { "evertap-proxysql": "/data" },
});

describe("containers", () => {
  test("keeps one made from the same spec", async () => {
    const engine = await fakeEngine();
    engine.images.add("proxysql/proxysql:v1");
    await engine.docker.ensureContainer(entry("proxysql/proxysql:v1"));
    engine.calls.length = 0;
    await engine.docker.ensureContainer(entry("proxysql/proxysql:v1"));
    expect(engine.calls).toEqual(["GET /containers/evertap-proxysql/json"]);
    await engine.stop();
  });

  test("replaces one made from another spec once the new image is here, keeping its volumes", async () => {
    const engine = await fakeEngine();
    engine.images.add("proxysql/proxysql:v1");
    await engine.docker.ensureContainer(entry("proxysql/proxysql:v1"));
    engine.calls.length = 0;
    await engine.docker.ensureContainer(entry("proxysql/proxysql:v2"));
    expect(engine.calls).toEqual([
      "GET /containers/evertap-proxysql/json",
      "GET /images/proxysql/proxysql:v2/json",
      "POST /images/create?fromImage=proxysql/proxysql&tag=v2",
      "GET /networks/evertap",
      "POST /containers/evertap-proxysql/stop?t=60",
      "DELETE /containers/evertap-proxysql?force=true&v=true",
      "POST /containers/create?name=evertap-proxysql",
      "POST /containers/evertap-proxysql/start",
      "GET /containers/evertap-proxysql/json",
    ]);
    expect(engine.containers.get("evertap-proxysql")?.running).toBe(true);
    await engine.stop();
  });

  test("puts an isolated one on a network of its own, where containers cannot reach each other or pass for a proxy", async () => {
    const engine = await fakeEngine();
    engine.images.add("pgvector/pgvector:pg18");
    const spec = {
      name: "evertap-postgres-a1",
      image: "pgvector/pgvector:pg18",
      network: "isolated",
      init: true,
    } as const;
    await engine.docker.ensureContainer(spec);
    await engine.docker.ensureContainer({ ...spec, name: "evertap-postgres-b1" });
    expect(engine.calls.filter((call) => call.includes("/networks/"))).toEqual([
      "GET /networks/evertap-isolated",
      "POST /networks/create",
      "GET /networks/evertap-isolated",
    ]);
    expect(engine.bodies.get("evertap-isolated")).toMatchObject({
      Options: {
        "com.docker.network.bridge.enable_icc": "false",
        "com.docker.network.bridge.name": expect.stringMatching(ISOLATED_BRIDGE),
      },
    });
    expect(engine.bodies.get("evertap-postgres-a1")).toMatchObject({
      HostConfig: { NetworkMode: "evertap-isolated", Init: true },
    });
    await engine.stop();
  });

  test("replaces one an older evertap made without a spec", async () => {
    const engine = await fakeEngine();
    engine.images.add("proxysql/proxysql:v1");
    engine.containers.set("evertap-proxysql", {
      labels: { "evertap.managed": "true" },
      running: true,
    });
    await engine.docker.ensureContainer(entry("proxysql/proxysql:v1"));
    expect(engine.calls).toContain("DELETE /containers/evertap-proxysql?force=true&v=true");
    expect(engine.containers.get("evertap-proxysql")?.labels["evertap.spec"]).toMatch(
      /^[0-9a-f]{64}$/,
    );
    await engine.stop();
  });

  test("keeps the one it has, started, when the new image cannot be downloaded", async () => {
    const engine = await fakeEngine();
    engine.images.add("proxysql/proxysql:v1");
    await engine.docker.ensureContainer(entry("proxysql/proxysql:v1"));
    const before = engine.containers.get("evertap-proxysql");
    if (before) {
      before.running = false;
    }
    engine.downloads.error = "dial tcp: lookup registry-1.docker.io: no such host";
    engine.calls.length = 0;
    const errors = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await engine.docker.ensureContainer(entry("proxysql/proxysql:v2"))).running).toBe(
        true,
      );
    } finally {
      errors.mockRestore();
    }
    expect(engine.containers.get("evertap-proxysql")).toBe(before);
    expect(engine.calls.some((call) => call.startsWith("DELETE"))).toBe(false);
    expect(engine.calls).toContain("POST /containers/evertap-proxysql/start");
    await engine.stop();
  });

  test("leaves a container of the same name that evertap did not make", async () => {
    const engine = await fakeEngine();
    engine.images.add("proxysql/proxysql:v1");
    engine.containers.set("evertap-proxysql", { labels: {}, running: true });
    const error = await engine.docker
      .ensureContainer(entry("proxysql/proxysql:v1"))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DataError);
    expect(engine.containers.get("evertap-proxysql")?.running).toBe(true);
    expect(engine.calls.some((call) => /DELETE|stop|create/.test(call))).toBe(false);
    await engine.stop();
  });
});

describe("downloads", () => {
  test("a slow one goes on in the background while the caller is told to try again", async () => {
    const engine = await fakeEngine();
    engine.downloads.hold = true;
    const message = await refusal(engine.docker.pull(["mysql:9.7"], 20));
    expect(message).toBe(
      "This service is still downloading for its first use. Try again in a minute",
    );
    // A second ask joins the download already running instead of starting another.
    expect(await refusal(engine.docker.pull(["mysql:9.7"], 20))).toBe(message);
    engine.downloads.release.resolve();
    await engine.docker.pull(["mysql:9.7"], 1000);
    expect(engine.calls.filter((call) => call.startsWith("POST /images/create"))).toEqual([
      "POST /images/create?fromImage=mysql&tag=9.7",
    ]);
    expect(engine.images.has("mysql:9.7")).toBe(true);
    await engine.stop();
  });

  test("an image already here is not waited on, however short the wait", async () => {
    const engine = await fakeEngine();
    engine.images.add("redis:8.2");
    await engine.docker.pull(["redis:8.2"], 0);
    expect(engine.calls).toEqual(["GET /images/redis:8.2/json"]);
    await engine.stop();
  });

  test("a failed one says to check the machine is online and has room", async () => {
    const engine = await fakeEngine();
    engine.downloads.error = "toomanyrequests: rate limit";
    const error = await engine.docker.pull(["redis:8.2"], 1000).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnavailableError);
    expect(error instanceof Error ? error.message : "").toBe(
      "This service couldn't be downloaded. Check that the machine running evertap is online and has free disk space, then try again",
    );
    await engine.stop();
  });

  test("a pinned image is fetched by its digest", async () => {
    const engine = await fakeEngine();
    await engine.docker.pull(["proxysql/proxysql:v1@sha256:abc"], 1000);
    expect(engine.calls).toContain(
      "POST /images/create?fromImage=proxysql/proxysql&tag=sha256:abc",
    );
    await engine.stop();
  });
});

test("lists where the person's own containers publish, asking a stopped one for its config", async () => {
  const publishDir = await mkdtemp(join(tmpdir(), "evertap-published-"));
  const publishSocket = join(publishDir, "docker.sock");
  const asked: string[] = [];
  const server = Bun.serve({
    unix: publishSocket,
    fetch: (request) => {
      const path = new URL(request.url).pathname.replace(/^\/v[\d.]+/, "");
      asked.push(path);
      if (path === "/version") {
        return Response.json({ Version: "27.3.1", ApiVersion: "1.47", MinAPIVersion: "1.24" });
      }
      if (path === "/containers/json") {
        return Response.json([
          {
            Id: "a1",
            Names: ["/shop-db-1"],
            State: "running",
            Labels: { "com.docker.compose.project": "shop" },
            Ports: [
              { IP: "0.0.0.0", PrivatePort: 5432, PublicPort: 5432, Type: "tcp" },
              { IP: "::", PrivatePort: 5432, PublicPort: 5432, Type: "tcp" },
              { PrivatePort: 5433, Type: "tcp" },
              { IP: "0.0.0.0", PrivatePort: 53, PublicPort: 53, Type: "udp" },
            ],
          },
          { Id: "b2", Names: ["/site-minio-1"], State: "exited", Labels: null, Ports: [] },
          { Id: "c3", Names: ["/gone"], State: "exited", Labels: {}, Ports: [] },
          { Id: "d4", Names: ["/quiet"], State: "running", Labels: {}, Ports: [] },
          {
            Id: "e5",
            Names: ["/evertap-proxysql"],
            State: "running",
            Labels: { "evertap.managed": "true" },
            Ports: [{ IP: "127.0.0.1", PrivatePort: 6033, PublicPort: 32977, Type: "tcp" }],
          },
        ]);
      }
      if (path === "/containers/b2/json") {
        return Response.json({
          HostConfig: {
            PortBindings: {
              "9000/tcp": [{ HostIp: "", HostPort: "9000" }],
              "9001/tcp": [{ HostIp: "127.0.0.1", HostPort: "" }],
            },
          },
        });
      }
      return Response.json({ message: "No such container" }, { status: 404 });
    },
  });
  const engine = await createDocker({ socket: publishSocket, network: "evertap" });
  expect(await engine.published()).toEqual([
    {
      name: "shop-db-1",
      running: true,
      bindings: [
        { hostIp: "0.0.0.0", hostPort: 5432 },
        { hostIp: "::", hostPort: 5432 },
      ],
    },
    { name: "site-minio-1", running: false, bindings: [{ hostIp: "0.0.0.0", hostPort: 9000 }] },
  ]);
  // Running containers report their ports in the list; only stopped ones are asked.
  expect(asked.filter((path) => path.endsWith("/json") && path !== "/containers/json")).toEqual([
    "/containers/b2/json",
    "/containers/c3/json",
  ]);
  await server.stop(true);
  await rm(publishDir, { recursive: true, force: true });
});
