import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Tunnel } from "@evertap/api/schemas";
import { z } from "zod";

import { createCloudflared } from "./cloudflared.ts";
import { createDocker } from "./docker.ts";

const NAME = "evertap-cloudflared";
const TUNNEL: Tunnel = {
  id: "c1744f8b-0000-4000-8000-000000000001",
  accountId: "account-1",
  zoneId: "zone-1",
  zone: "example.com",
  hostnames: { ui: "evertap.example.com", storage: "s3.example.com" },
  dnsRecordIds: [],
  cacheRule: { rulesetId: "ruleset-1", ruleId: "rule-1" },
  token: "run-token",
};

const createdSchema = z.object({
  Cmd: z.array(z.string()),
  Healthcheck: z.object({ Test: z.array(z.string()) }),
  Labels: z.record(z.string(), z.string()),
});

// A stand-in Docker whose containers run as soon as they are created, and that counts creates.
const root = await mkdtemp(join(tmpdir(), "evertap-cloudflared-"));
const dir = join(root, "cloudflared");
const containers = new Map<string, z.infer<typeof createdSchema>>();
let creates = 0;

const fake = Bun.serve({
  unix: join(root, "docker.sock"),
  fetch: async (request) => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/v[\d.]+/, "");
    if (path === "/version") {
      return Response.json({ Version: "27.3.1", ApiVersion: "1.47", MinAPIVersion: "1.24" });
    }
    if (path === "/containers/create") {
      containers.set(url.searchParams.get("name") ?? "", createdSchema.parse(await request.json()));
      creates += 1;
      return Response.json({ Id: "id" }, { status: 201 });
    }
    if (path.startsWith("/images/")) {
      return Response.json({});
    }
    const [, , name = "", action] = path.split("/");
    if (request.method === "DELETE") {
      containers.delete(name);
      return new Response(null, { status: 204 });
    }
    const container = containers.get(name);
    if (!container) {
      return Response.json({ message: "No such container" }, { status: 404 });
    }
    if (action === "json") {
      return Response.json({
        Config: { Labels: container.Labels },
        State: { Running: true },
        HostConfig: { PortBindings: null },
        NetworkSettings: { Ports: null },
      });
    }
    return new Response(null, { status: 204 });
  },
});

const docker = await createDocker({ socket: join(root, "docker.sock"), network: "evertap" });
const cloudflared = createCloudflared({ docker, prefix: "evertap", dir });

afterAll(async () => {
  await fake.stop(true);
  await rm(root, { recursive: true, force: true });
});

const savedPort = async () => Number(await readFile(join(dir, "metrics-port"), "utf8"));

/** A cloudflared answering about itself at `port`, serving `tunnelID` with `links` up. */
const cloudflaredAt = (port: number, tunnelID: string, links: number) =>
  Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: (request) =>
      new URL(request.url).pathname === "/diag/tunnel"
        ? Response.json({
            tunnelID,
            connectorID: "3789e9d3-07fb-49fb-86cf-fa9c36b02311",
            // Left out while none is up, as cloudflared does.
            ...(links > 0 && {
              connections: Array.from({ length: links }, (_, index) => ({
                isConnected: true,
                protocol: 1,
                index,
              })),
            }),
          })
        : Response.json({ status: 200, readyConnections: links }),
  });

test("runs cloudflared with its metrics on a free loopback port, kept while free", async () => {
  await cloudflared.sync(TUNNEL);
  const port = await savedPort();
  const container = containers.get(NAME);
  expect(container?.Cmd.slice(0, 3)).toEqual(["tunnel", "--metrics", `127.0.0.1:${port}`]);
  expect(container?.Healthcheck.Test).toEqual([
    "CMD",
    "/usr/local/bin/cloudflared",
    "tunnel",
    "--metrics",
    `127.0.0.1:${port}`,
    "ready",
  ]);
  const before = creates;
  await cloudflared.sync(TUNNEL);
  expect(await savedPort()).toBe(port);
  expect(creates).toBe(before);
  // Nothing answers there while it starts.
  expect(await cloudflared.report(TUNNEL)).toEqual({
    hostname: "evertap.example.com",
    state: "connecting",
    connections: 0,
  });
});

test("waits up to the time given for cloudflared's links to the tunnel", async () => {
  const port = await savedPort();
  expect(await cloudflared.connects(TUNNEL, 0)).toBe(false);
  let own: ReturnType<typeof cloudflaredAt> | undefined;
  const later = setTimeout(() => {
    own = cloudflaredAt(port, TUNNEL.id, 1);
  }, 200);
  try {
    expect(await cloudflared.connects(TUNNEL, 5000)).toBe(true);
  } finally {
    clearTimeout(later);
    await own?.stop(true);
  }
});

test("keeps the port its own cloudflared holds, and reads the tunnel's state there", async () => {
  const port = await savedPort();
  const own = cloudflaredAt(port, TUNNEL.id, 2);
  try {
    const before = creates;
    await cloudflared.sync(TUNNEL);
    expect(await savedPort()).toBe(port);
    expect(creates).toBe(before);
    expect(await cloudflared.report(TUNNEL)).toEqual({
      hostname: "evertap.example.com",
      state: "connected",
      connections: 2,
    });
  } finally {
    await own.stop(true);
  }
});

test("moves off a port another cloudflared took, and never reports that one's tunnel", async () => {
  const port = await savedPort();
  const other = cloudflaredAt(port, "0b0e0c1f-0000-4000-8000-000000000002", 4);
  try {
    expect(await cloudflared.report(TUNNEL)).toEqual({
      hostname: "evertap.example.com",
      state: "stopped",
      connections: 0,
    });
    // Its links are to another tunnel.
    expect(await cloudflared.connects(TUNNEL, 0)).toBe(false);
    const before = creates;
    await cloudflared.sync(TUNNEL);
    const moved = await savedPort();
    expect(moved).not.toBe(port);
    expect(creates).toBe(before + 1);
    expect(containers.get(NAME)?.Cmd[2]).toBe(`127.0.0.1:${moved}`);
    expect((await cloudflared.report(TUNNEL))?.state).toBe("connecting");
  } finally {
    await other.stop(true);
  }
});

test("moves off a port a program other than cloudflared took", async () => {
  const port = await savedPort();
  const program = Bun.listen({
    hostname: "127.0.0.1",
    port,
    socket: {
      open: (socket) => {
        socket.end();
      },
      data: () => {},
    },
  });
  try {
    await cloudflared.sync(TUNNEL);
    expect(await savedPort()).not.toBe(port);
  } finally {
    program.stop(true);
  }
});

test("forgets the port with the tunnel", async () => {
  await cloudflared.sync(null);
  expect(containers.has(NAME)).toBe(false);
  expect(await stat(dir).catch(() => null)).toBeNull();
  expect(await cloudflared.report(null)).toBeNull();
});
