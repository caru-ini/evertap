import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Tunnel } from "@evertap/api/schemas";
import { z } from "zod";

import { config } from "../config.ts";
import { createCloudflared } from "./cloudflared.ts";
import { createDocker } from "./docker.ts";
import { containerId, freePort } from "./testing.ts";

const PREFIX = "evertap-test-cloudflared";
const NAME = `${PREFIX}-cloudflared`;
const TUNNEL_ID = "c1744f8b-0000-4000-8000-000000000001";
// Without a Cloudflare account, the tunnel never connects: what these show is how it is run. The
// token is shaped like one, so cloudflared starts and answers about the tunnel it names.
const TUNNEL: Tunnel = {
  id: TUNNEL_ID,
  accountId: "account-1",
  zoneId: "zone-1",
  zone: "example.com",
  hostnames: { ui: "evertap.example.com", storage: "s3.example.com" },
  dnsRecordIds: [],
  cacheRule: { rulesetId: "ruleset-1", ruleId: "rule-1" },
  token: btoa(JSON.stringify({ a: "account-1", t: TUNNEL_ID, s: btoa("not-a-tunnel-secret") })),
};

const real = await createDocker({ socket: config.dockerSocket, network: PREFIX });
// So the made-up token never reaches Cloudflare, cloudflared dials a port nothing listens on instead.
const edge = `127.0.0.1:${freePort()}`;
const docker: typeof real = {
  ...real,
  ensureContainer: (spec) =>
    real.ensureContainer({ ...spec, env: { ...spec.env, TUNNEL_EDGE: edge } }),
};
const dir = join(await mkdtemp(join(tmpdir(), `${PREFIX}-`)), "cloudflared");
const cloudflared = createCloudflared({ docker, prefix: PREFIX, dir });

const inspectSchema = z.object({
  Config: z.object({
    Cmd: z.array(z.string()),
    Env: z.array(z.string()).nullish(),
    Healthcheck: z.object({ Test: z.array(z.string()) }).nullish(),
  }),
  HostConfig: z.object({ NetworkMode: z.string(), PortBindings: z.unknown() }),
});

const inspect = async () =>
  inspectSchema.parse(
    await (
      await fetch(`http://docker/containers/${NAME}/json`, { unix: config.dockerSocket })
    ).json(),
  );

const metricsPort = async () => Number(await readFile(join(dir, "metrics-port"), "utf8"));

/** The tunnel the cloudflared at `port` serves, once one answers there. */
const servedAt = async (port: number) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    const answer = await fetch(`http://127.0.0.1:${port}/diag/tunnel`, {
      signal: AbortSignal.timeout(2000),
    })
      .then(async (response) => z.object({ tunnelID: z.string() }).parse(await response.json()))
      .catch(() => null);
    if (answer) {
      return answer.tunnelID;
    }
    await Bun.sleep(500);
  }
  return null;
};

const containerCall = (action: string) =>
  fetch(`http://docker/containers/${NAME}/${action}`, {
    method: "POST",
    unix: config.dockerSocket,
  });

/** What cloudflared printed, once it has printed `text`. */
const logsWith = async (text: string) => {
  let logs = "";
  for (let attempt = 0; attempt < 120 && !logs.includes(text); attempt++) {
    await Bun.sleep(500);
    const response = await fetch(`http://docker/containers/${NAME}/logs?stdout=true&stderr=true`, {
      unix: config.dockerSocket,
    });
    logs = await response.text();
  }
  return logs;
};

beforeAll(async () => {
  await docker.removeByPrefix(PREFIX);
});

afterAll(async () => {
  await docker.removeByPrefix(PREFIX);
  await rm(join(dir, ".."), { recursive: true, force: true });
});

test("runs on the host's network, with metrics on a free loopback port and the token in a file only", async () => {
  await cloudflared.sync(TUNNEL);
  const metrics = `127.0.0.1:${await metricsPort()}`;
  const container = await inspect();
  expect(container.HostConfig.NetworkMode).toBe("host");
  expect(container.Config.Cmd).toEqual([
    "tunnel",
    "--metrics",
    metrics,
    "--protocol",
    "http2",
    "run",
    "--token-file",
    "/etc/cloudflared/token",
  ]);
  expect(container.Config.Healthcheck?.Test).toEqual([
    "CMD",
    "/usr/local/bin/cloudflared",
    "tunnel",
    "--metrics",
    metrics,
    "ready",
  ]);
  expect(JSON.stringify(container)).not.toContain(TUNNEL.token);
  expect((await stat(join(dir, "token"))).mode & 0o777).toBe(0o644);
  // Its own user read the file, as it names the tunnel there.
  expect(await servedAt(await metricsPort())).toBe(TUNNEL_ID);
  expect(await cloudflared.report(TUNNEL)).toEqual({
    hostname: "evertap.example.com",
    state: "connecting",
    connections: 0,
  });
});

test("moves to another port when a program takes its own, and never reports that one", async () => {
  const port = await metricsPort();
  await containerCall("stop?t=1");
  // Like a cloudflared the person runs, connected for another tunnel.
  const other = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: (request) =>
      new URL(request.url).pathname === "/diag/tunnel"
        ? Response.json({
            tunnelID: "0b0e0c1f-0000-4000-8000-000000000002",
            connections: [{ isConnected: true, protocol: 1 }],
          })
        : Response.json({ status: 200, readyConnections: 1 }),
  });
  try {
    await containerCall("start");
    await logsWith("Error opening metrics server listener");
    expect((await cloudflared.report(TUNNEL))?.state).toBe("stopped");

    const id = await containerId(NAME);
    await cloudflared.sync(TUNNEL);
    const moved = await metricsPort();
    expect(moved).not.toBe(port);
    expect(await containerId(NAME)).not.toBe(id);
    expect((await inspect()).Config.Cmd[2]).toBe(`127.0.0.1:${moved}`);
    expect(await servedAt(moved)).toBe(TUNNEL_ID);
    expect((await cloudflared.report(TUNNEL))?.state).toBe("connecting");
  } finally {
    await other.stop(true);
  }
});

test("starts again for another token, and leaves nothing once there is no tunnel", async () => {
  await cloudflared.sync(TUNNEL);
  const id = await containerId(NAME);
  await cloudflared.sync(TUNNEL);
  expect(await containerId(NAME)).toBe(id);
  await cloudflared.sync({ ...TUNNEL, token: "another-token" });
  expect(await containerId(NAME)).not.toBe(id);

  await cloudflared.sync(null);
  expect(await docker.inspect(NAME)).toBeNull();
  expect(await stat(dir).catch(() => null)).toBeNull();
  expect(await cloudflared.report(null)).toBeNull();
});
