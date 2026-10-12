import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bucketsGuide, proxyConfigs } from "@evertap/api/proxy";
import type { AppRouterClient } from "@evertap/api/router";
import { SESSION_COOKIE } from "@evertap/api/rules";
import { resolveSettings } from "@evertap/api/settings";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { SimpleCsrfProtectionLinkPlugin } from "@orpc/client/plugins";
import { AwsClient } from "aws4fetch";
import { SQL } from "bun";

import { startConnect } from "./cli/connect.ts";
import { config } from "./config.ts";
import { createDocker } from "./live/docker.ts";
import { freePort } from "./live/testing.ts";

/**
 * A real evertap serve behind nginx and Caddy, each run with Docker from the configuration evertap
 * generates, the way a person pastes it. evertap listens on Docker's bridge, where a proxy in a
 * container reaches it.
 */
const PREFIX = "evertap-test-proxy";
/** The served evertap's own; its containers start with PREFIX too, but its network is its own. */
const SERVED = `${PREFIX}-serve`;
const NGINX = "nginx:stable-alpine";
const CADDY = "caddy:2-alpine";
/** Past nginx's 60 s default for a quiet upstream. */
const QUIET_MS = 65_000;

const docker = await createDocker({ socket: config.dockerSocket, network: PREFIX });
const cleanUp = async () => {
  await docker.removeByPrefix(SERVED);
  await docker.removeByPrefix(PREFIX);
};
await cleanUp();

const bridge =
  (await docker.bridgeAddress()) ??
  (() => {
    throw new Error("These tests need Docker's default bridge, docker0");
  })();

const dataDir = await mkdtemp(join(tmpdir(), `${PREFIX}-`));
const uiPort = freePort();
const nginxUrl = `http://127.0.0.1:${freePort()}`;
const caddyUrl = `http://127.0.0.1:${freePort()}`;
const bucketsPort = freePort();
const nginxBuckets = `http://127.0.0.1:${freePort()}`;
const caddyBuckets = `http://127.0.0.1:${freePort()}`;

let output = "";
const server = Bun.spawn([process.execPath, join(import.meta.dir, "main.ts"), "serve"], {
  env: {
    PATH: process.env.PATH ?? "",
    HOME: dataDir,
    EVERTAP_DATA_DIR: dataDir,
    EVERTAP_PREFIX: SERVED,
    EVERTAP_PORT: String(uiPort),
    EVERTAP_POSTGRES_PORT: String(freePort()),
    EVERTAP_MYSQL_PORT: String(freePort()),
    EVERTAP_REDIS_PORT: String(freePort()),
    EVERTAP_GARAGE_PORT: String(freePort()),
    EVERTAP_PUBLIC_S3_PORT: String(bucketsPort),
  },
  stdout: "pipe",
  stderr: "pipe",
});
for (const stream of [server.stdout, server.stderr]) {
  void (async () => {
    for await (const chunk of stream) {
      output += new TextDecoder().decode(chunk);
    }
  })();
}

/** The CLI on the machine running evertap, over its socket. */
const machine: AppRouterClient = createORPCClient(
  new RPCLink({
    url: "http://localhost/api/client/rpc",
    fetch: (request, init) => fetch(request, { ...init, unix: join(dataDir, "evertap.sock") }),
  }),
);

/** Polls until `ready` holds; a proxy or evertap takes a moment to start. */
const waitFor = async (what: string, ready: () => Promise<boolean>) => {
  for (let tries = 0; tries < 120; tries++) {
    if (await ready().catch(() => false)) {
      return;
    }
    await Bun.sleep(500);
  }
  throw new Error(`${what} did not start:\n${output}`);
};

const answers = (url: string) => async () => (await fetch(`${url}/api/health`)).ok;

/** The bucket entry refuses a bucket it does not know, which shows it is there. */
const refuses = (url: string) => async () => (await fetch(`${url}/nothing`)).status === 403;

/**
 * Runs a proxy at `url`, published on 127.0.0.1: writes `contents` to the file at `path`, then runs
 * `command`.
 */
const runProxy = async (
  proxy: { name: string; image: string; path: string; command: string },
  url: string,
  contents: string,
  ready = answers(url),
) => {
  const { port } = new URL(url);
  await docker.ensureContainer({
    name: `${PREFIX}-${proxy.name}`,
    image: proxy.image,
    cmd: ["sh", "-c", `printf '%s' "$CONFIG" > ${proxy.path} && exec ${proxy.command}`],
    env: { CONFIG: contents },
    ports: { [`${port}/tcp`]: { hostIp: "127.0.0.1", hostPort: Number(port) } },
  });
  await waitFor(proxy.name, ready);
};

const environment = {
  env: {},
  port: uiPort,
  publicStoragePort: bucketsPort,
  lanAddress: () => null,
  lanName: "evertap.local",
  dockerAddress: () => bridge,
  publicAddresses: () => [],
};

/** The configuration a person would paste for `url`, as evertap writes it. */
const configFor = (url: string) => {
  const settings = resolveSettings(
    { mode: "network", publicUrl: url, listenHost: bridge, storageUrl: null },
    environment,
  );
  const configs = proxyConfigs(settings, uiPort);
  if (!configs) {
    throw new Error("Expected a proxy configuration");
  }
  return configs;
};

const useUrl = (publicUrl: string) =>
  machine.system.settings.update({ mode: "network", publicUrl, listenHost: bridge });

const stops: (() => unknown)[] = [];

beforeAll(async () => {
  await waitFor("evertap", async () => (await machine.system.status()).version !== "");
  await docker.pull([NGINX, CADDY], 600_000);
  await useUrl(nginxUrl);
  // The server's own answer, which setup and the UI show.
  const guide = await machine.system.settings.network();
  expect(guide.proxy).toEqual(configFor(nginxUrl));
  await runProxy(
    {
      name: "nginx",
      image: NGINX,
      path: "/etc/nginx/conf.d/default.conf",
      command: "nginx -g 'daemon off;'",
    },
    nginxUrl,
    guide.proxy?.nginx ?? "",
  );
  await runProxy(
    {
      name: "caddy",
      image: CADDY,
      path: "/etc/caddy/Caddyfile",
      command: "caddy run --config /etc/caddy/Caddyfile --adapter caddyfile",
    },
    caddyUrl,
    configFor(caddyUrl).caddy,
  );
});

afterAll(async () => {
  for (const stop of stops) {
    await stop();
  }
  server.kill("SIGTERM");
  await server.exited;
  await cleanUp();
  await rm(dataDir, { recursive: true, force: true });
});

/** A browser at `url`: oRPC's CSRF header, and the session cookie once it has one. */
const browserAt = (url: string) => {
  let cookie: string | null = null;
  const client: AppRouterClient = createORPCClient(
    new RPCLink({
      url: `${url}/api/rpc`,
      plugins: [new SimpleCsrfProtectionLinkPlugin()],
      fetch: async (request, init) => {
        if (cookie) {
          request.headers.set("cookie", cookie);
        }
        const response = await fetch(request, init);
        const set = response.headers.get("set-cookie");
        if (set?.startsWith(`${SESSION_COOKIE}=`)) {
          cookie = set.split(";")[0] ?? null;
        }
        return response;
      },
    }),
  );
  return client;
};

/** A Postgres session carried by `evertap connect` through `url`. */
const connectThrough = async (url: string, database: { connectionUrl: string }, token: string) => {
  const port = freePort();
  const running = startConnect({
    url,
    token,
    hostname: "127.0.0.1",
    engines: ["postgresql"],
    ports: { postgresql: port },
    unavailable: (_, error) => {
      throw error;
    },
  });
  stops.push(() => {
    running.stop();
  });
  const target = new URL(database.connectionUrl);
  target.hostname = "127.0.0.1";
  target.port = String(port);
  let connects = 0;
  let closes = 0;
  const sql = new SQL({
    url: target.href,
    max: 1,
    onconnect: () => {
      connects += 1;
    },
    onclose: () => {
      closes += 1;
    },
  });
  stops.push(() => sql.close());
  return { sql, counts: () => ({ connects, closes }) };
};

test("finds that each proxy reaches this evertap and passes on what it needs", async () => {
  expect(await machine.system.settings.check()).toEqual({
    url: nginxUrl,
    result: "reached",
    problems: [],
  });
  await useUrl(caddyUrl);
  try {
    expect((await machine.system.settings.check()).problems).toEqual([]);
  } finally {
    await useUrl(nginxUrl);
  }
});

test("tells another evertap at the address from this one", async () => {
  const other = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => Response.json({ ok: true }),
  });
  await useUrl(other.url.origin);
  try {
    expect((await machine.system.settings.check()).result).toBe("elsewhere");
  } finally {
    await useUrl(nginxUrl);
    void other.stop(true);
  }
});

test("signs a browser in through each proxy", async () => {
  for (const url of [nginxUrl, caddyUrl]) {
    const { url: link } = await machine.session.link();
    const page = browserAt(url);
    await page.session.redeem({ token: link.split("#")[1] ?? "" });
    expect((await page.session.get()).signedIn, url).toBe(true);
  }
});

test(
  "takes links signed for buckets' own address through each proxy, path and body as they were",
  async () => {
    await machine.system.settings.update({
      mode: "network",
      publicUrl: nginxUrl,
      listenHost: bridge,
      storageUrl: nginxBuckets,
    });
    const nginx = (await machine.system.settings.network()).buckets?.proxy?.nginx ?? "";
    const caddy =
      bucketsGuide(
        resolveSettings(
          { mode: "network", publicUrl: caddyUrl, listenHost: bridge, storageUrl: caddyBuckets },
          environment,
        ),
        environment,
      )?.proxy?.caddy ?? "";
    await runProxy(
      {
        name: "nginx-buckets",
        image: NGINX,
        path: "/etc/nginx/conf.d/default.conf",
        command: "nginx -g 'daemon off;'",
      },
      nginxBuckets,
      nginx,
      refuses(nginxBuckets),
    );
    await runProxy(
      {
        name: "caddy-buckets",
        image: CADDY,
        path: "/etc/caddy/Caddyfile",
        command: "caddy run --config /etc/caddy/Caddyfile --adapter caddyfile",
      },
      caddyBuckets,
      caddy,
      refuses(caddyBuckets),
    );

    const bucket = await machine.resources.create({
      engine: "garage",
      name: "proxied-files",
      extensions: [],
      description: "",
      temporary: false,
    });
    if (bucket.kind !== "object-storage") {
      throw new Error("Expected a bucket");
    }
    await machine.resources.setReachableAnywhere({ id: bucket.id, reachableAnywhere: true });
    const signer = new AwsClient({
      accessKeyId: bucket.accessKeyId,
      secretAccessKey: bucket.secretAccessKey,
      service: "s3",
      region: bucket.region,
    });
    const link = async (url: string, key: string, method: string) =>
      (
        await signer.sign(`${url}/${bucket.name}/${key}?X-Amz-Expires=300`, {
          method,
          aws: { signQuery: true },
        })
      ).url;
    // Past nginx's 1 MB default for a body.
    const body = new Uint8Array(20 * 1024 * 1024).map((_, index) => index % 251);
    for (const url of [nginxBuckets, caddyBuckets]) {
      for (const key of ["big.bin", "odd//name%2B.txt"]) {
        const put = await fetch(await link(url, key, "PUT"), { method: "PUT", body });
        expect(put.status, `${url} ${key}: ${await put.text()}`).toBe(200);
        const get = await fetch(await link(url, key, "GET"));
        expect(get.status, `${url} ${key}`).toBe(200);
        expect(Bun.hash(await get.arrayBuffer()), `${url} ${key}`).toBe(Bun.hash(body));
      }
    }
  },
  { timeout: 300_000 },
);

test(
  "carries a database connection through each proxy, and keeps a quiet one open",
  async () => {
    const { key } = await machine.clients.createApiKey({ name: "proxy test" });
    const database = await machine.resources.create({
      engine: "postgresql",
      name: "proxied",
      version: "18",
      extensions: [],
      description: "",
      temporary: false,
    });
    if (database.kind !== "database") {
      throw new Error("Expected a database");
    }
    const sessions = await Promise.all(
      [nginxUrl, caddyUrl].map((url) => connectThrough(url, database, key)),
    );
    for (const { sql } of sessions) {
      const [row] = await sql`SELECT 1 AS one`;
      expect(row).toEqual({ one: 1 });
    }
    await Bun.sleep(QUIET_MS);
    for (const { sql, counts } of sessions) {
      const [row] = await sql`SELECT 2 AS two`;
      expect(row).toEqual({ two: 2 });
      expect(counts()).toEqual({ connects: 1, closes: 0 });
    }
  },
  { timeout: 300_000 },
);
