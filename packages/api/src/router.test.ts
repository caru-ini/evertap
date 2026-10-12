import { createRouterClient, ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { bearerCaller, sessionCaller } from "./callers.ts";
import { formatConnection } from "./connections.ts";
import { type Caller, DataError, type Store, UnavailableError } from "./context.ts";
import { OBJECT_LINK_PATH, readObjectLink, signObjectLink } from "./object-links.ts";
import { appRouter } from "./router.ts";
import {
  DATABASE_ENGINES,
  DATABASE_VERSIONS,
  DESCRIPTION_MAX,
  PAIRING_WINDOW_MS,
  PENDING_REQUESTS_MAX,
  REQUESTS_PER_SITE_MAX,
  REQUESTS_PER_SOURCE_MAX,
  RESOURCE_ENGINES,
  SESSION_COOKIE,
  SESSION_WINDOW_MS,
  STORAGE_ENGINES,
  TEMPORARY_WINDOW_MS,
  browserName,
  cookieName,
  normalizePairingCode,
} from "./rules.ts";
import { OBJECT_PART_SIZE, type DoctorReport, savedSettingsSchema } from "./schemas.ts";
import { plannedTunnel, type SettingsEnvironment } from "./settings.ts";
import { createMemoryStore } from "./store/memory.ts";

const NOW = new Date("2026-09-15T00:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

const memoryStore = (now = () => NOW) =>
  createMemoryStore({
    version: "1.2.3",
    host: "evertap.local",
    port: 6432,
    machine: () =>
      Promise.resolve({
        disk: { totalBytes: 1000, freeBytes: 500 },
        memory: { totalBytes: 2000, freeBytes: 1500 },
        cpu: { usedRatio: 0.25, cores: 4 },
      }),
    extensions: [{ name: "vector", description: "vector data type" }],
    now,
  });

const PERSON: Caller = { kind: "person", client: null };
const ANONYMOUS: Caller = { kind: "anonymous" };
const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";

const as = (
  store: Store,
  caller: Caller = PERSON,
  extra: { origin?: string; ip?: string | null } = {},
) => createRouterClient(appRouter, { context: { store, caller, ...extra } });

const setup = (now = () => NOW) => as(memoryStore(now));

/**
 * A browser on the UI's path: its cookies go out with each call and come back from Set-Cookie.
 * `received` keeps every Set-Cookie as sent.
 */
const browser = (store: Store, userAgent = CHROME_MAC, { https = false } = {}) => {
  const jar = new Map<string, string>();
  const received: string[] = [];
  let resHeaders = new Headers();
  const client = createRouterClient(appRouter, {
    context: async () => {
      resHeaders = new Headers();
      return {
        store,
        caller: await sessionCaller(store, jar.get(cookieName(SESSION_COOKIE, https)), null),
        reqHeaders: new Headers({
          "user-agent": userAgent,
          cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
        }),
        resHeaders,
        https,
      };
    },
  });
  return {
    call: async <T>(run: (router: typeof client) => Promise<T>) => {
      try {
        return await run(client);
      } finally {
        for (const cookie of resHeaders.getSetCookie()) {
          received.push(cookie);
          const [pair = ""] = cookie.split(";");
          const [name = "", value = ""] = pair.split("=");
          if (/max-age=0/i.test(cookie)) {
            jar.delete(name);
          } else {
            jar.set(name, value);
          }
        }
      }
    },
    cookie: (name: string) => jar.get(name),
    /** As a page on another host under the same domain can, for a name without `__Host-`. */
    plant: (name: string, value: string) => {
      jar.set(name, value);
    },
    received,
  };
};

/** A browser that signed in with a code another browser approved. */
const signedIn = async (store: Store) => {
  const laptop = browser(store);
  const { code } = await laptop.call((client) => client.session.start());
  await as(store).clients.pairing.approve({ code });
  await laptop.call((client) => client.session.claim());
  return laptop;
};

const errorCode = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof ORPCError ? error.code : "not-an-orpc-error";
  }
  return "resolved";
};

describe("resources", () => {
  it("creates a database and hands back a URL with a generated user, not its name", async () => {
    const client = setup();
    const created = await client.resources.create({ name: "blog", extensions: ["vector"] });

    if (created.kind !== "database") throw new Error("Expected a database");
    expect(created.engine).toBe("postgresql");
    expect(created.connectionUrl).toBe(
      `postgres://evertap_${created.id}:${new URL(created.connectionUrl).password}@evertap.local:6432/evertap_${created.id}`,
    );
    expect(new URL(created.connectionUrl).password).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(created.protected).toBe(false);
    expect(await client.resources.list()).toEqual([created]);
    expect(await client.resources.get({ id: created.id })).toEqual(created);
    expect(await errorCode(client.resources.get({ id: "nope" }))).toBe("NOT_FOUND");
    expect(await client.resources.connectionDetails({ id: created.id })).toEqual({
      kind: "database",
      engine: "postgresql",
      url: created.connectionUrl,
    });
  });

  it("rejects duplicate and malformed names", async () => {
    const client = setup();
    await client.resources.create({ name: "blog" });

    expect(await errorCode(client.resources.create({ name: "blog" }))).toBe("CONFLICT");
    expect(await errorCode(client.resources.create({ name: "Blog" }))).toBe("BAD_REQUEST");
    expect(await errorCode(client.resources.create({ name: "1blog" }))).toBe("BAD_REQUEST");
  });

  it("only enables extensions the instance ships", async () => {
    const client = setup();
    expect(await client.extensions.list()).toEqual([
      { name: "vector", description: "vector data type" },
    ]);
    expect(await errorCode(client.resources.create({ name: "geo", extensions: ["postgis"] }))).toBe(
      "BAD_REQUEST",
    );
    const created = await client.resources.create({
      name: "geo",
      extensions: ["vector", "vector"],
    });
    if (created.kind !== "database") throw new Error("Expected a database");
    expect(created.extensions).toEqual(["vector"]);
  });

  it("refuses to delete a protected database until protection is lifted", async () => {
    const client = setup();
    const { id } = await client.resources.create({ name: "blog" });
    await client.resources.setProtected({ id, protected: true });

    expect(await errorCode(client.resources.delete({ id }))).toBe("PRECONDITION_FAILED");
    expect(await client.resources.list()).toHaveLength(1);

    await client.resources.setProtected({ id, protected: false });
    expect(await client.resources.delete({ id })).toEqual({ id });
    expect(await client.resources.list()).toEqual([]);
    expect(await errorCode(client.resources.delete({ id }))).toBe("NOT_FOUND");
  });

  it("changes a resource's note after creation", async () => {
    const client = setup();
    const { id } = await client.resources.create({ name: "blog" });
    expect(
      await client.resources.setDescription({ id, description: "  Blog posts " }),
    ).toMatchObject({ description: "Blog posts" });
    expect(await client.resources.setDescription({ id, description: "" })).toMatchObject({
      description: "",
    });
    expect(
      await errorCode(
        client.resources.setDescription({ id, description: "x".repeat(DESCRIPTION_MAX + 1) }),
      ),
    ).toBe("BAD_REQUEST");
    expect(
      await errorCode(client.resources.setDescription({ id: "missing", description: "" })),
    ).toBe("NOT_FOUND");
  });

  it("marks temporary databases by an expiry time that keeping or protecting clears", async () => {
    const client = setup();
    const permanent = await client.resources.create({ name: "blog" });
    expect(permanent.expiresAt).toBeNull();

    const scratch = await client.resources.create({ name: "scratch", temporary: true });
    expect(scratch.expiresAt).toBe(new Date(NOW.getTime() + TEMPORARY_WINDOW_MS).toISOString());

    const kept = await client.resources.keep({ id: scratch.id });
    expect(kept.expiresAt).toBeNull();

    const other = await client.resources.create({ name: "tmp", temporary: true });
    const guarded = await client.resources.setProtected({ id: other.id, protected: true });
    expect(guarded).toMatchObject({ protected: true, expiresAt: null });
  });

  it.each(DATABASE_ENGINES)("returns a usable URL shape for %s", async (engine) => {
    const client = setup();
    const name = "a".repeat(63);
    const created = await client.resources.create({ engine, name });
    if (created.kind !== "database") throw new Error("Expected a database");

    const [, protocol, username, password, host, port, database] =
      created.connectionUrl.match(/^([^:]+):\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)$/) ?? [];
    expect(protocol).toBe(engine === "postgresql" ? "postgres" : engine);
    expect(host).toBe("evertap.local");
    expect(port).toBe(engine === "postgresql" ? "6432" : engine === "mysql" ? "3306" : "6379");
    expect(database).toBe(engine === "redis" ? "0" : username);
    expect(password).toHaveLength(24);
    expect(username?.length).toBeLessThanOrEqual(32);
    expect(created.extensions).toEqual([]);
    expect(created).not.toHaveProperty("endpoint");
  });

  it.each(STORAGE_ENGINES)(
    "returns S3 credentials for %s without a database URL",
    async (engine) => {
      const client = setup();
      const created = await client.resources.create({ engine, name: "app-uploads" });
      if (created.kind !== "object-storage") throw new Error("Expected object storage");

      expect(created.engine).toBe(engine);
      expect(created.endpoint).toBe("http://evertap.local:3900");
      expect(created.region).toBe("us-east-1");
      expect(created.accessKeyId).toMatch(/^[A-Z0-9]{20}$/);
      expect(created.secretAccessKey).toMatch(/^[A-Za-z0-9]{40}$/);
      expect(created).not.toHaveProperty("connectionUrl");
      expect(created).not.toHaveProperty("extensions");
      expect(await client.resources.connectionDetails({ id: created.id })).toEqual({
        kind: "object-storage",
        engine,
        endpoint: created.endpoint,
        region: created.region,
        bucket: created.name,
        accessKeyId: created.accessKeyId,
        secretAccessKey: created.secretAccessKey,
        publicEndpoint: null,
      });
    },
  );

  it.each(RESOURCE_ENGINES)("scopes duplicate names to %s", async (engine) => {
    const client = setup();
    await client.resources.create({ engine, name: "shared" });
    expect(await errorCode(client.resources.create({ engine, name: "shared" }))).toBe("CONFLICT");

    const otherEngine = engine === "postgresql" ? "mysql" : "postgresql";
    await client.resources.create({ engine: otherEngine, name: "shared" });
    expect(await client.resources.list()).toHaveLength(2);
  });

  it.each(DATABASE_ENGINES)(
    "defaults %s to the newest version and keeps a chosen one",
    async (engine) => {
      const client = setup();
      const [newest, older] = DATABASE_VERSIONS[engine];
      const latest = await client.resources.create({ engine, name: "latest" });
      const pinned = await client.resources.create({ engine, name: "pinned", version: older });
      if (latest.kind !== "database" || pinned.kind !== "database") {
        throw new Error("Expected databases");
      }
      expect(latest.version).toBe(newest);
      expect(pinned.version).toBe(older);
      expect(
        await errorCode(client.resources.create({ engine, name: "unknown", version: "1" })),
      ).toBe("BAD_REQUEST");
    },
  );

  it.each(STORAGE_ENGINES)("rejects a version for %s buckets", async (engine) => {
    const client = setup();
    expect(
      await errorCode(client.resources.create({ engine, name: "app-uploads", version: "18" })),
    ).toBe("BAD_REQUEST");
  });

  it("lists extensions for a chosen PostgreSQL version", async () => {
    const client = setup();
    expect(await client.extensions.list({ version: "16" })).toHaveLength(1);
  });

  it.each(["mysql", "redis", "garage"] as const)(
    "rejects PostgreSQL extensions for %s",
    async (engine) => {
      const client = setup();
      expect(
        await errorCode(client.resources.create({ engine, name: "app", extensions: ["vector"] })),
      ).toBe("BAD_REQUEST");
      expect(await client.resources.list()).toEqual([]);
    },
  );

  it("caps the note length", async () => {
    const client = setup();
    const description = "a".repeat(DESCRIPTION_MAX + 1);
    expect(await errorCode(client.resources.create({ name: "app", description }))).toBe(
      "BAD_REQUEST",
    );
    const created = await client.resources.create({
      name: "app",
      description: `  ${"a".repeat(DESCRIPTION_MAX)}  `,
    });
    expect(created.description).toHaveLength(DESCRIPTION_MAX);
  });

  it.each(STORAGE_ENGINES)("validates %s bucket names", async (engine) => {
    const client = setup();
    for (const name of ["ab", "a".repeat(64), "App", "app_uploads", "app.files", "-app", "app-"]) {
      expect(await errorCode(client.resources.create({ engine, name }))).toBe("BAD_REQUEST");
    }
    for (const name of ["app", "a".repeat(63), "1-app-2"]) {
      const created = await client.resources.create({ engine, name });
      expect(created.name).toBe(name);
    }
  });

  it("reserves names only where they are the engine's own, and allows hyphens in labels", async () => {
    const client = setup();
    // A database's name is only a label: its URL names a generated user and database.
    for (const name of ["postgres", "template1", "pg_app", "app-db"]) {
      await client.resources.create({ engine: "postgresql", name });
    }
    for (const name of ["mysql", "information_schema", "shop-dev"]) {
      await client.resources.create({ engine: "mysql", name });
    }
    await client.resources.create({ engine: "redis", name: "app-cache" });
    expect(await client.resources.list()).toHaveLength(8);
  });

  it.each(RESOURCE_ENGINES)(
    "preserves protection and temporary-resource policies for %s",
    async (engine) => {
      const client = setup();
      const resource = await client.resources.create({ engine, name: "scratch", temporary: true });
      expect(resource.expiresAt).toBe(new Date(NOW.getTime() + TEMPORARY_WINDOW_MS).toISOString());
      const kept = await client.resources.keep({ id: resource.id });
      expect(kept.expiresAt).toBeNull();

      const guarded = await client.resources.create({ engine, name: "guarded", temporary: true });
      const protectedResource = await client.resources.setProtected({
        id: guarded.id,
        protected: true,
      });
      expect(protectedResource).toMatchObject({ protected: true, expiresAt: null });
      expect(await errorCode(client.resources.delete({ id: guarded.id }))).toBe(
        "PRECONDITION_FAILED",
      );
      await client.resources.setProtected({ id: guarded.id, protected: false });
      expect(await client.resources.delete({ id: guarded.id })).toEqual({ id: guarded.id });
    },
  );

  it("identifies the memory store as demo mode", async () => {
    const client = setup();
    expect(await client.system.status()).toMatchObject({
      version: "1.2.3",
      // The demo never checks for a newer release.
      update: null,
      mode: "demo",
      host: "evertap.local",
      disk: { totalBytes: 1000, freeBytes: 500 },
      memory: { totalBytes: 2000, freeBytes: 1500 },
      cpu: { usedRatio: 0.25, cores: 4 },
    });
  });

  it("gives the doctor's local-only details over the local socket alone", async () => {
    const store = memoryStore();
    const full: DoctorReport = {
      version: "1.2.3",
      update: {
        version: "1.3.0",
        url: "https://github.com/caru-ini/evertap/releases/tag/v1.3.0",
        advice: "Run the install script again on the machine running evertap",
      },
      docker: {
        reachable: true,
        version: "27.3.1",
        apiVersion: "1.47",
        socket: "/var/run/docker.sock",
        warnings: [{ kind: "outdated", message: "Update Docker to 28 or later" }],
      },
      engines: [{ engine: "postgresql", state: "failed", error: "pull postgres:18: denied" }],
      machine: {
        disk: { totalBytes: 1000, freeBytes: 500 },
        memory: { totalBytes: 2000, freeBytes: 1500 },
        cpu: { usedRatio: 0.25, cores: 4 },
      },
      access: "cloudflare",
      tunnel: {
        hostname: "evertap.example.com",
        state: "stopped",
        connections: 0,
        error: "pull cloudflare/cloudflared: denied",
      },
      dataDir: "/home/me/.local/share/evertap",
      lan: { host: "evertap.local", addresses: ["192.168.1.10"] },
      entries: [{ engine: "postgresql", address: "127.0.0.1:6432", reachable: false }],
      conflicts: [
        { name: "shop-db-1", address: "127.0.0.1:3306", running: false, message: "Can't start" },
      ],
    };
    store.doctor = () => Promise.resolve(full);
    const local = as(store, { kind: "local" });
    const network = as(store);

    expect(await local.system.doctor()).toMatchObject(full);
    const trimmed = await network.system.doctor();
    expect(trimmed.docker).toEqual({
      reachable: true,
      version: "27.3.1",
      apiVersion: "1.47",
      warnings: full.docker?.warnings,
    });
    expect(trimmed.engines).toEqual([{ engine: "postgresql", state: "failed" }]);
    expect(trimmed.version).toBe("1.2.3");
    expect(trimmed.update).toEqual(full.update);
    expect(trimmed.dataDir).toBeUndefined();
    expect(trimmed.access).toBe("cloudflare");
    expect(trimmed.tunnel).toEqual({
      hostname: "evertap.example.com",
      state: "stopped",
      connections: 0,
    });
    expect(trimmed.entries).toEqual(full.entries);
    expect(trimmed.conflicts).toEqual(full.conflicts);
  });
});

const LAN: SettingsEnvironment = {
  env: {},
  port: 8080,
  publicStoragePort: 9900,
  lanAddress: () => "192.168.1.10",
  lanName: "evertap.local",
  dockerAddress: () => null,
  publicAddresses: () => [],
};

const settingsStore = (environment = LAN) =>
  createMemoryStore({
    version: "1.2.3",
    host: "evertap.local",
    port: 6432,
    machine: () =>
      Promise.resolve({
        disk: { totalBytes: 1000, freeBytes: 500 },
        memory: { totalBytes: 2000, freeBytes: 1500 },
        cpu: { usedRatio: 0.25, cores: 4 },
      }),
    settings: environment,
  });

/** A signed-in browser that opened evertap as `host`. */
const browserAt = (store: Store, host: string) =>
  createRouterClient(appRouter, {
    context: { store, caller: PERSON, reqHeaders: new Headers({ host }) },
  });

const LOCAL: Caller = { kind: "local" };

describe("system.settings", () => {
  it("takes each value from its variable, then the saved settings, then the mode's default", async () => {
    const store = settingsStore({ ...LAN, env: { listenHost: "0.0.0.0" } });
    const machine = as(store, LOCAL);
    expect(await machine.system.settings.get()).toEqual({
      mode: { value: null, source: "default" },
      publicUrl: { value: "http://192.168.1.10:8080", source: "default" },
      listenHost: { value: "0.0.0.0", source: "env" },
      tunnel: null,
      storageUrl: { value: null, source: "default" },
    });

    await machine.system.settings.update({
      mode: "network",
      publicUrl: "https://evertap.example.com/",
      listenHost: "0.0.0.0",
      storageUrl: "https://s3.example.com/",
    });
    expect(await machine.system.settings.get()).toEqual({
      mode: { value: "network", source: "saved" },
      publicUrl: { value: "https://evertap.example.com", source: "saved" },
      listenHost: { value: "0.0.0.0", source: "env" },
      tunnel: null,
      storageUrl: { value: "https://s3.example.com", source: "saved" },
    });
    expect((await machine.system.doctor()).access).toBe("network");
  });

  it("refuses to change what an environment variable sets", async () => {
    const store = settingsStore({
      ...LAN,
      env: { mode: "network", publicUrl: "https://evertap.example.com" },
    });
    const machine = as(store, LOCAL);
    await expect(machine.system.settings.update({ mode: "local" })).rejects.toThrow(
      "EVERTAP_MODE sets this",
    );
    await expect(
      machine.system.settings.update({
        mode: "network",
        publicUrl: "https://other.example.com",
        listenHost: "127.0.0.1",
      }),
    ).rejects.toThrow("EVERTAP_PUBLIC_URL sets this");
    // Leaving the URL to its default, or naming the same one, changes nothing it sets.
    await machine.system.settings.update({
      mode: "network",
      publicUrl: null,
      listenHost: "0.0.0.0",
    });
    expect((await store.settings()).saved).toEqual({
      mode: "network",
      publicUrl: null,
      listenHost: "0.0.0.0",
      storageUrl: null,
    });
  });

  it("makes a change that cuts a browser off, and signs it in at the new address", async () => {
    const store = settingsStore();
    const proxied = {
      mode: "network",
      publicUrl: "https://evertap.example.com",
      listenHost: "127.0.0.1",
      storageUrl: null,
    } as const;
    await as(store, LOCAL).system.settings.update(proxied);
    const viaProxy = browserAt(store, "evertap.example.com");

    // Every interface still takes what came over loopback, and the name stays the same.
    const wider = { ...proxied, listenHost: "0.0.0.0" };
    expect(await viaProxy.system.settings.preview(wider)).toMatchObject({ cutOff: false });
    expect(await viaProxy.system.settings.update(wider)).toMatchObject({ signIn: null });

    // Another name for the UI leaves the browser without the one it came to.
    const renamed = { ...proxied, publicUrl: "https://ev.example.org" };
    expect(await viaProxy.system.settings.preview(renamed)).toMatchObject({ cutOff: true });
    expect((await store.settings()).saved).toEqual(wider);
    const { signIn } = await viaProxy.system.settings.update(renamed);
    const [link, requestId = ""] = signIn?.split("#") ?? [];
    expect(link).toBe("https://ev.example.org/signin");
    expect((await store.claimPairing(requestId)).status).toBe("approved");
    expect((await store.settings()).saved).toEqual(renamed);

    // On the LAN, a listen address the proxy alone reaches, signed in through the proxy.
    const overLan = browserAt(store, "192.168.1.10:8080");
    await as(store, LOCAL).system.settings.update(wider);
    expect((await overLan.system.settings.update(renamed)).signIn).toMatch(
      /^https:\/\/ev\.example\.org\/signin#/,
    );
  });

  it("signs a browser in nowhere when only the machine, or no known address, opens evertap", async () => {
    const store = settingsStore({ ...LAN, lanAddress: () => null });
    await as(store, LOCAL).system.settings.update({
      mode: "network",
      publicUrl: "https://evertap.example.com",
      listenHost: "127.0.0.1",
    });
    const viaProxy = browserAt(store, "evertap.example.com");
    const lan = { mode: "network", publicUrl: null, listenHost: "0.0.0.0" } as const;
    expect(await viaProxy.system.settings.preview(lan)).toMatchObject({
      cutOff: true,
      settings: { publicUrl: { value: null } },
    });
    expect(await viaProxy.system.settings.update(lan)).toMatchObject({ signIn: null });

    const overLan = browserAt(store, "192.168.1.10:8080");
    expect(await overLan.system.settings.update({ mode: "local" })).toEqual({
      settings: expect.objectContaining({
        publicUrl: { value: "http://ev.internal:8080", source: "default" },
      }),
      signIn: null,
    });
    expect((await store.settings()).saved).toEqual({ mode: "local" });
  });

  it("lets only a person or the machine's own CLI read or change them", async () => {
    const store = settingsStore();
    const { client } = await store.createApiKey("CI");
    const ci: Caller = { kind: "client", client };
    expect(await errorCode(as(store, ci).system.settings.get())).toBe("FORBIDDEN");
    expect(await errorCode(as(store, ci).system.settings.update({ mode: "local" }))).toBe(
      "FORBIDDEN",
    );
    expect(await errorCode(as(store, ci).system.settings.preview({ mode: "local" }))).toBe(
      "FORBIDDEN",
    );
    expect(await errorCode(as(store, ci).system.settings.network())).toBe("FORBIDDEN");
    expect(await errorCode(as(store, ci).system.settings.check())).toBe("FORBIDDEN");
    expect(await errorCode(as(store, ci).system.settings.origins())).toBe("FORBIDDEN");
    expect(await errorCode(as(store, ANONYMOUS).system.settings.get())).toBe("UNAUTHORIZED");
    expect(await errorCode(as(store, ANONYMOUS).system.settings.check())).toBe("UNAUTHORIZED");
  });

  it("passes on why a listener could not move", async () => {
    const store = settingsStore();
    store.saveSettings = () =>
      Promise.reject(new DataError("postgresql: 127.77.0.1:5432 is taken by another program"));
    await expect(as(store, LOCAL).system.settings.update({ mode: "local" })).rejects.toThrow(
      "127.77.0.1:5432 is taken",
    );
  });

  it("previews a change as update would make it, without saving", async () => {
    const store = settingsStore();
    const proxied = {
      mode: "network",
      publicUrl: "https://evertap.example.com",
      listenHost: "127.0.0.1",
      storageUrl: null,
    } as const;
    await as(store, LOCAL).system.settings.update(proxied);
    const onMachine = browserAt(store, "127.0.0.1:8080");

    expect(
      await onMachine.system.settings.preview({
        ...proxied,
        publicUrl: null,
        listenHost: "0.0.0.0",
      }),
    ).toEqual({
      settings: {
        mode: { value: "network", source: "saved" },
        publicUrl: { value: "http://192.168.1.10:8080", source: "default" },
        listenHost: { value: "0.0.0.0", source: "saved" },
        tunnel: null,
        storageUrl: { value: null, source: "default" },
      },
      cutOff: false,
    });
    // ev.internal's own address leaves 127.0.0.1.
    expect(await onMachine.system.settings.preview({ mode: "local" })).toMatchObject({
      cutOff: true,
    });
    expect((await store.settings()).saved).toEqual(proxied);

    const locked = settingsStore({ ...LAN, env: { mode: "network" } });
    expect(await errorCode(as(locked, LOCAL).system.settings.preview({ mode: "local" }))).toBe(
      "BAD_REQUEST",
    );
  });

  it("shows where network mode can listen and what to put in front of it", async () => {
    const store = settingsStore({
      ...LAN,
      dockerAddress: () => "172.17.0.1",
      publicAddresses: () => ["203.0.113.5"],
    });
    const machine = as(store, LOCAL);
    const before = await machine.system.settings.network();
    expect(before.listenChoices.map(({ use, exposes }) => [use, exposes])).toEqual([
      ["lan", "203.0.113.5"],
      ["proxy", null],
      ["docker", null],
    ]);
    expect(before.exposedAt).toBeNull();
    expect(before.proxy).toBeNull();

    await machine.system.settings.update({
      mode: "network",
      publicUrl: "https://evertap.example.com",
      listenHost: "172.17.0.1",
    });
    const after = await machine.system.settings.network();
    expect(after.proxy?.upstream).toBe("172.17.0.1:8080");
    expect(after.proxy?.nginx).toContain("server_name evertap.example.com;");

    await machine.system.settings.update({
      mode: "network",
      publicUrl: null,
      listenHost: "0.0.0.0",
    });
    expect(await machine.system.settings.network()).toMatchObject({
      exposedAt: "203.0.113.5",
      proxy: null,
    });
  });

  it("checks the URL in force through the store's probe", async () => {
    const store = settingsStore();
    const machine = as(store, LOCAL);
    await machine.system.settings.update({
      mode: "network",
      publicUrl: "https://evertap.example.com",
      listenHost: "127.0.0.1",
    });
    const probed: string[] = [];
    store.probe = (url) => {
      probed.push(url);
      return Promise.resolve({ answered: false, failure: "refused" });
    };
    expect(await machine.system.settings.check()).toEqual({
      url: "https://evertap.example.com",
      result: "unreachable",
      problems: [
        "Nothing answers at https://evertap.example.com. Start your proxy, or check the address",
      ],
    });
    expect(probed).toEqual(["https://evertap.example.com"]);

    // With no LAN address there is no URL to check.
    const nowhere = as(settingsStore({ ...LAN, lanAddress: () => null }), LOCAL);
    await nowhere.system.settings.update({
      mode: "network",
      publicUrl: null,
      listenHost: "0.0.0.0",
    });
    expect(await errorCode(nowhere.system.settings.check())).toBe("BAD_REQUEST");
  });

  const TUNNEL = {
    id: "c1744f8b-0000-4000-8000-000000000001",
    accountId: "account-1",
    zoneId: "zone-1",
    zone: "example.com",
    hostnames: { ui: "evertap.example.com", storage: "s3.example.com" },
    dnsRecordIds: ["record-1", "record-2"],
    cacheRule: { rulesetId: "ruleset-1", ruleId: "rule-1" },
    token: "eyJhIjoiYWNjb3VudC0xIn0",
  };
  const tunneled = {
    mode: "cloudflare",
    publicUrl: "https://evertap.example.com",
    tunnel: TUNNEL,
  } as const;

  it("checks what it saves", async () => {
    const machine = as(settingsStore(), LOCAL);
    for (const wrong of [
      { mode: "network", publicUrl: "https://evertap.example.com/sub", listenHost: "127.0.0.1" },
      { mode: "network", publicUrl: "evertap.example.com", listenHost: "127.0.0.1" },
      { mode: "network", publicUrl: null, listenHost: "localhost" },
      { ...tunneled, publicUrl: "ftp://evertap.example.com" },
    ] as const) {
      expect(await errorCode(machine.system.settings.update(wrong))).toBe("BAD_REQUEST");
    }
    // The tunnel evertap runs decides its URL, so the mode is not saved without one. A tunnel the
    // person runs is network mode.
    for (const own of [
      { mode: "cloudflare", publicUrl: null },
      { mode: "cloudflare", publicUrl: "https://evertap.example.com" },
    ]) {
      expect(savedSettingsSchema.safeParse(own).success).toBe(false);
    }
  });

  it("shows the tunnel evertap runs, never what runs it", async () => {
    const store = settingsStore();
    const machine = as(store, LOCAL);
    await machine.system.settings.update(tunneled);
    const { token: _, ...shown } = TUNNEL;
    expect((await machine.system.settings.get()).tunnel).toEqual(shown);
    expect(JSON.stringify(await machine.system.settings.get())).not.toContain(TUNNEL.token);
    expect(JSON.stringify(await machine.system.settings.preview(tunneled))).not.toContain(
      TUNNEL.token,
    );
    // While a variable keeps another mode, the tunnel is not in force.
    const elsewhere = settingsStore({ ...LAN, env: { mode: "network" } });
    await elsewhere.saveSettings(tunneled);
    expect((await as(elsewhere, LOCAL).system.settings.get()).tunnel).toBeNull();
  });

  it("takes a tunnel only from setup or evertap's own change, and lets a browser drop one", async () => {
    const store = settingsStore();
    const viaTunnel = browserAt(store, "evertap.example.com");
    expect(await errorCode(viaTunnel.system.settings.update(tunneled))).toBe("FORBIDDEN");
    expect(await errorCode(viaTunnel.system.settings.preview(tunneled))).toBe("FORBIDDEN");
    expect((await store.settings()).saved).toBeNull();

    await as(store, LOCAL).system.settings.update(tunneled);
    const another = { ...tunneled, tunnel: { ...TUNNEL, token: "another" } };
    expect(await errorCode(viaTunnel.system.settings.update(another))).toBe("FORBIDDEN");
    expect((await store.settings()).saved).toEqual(tunneled);
    // The same tunnel again changes nothing it holds.
    expect(await viaTunnel.system.settings.update(tunneled)).toMatchObject({ signIn: null });

    // On the machine, a browser may drop it and leave it in Cloudflare, but not set one of its own.
    const here = browserAt(store, "localhost:8080");
    expect(await errorCode(here.system.settings.update(another))).toBe("FORBIDDEN");
    const lan = { mode: "network", publicUrl: null, listenHost: "0.0.0.0" } as const;
    expect(await here.system.settings.update(lan)).toMatchObject({ signIn: null });
    expect((await store.settings()).saved).toEqual({ ...lan, storageUrl: null });

    // Through the tunnel, dropping it signs the browser in where it goes next.
    await as(store, LOCAL).system.settings.update(tunneled);
    expect(await viaTunnel.system.settings.preview(lan)).toMatchObject({ cutOff: true });
    expect((await viaTunnel.system.settings.update(lan)).signIn).toMatch(
      /^http:\/\/192\.168\.1\.10:8080\/signin#/,
    );
  });

  it("says where a tunnel should send each name, from the ports evertap started with", async () => {
    const machine = as(settingsStore({ ...LAN, port: 8181, publicStoragePort: 9911 }), LOCAL);
    expect(await machine.system.settings.origins()).toEqual({
      ui: "http://127.0.0.1:8181",
      storage: "http://127.0.0.1:9911",
    });
    // The bucket entry listens beside the UI.
    for (const [listenHost, ui, storage] of [
      ["0.0.0.0", "http://127.0.0.1:8080", "http://127.0.0.1:9900"],
      ["::1", "http://[::1]:8080", "http://[::1]:9900"],
      ["192.168.1.10", "http://192.168.1.10:8080", "http://192.168.1.10:9900"],
    ]) {
      const fixed = as(settingsStore({ ...LAN, env: { listenHost } }), LOCAL);
      expect(await fixed.system.settings.origins()).toEqual({ ui, storage });
    }
  });

  describe("tunnel", () => {
    const SESSION: Caller = {
      kind: "person",
      client: {
        id: "client-1",
        kind: "browser",
        name: "Chrome on macOS",
        lastUsedAt: null,
        lastUsedIp: null,
        createdAt: NOW.toISOString(),
      },
    };
    const SET_UP = { action: "set-up", names: { ui: "evertap.example.com" } } as const;
    const RESULT = { left: null, revoked: true };

    /** A store that notes who started approvals and what changed, and changes no settings. */
    const approving = (environment = LAN) => {
      const calls: string[] = [];
      const store: Store = {
        ...settingsStore(environment),
        approveCloudflare: (session) => {
          calls.push(`approve ${session}`);
          return Promise.resolve("https://dash.cloudflare.com/oauth2/auth?state=s");
        },
        changeTunnel: (session, pasted, change, { answerFirst }) => {
          calls.push(`change ${session} ${pasted} ${change.action}${answerFirst ? " first" : ""}`);
          return Promise.resolve(RESULT);
        },
      };
      return { store, calls };
    };

    it("lets only a person approve evertap in Cloudflare, for their own session", async () => {
      const { store, calls } = approving();
      const { client } = await as(store).clients.createApiKey({ name: "agent" });
      const agent = as(store, { kind: "client", client });
      expect(await errorCode(agent.system.settings.tunnel.start(SET_UP))).toBe("FORBIDDEN");
      expect(
        await errorCode(agent.system.settings.tunnel.finish({ change: SET_UP, pasted: "a#b" })),
      ).toBe("FORBIDDEN");
      expect(await errorCode(as(store, ANONYMOUS).system.settings.tunnel.start(SET_UP))).toBe(
        "UNAUTHORIZED",
      );
      expect(calls).toEqual([]);

      const person = as(store, SESSION);
      expect(await person.system.settings.tunnel.start(SET_UP)).toEqual({
        url: "https://dash.cloudflare.com/oauth2/auth?state=s",
      });
      expect(
        await person.system.settings.tunnel.finish({ change: SET_UP, pasted: " code#state " }),
      ).toMatchObject(RESULT);
      expect(calls).toEqual(["approve client-1", "change client-1 code#state set-up"]);
      expect(await person.system.settings.tunnel.progress()).toEqual({ phase: null });
      expect(await errorCode(agent.system.settings.tunnel.progress())).toBe("FORBIDDEN");
    });

    it("refuses before Cloudflare what evertap would not take", async () => {
      const pinned = approving({ ...LAN, env: { publicUrl: "https://evertap.example.org" } });
      expect(await errorCode(as(pinned.store, SESSION).system.settings.tunnel.start(SET_UP))).toBe(
        "BAD_REQUEST",
      );
      const elsewhere = approving({ ...LAN, env: { mode: "network" } });
      expect(
        await errorCode(as(elsewhere.store, SESSION).system.settings.tunnel.start(SET_UP)),
      ).toBe("BAD_REQUEST");
      const { store, calls } = approving();
      const person = as(store, SESSION);
      for (const names of [
        { ui: "example.com" },
        { ui: "evertap.exa mple.com" },
        { ui: "*.example.com" },
        { ui: "evertap.example.com", storage: "s3.example.net" },
      ]) {
        expect(
          await errorCode(person.system.settings.tunnel.start({ action: "set-up", names })),
        ).toBe("BAD_REQUEST");
      }
      // Nothing to remove yet.
      const remove = { action: "remove", next: { mode: "local" } } as const;
      expect(await errorCode(person.system.settings.tunnel.start(remove))).toBe("BAD_REQUEST");
      await as(store, LOCAL).system.settings.update(tunneled);
      expect(
        await errorCode(person.system.settings.tunnel.start({ action: "remove", next: tunneled })),
      ).toBe("BAD_REQUEST");
      expect(calls).toEqual([]);
    });
  });
});

describe("buckets reached from anywhere", () => {
  const BUCKETS_AT = "https://s3.example.com";
  // Behind the person's own proxy or tunnel, which serves buckets at an address of their own.
  const tunnel = (store: Store, storageUrl: string | null = BUCKETS_AT) =>
    as(store, LOCAL).system.settings.update({
      mode: "network",
      publicUrl: "https://evertap.example.com",
      listenHost: "127.0.0.1",
      storageUrl,
    });

  it("signs links at the buckets' address while switched on, and keeps the endpoint", async () => {
    const store = settingsStore();
    await tunnel(store);
    const client = as(store);
    const created = await client.resources.create({ engine: "garage", name: "photos" });
    if (created.kind !== "object-storage") throw new Error("Expected object storage");
    const { id, endpoint } = created;

    const on = await client.resources.setReachableAnywhere({ id, reachableAnywhere: true });
    expect(on).toMatchObject({ reachableAnywhere: true, publicEndpoint: BUCKETS_AT, endpoint });
    expect(await client.resources.connectionDetails({ id })).toMatchObject({
      endpoint,
      publicEndpoint: BUCKETS_AT,
    });
    expect(formatConnection(on, "env")).toContain(`\nS3_PUBLIC_ENDPOINT=${BUCKETS_AT}\n`);

    // Without an address of their own, nothing leads to the buckets.
    await tunnel(store, null);
    expect(await client.resources.get({ id })).toMatchObject({
      reachableAnywhere: true,
      publicEndpoint: null,
    });
    await tunnel(store);
    const off = await client.resources.setReachableAnywhere({ id, reachableAnywhere: false });
    expect(off).toMatchObject({ reachableAnywhere: false, publicEndpoint: null });
    expect(formatConnection(off, "env")).not.toContain("S3_PUBLIC_ENDPOINT");
  });

  it("serves buckets at the name the person gave a tunnel evertap made", async () => {
    const store = settingsStore();
    await as(store, LOCAL).system.settings.update({
      mode: "cloudflare",
      publicUrl: "https://evertap.example.org",
      tunnel: {
        id: "tunnel-1",
        accountId: "account-1",
        zoneId: "zone-1",
        zone: "example.org",
        hostnames: { ui: "evertap.example.org", storage: "files.example.org" },
        dnsRecordIds: [],
        cacheRule: { rulesetId: "ruleset-1", ruleId: "rule-1" },
        token: "token",
      },
    });
    expect((await as(store).system.settings.get()).storageUrl).toEqual({
      value: "https://files.example.org",
      source: "default",
    });
    const { id } = await as(store).resources.create({ engine: "garage", name: "photos" });
    expect(
      await as(store).resources.setReachableAnywhere({ id, reachableAnywhere: true }),
    ).toMatchObject({ publicEndpoint: "https://files.example.org" });
  });

  it("lets a client switch it, as the CLI does", async () => {
    const store = settingsStore();
    await tunnel(store);
    const { client } = await store.createApiKey("agent");
    const agent = as(store, { kind: "client", client });
    const { id } = await agent.resources.create({ engine: "garage", name: "photos" });
    expect(
      await agent.resources.setReachableAnywhere({ id, reachableAnywhere: true }),
    ).toMatchObject({ publicEndpoint: BUCKETS_AT });
  });

  it("refuses until other machines reach evertap and buckets have an address", async () => {
    const store = settingsStore();
    const client = as(store);
    const { id } = await client.resources.create({ engine: "garage", name: "photos" });
    const turnOn = () => client.resources.setReachableAnywhere({ id, reachableAnywhere: true });

    expect(await errorCode(turnOn())).toBe("PRECONDITION_FAILED");
    await as(store, LOCAL).system.settings.update({ mode: "local" });
    expect(await errorCode(turnOn())).toBe("PRECONDITION_FAILED");
    await tunnel(store, null);
    expect(await errorCode(turnOn())).toBe("PRECONDITION_FAILED");
    await tunnel(store);
    await turnOn();
    // Switching off needs none of it.
    await as(store, LOCAL).system.settings.update({ mode: "local" });
    expect(await client.resources.get({ id })).toMatchObject({ publicEndpoint: null });
    expect(
      await client.resources.setReachableAnywhere({ id, reachableAnywhere: false }),
    ).toMatchObject({ reachableAnywhere: false });
  });

  it("refuses a database", async () => {
    const store = settingsStore();
    await tunnel(store);
    const client = as(store);
    const { id } = await client.resources.create({ name: "blog" });
    expect(
      await errorCode(client.resources.setReachableAnywhere({ id, reachableAnywhere: true })),
    ).toBe("BAD_REQUEST");
  });

  it("gives buckets an address apart from the UI's", async () => {
    const machine = as(settingsStore(), LOCAL);
    for (const storageUrl of [
      "https://evertap.example.com",
      "https://s3.example.com/buckets",
      "s3.example.com",
    ]) {
      expect(
        await errorCode(
          machine.system.settings.update({
            mode: "network",
            publicUrl: "https://evertap.example.com",
            listenHost: "127.0.0.1",
            storageUrl,
          }),
        ),
        storageUrl,
      ).toBe("BAD_REQUEST");
    }
  });

  it("shows the way in for buckets, and what to put in front of it", async () => {
    const store = settingsStore({ ...LAN, dockerAddress: () => "172.17.0.1" });
    const machine = as(store, LOCAL);
    expect((await machine.system.settings.network()).buckets).toBeNull();

    await machine.system.settings.update({
      mode: "network",
      publicUrl: "https://evertap.example.com",
      listenHost: "172.17.0.1",
    });
    const example = (await machine.system.settings.network()).buckets;
    expect(example?.upstream).toBe("172.17.0.1:9900");
    expect(example?.proxy?.nginx).toContain("server_name s3.example.com;");

    await machine.system.settings.update({
      mode: "network",
      publicUrl: null,
      listenHost: "0.0.0.0",
      storageUrl: "https://buckets.example.org",
    });
    const given = (await machine.system.settings.network()).buckets;
    expect(given?.upstream).toBe("127.0.0.1:9900");
    expect(given?.proxy?.caddy).toContain("https://buckets.example.org {");

    // The tunnel evertap runs leads there itself.
    await machine.system.settings.update(
      plannedTunnel({ ui: "evertap.example.com", storage: "s3.example.com" }, null),
    );
    expect((await machine.system.settings.network()).buckets).toEqual({
      upstream: "127.0.0.1:9900",
      proxy: null,
    });
  });
});

/** A store whose creates fail with `error`, as a driver's would. */
const failing = (error: Error) =>
  as({
    ...memoryStore(),
    createResource: () => {
      throw error;
    },
  });

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ORPCError) {
      return { code: error.code, message: error.message };
    }
  }
  return null;
};

describe("failures", () => {
  it("point to the Doctor when something broke on the machine", async () => {
    const client = failing(new Error("connect ENOENT /var/run/docker.sock"));
    expect(await failure(client.resources.create({ name: "blog" }))).toEqual({
      code: "INTERNAL_SERVER_ERROR",
      message: "evertap couldn't do that. Check Doctor or run evertap doctor, then try again",
    });
  });

  it("pass on what a service still getting ready says", async () => {
    const client = failing(new UnavailableError("Try again in a minute"));
    expect(await failure(client.resources.create({ name: "blog" }))).toEqual({
      code: "SERVICE_UNAVAILABLE",
      message: "Try again in a minute",
    });
  });

  it("pass on what the person asked wrong", async () => {
    const client = failing(new DataError("That name is taken"));
    expect(await failure(client.resources.create({ name: "blog" }))).toEqual({
      code: "BAD_REQUEST",
      message: "That name is taken",
    });
  });
});

describe("clients", () => {
  it("pairs a CLI once a person approves its code, and hands its token out once", async () => {
    const store = memoryStore();
    const person = as(store);
    const cli = as(store, ANONYMOUS, { ip: "192.168.1.20" });
    const started = await cli.clients.pairing.start({ name: "work-macbook" });

    expect(started.code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(started.expiresAt).toBe(new Date(NOW.getTime() + PAIRING_WINDOW_MS).toISOString());
    expect(await person.clients.list()).toEqual([]);
    expect(await cli.clients.pairing.claim({ requestId: started.requestId })).toEqual({
      status: "pending",
    });

    // A person types the code however the terminal showed it.
    const typed = started.code.toLowerCase().replace("-", " ");
    expect(await person.clients.pairing.get({ code: typed })).toEqual({
      code: started.code,
      kind: "cli",
      name: "work-macbook",
      requestedAt: NOW.toISOString(),
      expiresAt: started.expiresAt,
      source: "192.168.1.20",
    });

    const paired = await person.clients.pairing.approve({ code: typed });
    expect(paired).toMatchObject({ kind: "cli", name: "work-macbook", lastUsedAt: null });
    // Listed, and let in, once the CLI has its token; the secret it polls with is not one.
    expect(await person.clients.list()).toEqual([]);
    expect(await bearerCaller(store, `Bearer ${started.requestId}`, null)).toEqual(ANONYMOUS);
    expect(await errorCode(person.clients.pairing.approve({ code: started.code }))).toBe(
      "NOT_FOUND",
    );

    const claimed = await cli.clients.pairing.claim({ requestId: started.requestId });
    expect(claimed.status).toBe("approved");
    expect(await person.clients.list()).toEqual([paired]);
    expect(claimed.token).toMatch(/^evertap_[A-Za-z0-9]{40}$/);
    expect(await cli.clients.pairing.claim({ requestId: started.requestId })).toEqual({
      status: "expired",
    });

    const caller = await bearerCaller(store, `Bearer ${claimed.token}`, "192.168.1.20");
    expect(caller).toMatchObject({ kind: "client", client: { id: paired.id } });
    expect(await as(store, caller).resources.list()).toEqual([]);
    expect((await person.clients.list())[0]).toMatchObject({
      lastUsedAt: NOW.toISOString(),
      lastUsedIp: "192.168.1.20",
    });
    // The secret it polled with stops working once the token is out.
    expect(await bearerCaller(store, `Bearer ${started.requestId}`, null)).toEqual(ANONYMOUS);
  });

  it("refuses denied, expired and malformed codes", async () => {
    let time = NOW;
    const store = memoryStore(() => time);
    const person = as(store);
    const cli = as(store, ANONYMOUS);

    const denied = await cli.clients.pairing.start({ name: "stranger" });
    expect(await person.clients.pairing.deny({ code: denied.code })).toEqual({
      code: denied.code,
    });
    expect(await errorCode(person.clients.pairing.get({ code: denied.code }))).toBe("NOT_FOUND");
    expect(await cli.clients.pairing.claim({ requestId: denied.requestId })).toEqual({
      status: "denied",
    });

    const late = await cli.clients.pairing.start({ name: "work-macbook" });
    time = new Date(NOW.getTime() + PAIRING_WINDOW_MS);
    expect(await errorCode(person.clients.pairing.approve({ code: late.code }))).toBe("NOT_FOUND");
    expect(await cli.clients.pairing.claim({ requestId: late.requestId })).toEqual({
      status: "expired",
    });

    expect(await errorCode(person.clients.pairing.get({ code: "AEIO-UAEI" }))).toBe("NOT_FOUND");
    expect(await cli.clients.pairing.claim({ requestId: "made-up" })).toEqual({
      status: "expired",
    });
    expect(await person.clients.list()).toEqual([]);
  });

  it("refuses an approval nobody claimed before its code expired", async () => {
    let time = NOW;
    const store = memoryStore(() => time);
    const cli = as(store, ANONYMOUS);
    const started = await cli.clients.pairing.start({ name: "work-macbook" });
    await as(store).clients.pairing.approve({ code: started.code });
    time = new Date(NOW.getTime() + PAIRING_WINDOW_MS + HOUR_MS);
    expect(await cli.clients.pairing.claim({ requestId: started.requestId })).toEqual({
      status: "expired",
    });
    expect(await bearerCaller(store, `Bearer ${started.requestId}`, null)).toEqual(ANONYMOUS);
  });

  it("leaves an approval a fresh window to be claimed in", async () => {
    let time = NOW;
    const store = memoryStore(() => time);
    const cli = as(store, ANONYMOUS);
    const started = await cli.clients.pairing.start({ name: "work-macbook" });
    // Approved in the code's last second; the CLI polls again just after the code ran out.
    time = new Date(NOW.getTime() + PAIRING_WINDOW_MS - 1000);
    await as(store).clients.pairing.approve({ code: started.code });
    time = new Date(NOW.getTime() + PAIRING_WINDOW_MS + 1000);
    expect(await cli.clients.pairing.claim({ requestId: started.requestId })).toMatchObject({
      status: "approved",
    });
  });

  it("drops an approval nobody claimed once its code expires", async () => {
    let time = NOW;
    const store = memoryStore(() => time);
    const person = as(store);
    const started = await as(store, ANONYMOUS).clients.pairing.start({ name: "gone" });
    await person.clients.pairing.approve({ code: started.code });
    time = new Date(NOW.getTime() + PAIRING_WINDOW_MS);
    await as(store, ANONYMOUS).clients.pairing.start({ name: "next" });
    expect(await person.clients.list()).toEqual([]);
  });

  it("normalizes typed pairing codes", () => {
    expect(normalizePairingCode(" bcdf ghjk ")).toBe("BCDF-GHJK");
    expect(normalizePairingCode("BCDFGHJK")).toBe("BCDF-GHJK");
    expect(normalizePairingCode("BCDF-GHJ")).toBeNull();
    expect(normalizePairingCode("ABCD-EFGH")).toBeNull();
  });

  it("hands out an API key once and revokes it", async () => {
    const store = memoryStore();
    const client = as(store);
    const created = await client.clients.createApiKey({ name: " github-actions " });

    expect(created.key).toMatch(/^evertap_[A-Za-z0-9]{40}$/);
    expect(created.client).toMatchObject({ kind: "api-key", name: "github-actions" });
    expect(await client.clients.list()).toEqual([created.client]);
    expect(JSON.stringify(await client.clients.list())).not.toContain(created.key);
    expect(await bearerCaller(store, `Bearer ${created.key}`, null)).toMatchObject({
      kind: "client",
    });

    expect(await errorCode(client.clients.createApiKey({ name: "github-actions" }))).toBe(
      "CONFLICT",
    );
    expect(await errorCode(client.clients.createApiKey({ name: "  " }))).toBe("BAD_REQUEST");

    expect(await client.clients.revoke({ id: created.client.id })).toEqual({
      id: created.client.id,
    });
    expect(await client.clients.list()).toEqual([]);
    expect(await errorCode(client.clients.revoke({ id: created.client.id }))).toBe("NOT_FOUND");
    expect(await bearerCaller(store, `Bearer ${created.key}`, null)).toEqual(ANONYMOUS);
  });

  it("lets only a person see, approve, or revoke clients", async () => {
    const store = memoryStore();
    const { key, client: keyClient } = await as(store).clients.createApiKey({ name: "ci" });
    const ci = as(store, await bearerCaller(store, `Bearer ${key}`, null));
    const started = await as(store, ANONYMOUS).clients.pairing.start({ name: "laptop" });

    expect(await errorCode(ci.clients.list())).toBe("FORBIDDEN");
    expect(await errorCode(ci.clients.pairing.approve({ code: started.code }))).toBe("FORBIDDEN");
    expect(await errorCode(ci.clients.createApiKey({ name: "more" }))).toBe("FORBIDDEN");
    expect(await errorCode(ci.clients.revoke({ id: keyClient.id }))).toBe("FORBIDDEN");
    // Everything else a client may do.
    expect(await ci.resources.list()).toEqual([]);

    const stranger = as(store, ANONYMOUS);
    expect(await errorCode(stranger.resources.list())).toBe("UNAUTHORIZED");
    expect(await errorCode(stranger.clients.list())).toBe("UNAUTHORIZED");
    expect(await errorCode(stranger.system.status())).toBe("UNAUTHORIZED");
    expect(await stranger.session.get()).toEqual({ signedIn: false, clientId: null });
    expect(await as(store, { kind: "local" }).clients.list()).toHaveLength(1);
  });

  it("caps open requests per source, so one flood cannot lock everyone out", async () => {
    const store = memoryStore();
    const flooder = as(store, ANONYMOUS, { ip: "198.51.100.7" });
    for (let index = 0; index < REQUESTS_PER_SOURCE_MAX; index++) {
      await flooder.clients.pairing.start({ name: `flood-${index}` });
    }
    expect(await errorCode(flooder.clients.pairing.start({ name: "one-more" }))).toBe(
      "TOO_MANY_REQUESTS",
    );
    expect(await errorCode(flooder.session.start())).toBe("TOO_MANY_REQUESTS");
    // Someone else still gets a code.
    const person = as(store, ANONYMOUS, { ip: "192.168.1.20" });
    expect(await person.clients.pairing.start({ name: "laptop" })).toMatchObject({
      code: expect.any(String),
    });
  });

  it("counts an IPv6 /64 as one source, and IPv4 on an IPv6 socket by its own address", async () => {
    const store = memoryStore();
    const from = (ip: string) => as(store, ANONYMOUS, { ip });
    // One host taking a fresh address within its /64 for each request.
    for (let index = 0; index < REQUESTS_PER_SOURCE_MAX; index++) {
      await from(`2001:db8:1:2:${index + 1}::1`).clients.pairing.start({ name: `flood-${index}` });
    }
    for (const ip of [
      "2001:DB8:1:2::99",
      "2001:0db8:0001:0002:0000:0000:0000:0099",
      "2001:db8:1:2::9%eth0",
    ]) {
      expect(await errorCode(from(ip).session.start())).toBe("TOO_MANY_REQUESTS");
    }
    expect(await from("2001:db8:1:3::1").clients.pairing.start({ name: "laptop" })).toMatchObject({
      code: expect.any(String),
    });

    // Every IPv4 caller shows up within ::ffff:0:0/96, which must not make them one source.
    for (let index = 0; index < REQUESTS_PER_SOURCE_MAX; index++) {
      await from("::ffff:198.51.100.7").clients.pairing.start({ name: `flood-${index}` });
    }
    expect(await errorCode(from("198.51.100.7").session.start())).toBe("TOO_MANY_REQUESTS");
    expect(
      await from("::ffff:192.168.1.20").clients.pairing.start({ name: "laptop" }),
    ).toMatchObject({ code: expect.any(String) });
  });

  it("caps an IPv6 /48 as a whole, so one site cannot fill the backstop", async () => {
    const store = memoryStore();
    // A fresh /64 each time the last one reaches its own cap.
    for (let index = 0; index < REQUESTS_PER_SITE_MAX; index++) {
      const subnet = Math.floor(index / REQUESTS_PER_SOURCE_MAX).toString(16);
      await as(store, ANONYMOUS, {
        ip: `2001:db8:1:${subnet}::${index + 1}`,
      }).clients.pairing.start({ name: `flood-${index}` });
    }
    for (const ip of ["2001:db8:1:4::1", "2001:DB8:1:FFFF::1"]) {
      expect(await errorCode(as(store, ANONYMOUS, { ip }).session.start())).toBe(
        "TOO_MANY_REQUESTS",
      );
    }
    expect(
      await as(store, ANONYMOUS, { ip: "2001:db8:2::1" }).clients.pairing.start({ name: "laptop" }),
    ).toMatchObject({ code: expect.any(String) });
  });

  it("keeps a backstop across sources, which the machine running evertap skips", async () => {
    const store = memoryStore();
    for (let index = 0; index < PENDING_REQUESTS_MAX; index++) {
      await as(store, ANONYMOUS, {
        ip: `10.0.${Math.floor(index / 250)}.${index % 250}`,
      }).clients.pairing.start({ name: `flood-${index}` });
    }
    expect(await errorCode(as(store, ANONYMOUS, { ip: "192.168.1.20" }).session.start())).toBe(
      "TOO_MANY_REQUESTS",
    );
    const local = as(store, { kind: "local" }, { origin: "https://evertap.example.com" });
    expect((await local.session.link()).url).toMatch(/\/signin#/);
  });
});

describe("session", () => {
  it("signs a browser in once a signed-in browser approves its code", async () => {
    const store = memoryStore();
    const phone = browser(store, SAFARI_IPHONE);
    const started = await phone.call((client) => client.session.start());
    expect(await phone.call((client) => client.session.claim())).toEqual({ status: "pending" });
    // A reload keeps the code on screen.
    expect(await phone.call((client) => client.session.start())).toEqual(started);
    expect(await browser(store).call((client) => client.session.start())).not.toEqual(started);

    const person = as(store);
    expect(await person.clients.pairing.get({ code: started.code })).toMatchObject({
      kind: "browser",
      name: "Safari on iOS",
    });
    await person.clients.pairing.approve({ code: started.code });

    expect(await phone.call((client) => client.session.get())).toEqual({
      signedIn: false,
      clientId: null,
    });
    expect(await phone.call((client) => client.session.claim())).toEqual({ status: "approved" });
    expect(await phone.call((client) => client.session.get())).toMatchObject({ signedIn: true });
    expect(await phone.call((client) => client.resources.list())).toEqual([]);
    expect(await person.clients.list()).toMatchObject([{ kind: "browser", name: "Safari on iOS" }]);

    // The session is for the cookie on the UI's path, not a bearer token on the CLI's.
    const token = phone.cookie(SESSION_COOKIE);
    expect(await bearerCaller(store, `Bearer ${token}`, null)).toEqual(ANONYMOUS);
  });

  it("over HTTPS, keeps its cookies to evertap's own host and reads no others", async () => {
    const store = memoryStore();
    // The secret of a request someone else opened, planted where a reload would show its code.
    const other = browser(store);
    const planted = await other.call((client) => client.session.start());
    const laptop = browser(store, CHROME_MAC, { https: true });
    laptop.plant("evertap_request", other.cookie("evertap_request") ?? "");

    expect(await laptop.call((client) => client.session.claim())).toEqual({ status: "expired" });
    const started = await laptop.call((client) => client.session.start());
    expect(started.code).not.toBe(planted.code);
    await as(store).clients.pairing.approve({ code: started.code });
    expect(await laptop.call((client) => client.session.claim())).toEqual({ status: "approved" });
    expect(await laptop.call((client) => client.session.get())).toMatchObject({ signedIn: true });
    expect(await laptop.call((client) => client.session.end())).toEqual({ ok: true });

    // Set and deleted alike as `__Host-` cookies, which a browser keeps to this host.
    expect(laptop.received.map((cookie) => cookie.split("=")[0])).toEqual([
      "__Host-evertap_request",
      "__Host-evertap_request",
      "__Host-evertap_session",
      "__Host-evertap_session",
    ]);
    for (const cookie of laptop.received) {
      expect(cookie).toContain("; Secure");
      expect(cookie).toContain("; Path=/");
      expect(cookie).not.toMatch(/domain=/i);
    }
    // The planted cookie was never read, so it was never deleted either.
    expect(laptop.cookie("evertap_request")).toBeDefined();
  });

  it("never takes a CLI's token or an API key as a browser session", async () => {
    const store = memoryStore();
    const { key } = await as(store).clients.createApiKey({ name: "ci" });
    expect(await sessionCaller(store, key, null)).toEqual(ANONYMOUS);
  });

  it("keeps a browser signed in for 30 days after its last call", async () => {
    let time = NOW;
    const store = memoryStore(() => time);
    const laptop = await signedIn(store);
    time = new Date(NOW.getTime() + SESSION_WINDOW_MS - 1000);
    expect(await laptop.call((client) => client.session.get())).toMatchObject({ signedIn: true });
    time = new Date(time.getTime() + SESSION_WINDOW_MS - 1000);
    expect(await laptop.call((client) => client.session.get())).toMatchObject({ signedIn: true });
    time = new Date(time.getTime() + SESSION_WINDOW_MS);
    expect(await laptop.call((client) => client.session.get())).toEqual({
      signedIn: false,
      clientId: null,
    });
    expect(await as(store).clients.list()).toEqual([]);
  });

  it("signs out by revoking the browser's own session", async () => {
    const store = memoryStore();
    const laptop = await signedIn(store);
    expect(await laptop.call((client) => client.session.end())).toEqual({ ok: true });
    expect(laptop.cookie(SESSION_COOKIE)).toBeUndefined();
    expect(await as(store).clients.list()).toEqual([]);
  });

  it("lets a CLI sign itself out", async () => {
    const store = memoryStore();
    const { key } = await as(store).clients.createApiKey({ name: "ci" });
    const ci = as(store, await bearerCaller(store, `Bearer ${key}`, null));
    expect(await ci.session.end()).toEqual({ ok: true });
    expect(await bearerCaller(store, `Bearer ${key}`, null)).toEqual(ANONYMOUS);
  });

  it("prints a one-time sign-in link only on the machine running evertap", async () => {
    const store = memoryStore();
    expect(await errorCode(as(store).session.link())).toBe("FORBIDDEN");
    expect(await errorCode(as(store, { kind: "local" }).session.link())).toBe(
      "PRECONDITION_FAILED",
    );

    const local = as(store, { kind: "local" }, { origin: "https://evertap.example.com" });
    const { url, expiresAt } = await local.session.link();
    // An unopened link is no browser yet.
    expect(await as(store).clients.list()).toEqual([]);
    expect(url).toMatch(/^https:\/\/evertap\.example\.com\/signin#[A-Za-z0-9]{40}$/);
    expect(expiresAt).toBe(new Date(NOW.getTime() + PAIRING_WINDOW_MS).toISOString());

    const token = url.split("#")[1] ?? "";
    // Its secret signs a browser in only through the link, which swaps in a session of its own.
    expect(await sessionCaller(store, token, null)).toEqual(ANONYMOUS);
    const phone = browser(store, SAFARI_IPHONE);
    expect(await phone.call((client) => client.session.redeem({ token }))).toEqual({
      status: "approved",
    });
    expect(await phone.call((client) => client.session.get())).toMatchObject({ signedIn: true });
    expect(await as(store).clients.list()).toMatchObject([
      { kind: "browser", name: "Safari on iOS" },
    ]);
    expect(await errorCode(browser(store).call((client) => client.session.redeem({ token })))).toBe(
      "NOT_FOUND",
    );
  });

  it("refuses a sign-in link once it expires", async () => {
    let time = NOW;
    const store = memoryStore(() => time);
    const local = as(store, { kind: "local" }, { origin: "https://evertap.example.com" });
    const token = (await local.session.link()).url.split("#")[1] ?? "";
    time = new Date(NOW.getTime() + PAIRING_WINDOW_MS + HOUR_MS);
    expect(await sessionCaller(store, token, null)).toEqual(ANONYMOUS);
    expect(await errorCode(browser(store).call((client) => client.session.redeem({ token })))).toBe(
      "NOT_FOUND",
    );
    expect(await as(store).clients.list()).toEqual([]);
  });

  it("names browsers by their user agent", () => {
    expect(browserName(CHROME_MAC)).toBe("Chrome on macOS");
    expect(browserName(SAFARI_IPHONE)).toBe("Safari on iOS");
    expect(
      browserName(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0",
      ),
    ).toBe("Firefox on Windows");
    expect(browserName(undefined)).toBe("Browser");
  });
});

describe("data", () => {
  it("sends tables and SQL only to PostgreSQL and MySQL, keys only to Redis", async () => {
    const client = setup();
    const pg = await client.resources.create({ name: "app" });
    const cache = await client.resources.create({ engine: "redis", name: "cache" });
    const bucket = await client.resources.create({ engine: "garage", name: "files" });

    expect(await errorCode(client.data.tables({ id: cache.id }))).toBe("BAD_REQUEST");
    expect(await errorCode(client.data.query({ id: bucket.id, sql: "select 1" }))).toBe(
      "BAD_REQUEST",
    );
    expect(await errorCode(client.data.keys({ id: pg.id }))).toBe("BAD_REQUEST");
    expect(await errorCode(client.data.tables({ id: "nope" }))).toBe("NOT_FOUND");
  });

  it("sends objects only to buckets", async () => {
    const store = memoryStore();
    const listed: string[] = [];
    store.listObjects = (resource) => {
      listed.push(resource.name);
      return Promise.resolve({ folders: [], objects: [], cursor: null });
    };
    store.listBuckets = (resource) => Promise.resolve([resource.name, "uploads"]);
    const client = as(store);
    const pg = await client.resources.create({ name: "app" });
    const bucket = await client.resources.create({ engine: "garage", name: "files" });

    expect(await client.data.objects({ id: bucket.id })).toEqual({
      folders: [],
      objects: [],
      cursor: null,
    });
    expect(listed).toEqual(["files"]);
    expect(await client.data.buckets({ id: bucket.id })).toEqual(["files", "uploads"]);
    expect(await errorCode(client.data.buckets({ id: pg.id }))).toBe("BAD_REQUEST");
    expect(await errorCode(client.data.objects({ id: pg.id }))).toBe("BAD_REQUEST");
    expect(await errorCode(client.data.deleteObject({ id: pg.id, key: "a" }))).toBe("BAD_REQUEST");
    expect(await errorCode(client.data.objectUrl({ id: bucket.id, key: "" }))).toBe("BAD_REQUEST");
  });

  it("reaches another of the key's buckets by name, and only by a bucket's name", async () => {
    const store = memoryStore();
    const reached: string[] = [];
    store.listObjects = (resource) => {
      reached.push(resource.name);
      return Promise.resolve({ folders: [], objects: [], cursor: null });
    };
    store.deleteObject = (resource, key) => {
      reached.push(`${resource.name}/${key}`);
      return Promise.resolve();
    };
    const client = as(store);
    const bucket = await client.resources.create({ engine: "garage", name: "files" });

    await client.data.objects({ id: bucket.id, bucket: "my.uploads" });
    await client.data.deleteObject({ id: bucket.id, bucket: "my.uploads", key: "a.txt" });
    expect(reached).toEqual(["my.uploads", "my.uploads/a.txt"]);
    for (const name of ["files/../other", "files?acl", "Files", "a", "-files"]) {
      expect(await errorCode(client.data.objects({ id: bucket.id, bucket: name })), name).toBe(
        "BAD_REQUEST",
      );
    }
  });

  it("passes uploads on to the store one part at a time", async () => {
    const store = memoryStore();
    const sent: string[] = [];
    store.putObject = async (resource, { key, type, body }) => {
      sent.push(`${resource.name}/${key} ${type} ${await body.text()}`);
    };
    store.uploadPart = async (resource, { key, partNumber, body }) => {
      sent.push(`${resource.name}/${key} #${partNumber} ${await body.text()}`);
      return { etag: `"etag-${partNumber}"` };
    };
    const client = as(store);
    const pg = await client.resources.create({ name: "app" });
    const bucket = await client.resources.create({ engine: "garage", name: "files" });

    await client.data.putObject({
      id: bucket.id,
      key: "a.txt",
      type: "text/plain",
      body: new Blob(["hi"]),
    });
    expect(
      await client.data.uploadPart({
        id: bucket.id,
        key: "big.bin",
        uploadId: "u1",
        partNumber: 2,
        body: new Blob(["part"]),
      }),
    ).toEqual({ etag: '"etag-2"' });
    expect(sent).toEqual(["files/a.txt text/plain hi", "files/big.bin #2 part"]);

    const tooBig = new Blob([new Uint8Array(OBJECT_PART_SIZE + 1)]);
    expect(
      await errorCode(client.data.putObject({ id: bucket.id, key: "b.bin", body: tooBig })),
    ).toBe("BAD_REQUEST");
    expect(
      await errorCode(
        client.data.uploadPart({
          id: bucket.id,
          key: "b.bin",
          uploadId: "u1",
          partNumber: 1,
          body: tooBig,
        }),
      ),
    ).toBe("BAD_REQUEST");
    expect(
      await errorCode(client.data.putObject({ id: pg.id, key: "a.txt", body: new Blob(["x"]) })),
    ).toBe("BAD_REQUEST");
    expect(sent).toHaveLength(2);
  });

  it("hands out download links on evertap's own origin, for buckets only", async () => {
    const client = setup();
    const pg = await client.resources.create({ name: "app" });
    const bucket = await client.resources.create({ engine: "garage", name: "files" });

    const { url } = await client.data.objectUrl({ id: bucket.id, key: "docs/a b&c.txt" });
    expect(url.startsWith(`${OBJECT_LINK_PATH}?`)).toBe(true);
    const query = new URL(url, "https://evertap.test").searchParams;
    expect(readObjectLink(query)).toEqual({
      id: bucket.id,
      bucket: "files",
      key: "docs/a b&c.txt",
    });
    const other = await client.data.objectUrl({ id: bucket.id, bucket: "uploads", key: "a.txt" });
    expect(readObjectLink(new URL(other.url, "https://evertap.test").searchParams)).toEqual({
      id: bucket.id,
      bucket: "uploads",
      key: "a.txt",
    });
    expect(await errorCode(client.data.objectUrl({ id: pg.id, key: "a.txt" }))).toBe("BAD_REQUEST");
    expect(
      await errorCode(as(memoryStore(), ANONYMOUS).data.objectUrl({ id: bucket.id, key: "a" })),
    ).toBe("UNAUTHORIZED");
  });

  it("hands download links to browsers only, since only a session cookie opens them", async () => {
    const store = memoryStore();
    const bucket = await as(store).resources.create({ engine: "garage", name: "files" });
    const { key } = await as(store).clients.createApiKey({ name: "CI" });
    const ci = as(store, await bearerCaller(store, `Bearer ${key}`, null));
    const local = as(store, { kind: "local" });

    expect(await errorCode(ci.data.objectUrl({ id: bucket.id, key: "a.txt" }))).toBe("FORBIDDEN");
    expect(await errorCode(local.data.objectUrl({ id: bucket.id, key: "a.txt" }))).toBe(
      "FORBIDDEN",
    );
  });

  it("refuses object names with . or .. folders, which URLs would rewrite", async () => {
    const store = memoryStore();
    const deleted: string[] = [];
    store.deleteObject = (_resource, key) => {
      deleted.push(key);
      return Promise.resolve();
    };
    const client = as(store);
    const bucket = await client.resources.create({ engine: "garage", name: "files" });

    for (const key of ["a/./b", "../x", "a/..", ".", "dots../.."]) {
      expect(await errorCode(client.data.deleteObject({ id: bucket.id, key })), key).toBe(
        "BAD_REQUEST",
      );
    }
    for (const key of [".env", "a/..b/c", "a.../b"]) {
      await client.data.deleteObject({ id: bucket.id, key });
    }
    expect(deleted).toEqual([".env", "a/..b/c", "a.../b"]);
  });

  it("refuses download links that were changed or have expired", () => {
    const query = new URL(
      signObjectLink("b1", "files", "a.txt", NOW.getTime()),
      "https://evertap.test",
    ).searchParams;
    expect(readObjectLink(query, NOW.getTime())).toEqual({
      id: "b1",
      bucket: "files",
      key: "a.txt",
    });

    const otherKey = new URLSearchParams(query);
    otherKey.set("key", "b.txt");
    expect(readObjectLink(otherKey, NOW.getTime())).toBeNull();
    const otherBucket = new URLSearchParams(query);
    otherBucket.set("bucket", "uploads");
    expect(readObjectLink(otherBucket, NOW.getTime())).toBeNull();
    const later = new URLSearchParams(query);
    later.set("expires", String(NOW.getTime() + 24 * 60 * 60 * 1000));
    expect(readObjectLink(later, NOW.getTime())).toBeNull();
    const unsigned = new URLSearchParams(query);
    unsigned.delete("signature");
    expect(readObjectLink(unsigned, NOW.getTime())).toBeNull();

    expect(readObjectLink(query, NOW.getTime() + 5 * 60 * 1000)).toBeNull();
  });

  it("passes the store's data errors on as bad requests", async () => {
    const client = setup();
    const pg = await client.resources.create({ name: "app" });
    // The memory store has nothing to browse and says so.
    expect(await errorCode(client.data.tables({ id: pg.id }))).toBe("BAD_REQUEST");
    expect(await errorCode(client.data.query({ id: pg.id, sql: "  " }))).toBe("BAD_REQUEST");
  });

  it("runs SQL read-only unless writes are asked for", async () => {
    const store = memoryStore();
    const runs: (boolean | undefined)[] = [];
    store.runQuery = (_resource, _sql, options) => {
      runs.push(options?.readOnly);
      return Promise.resolve({
        columns: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        durationMs: 1,
      });
    };
    const client = as(store);
    const pg = await client.resources.create({ name: "app" });

    await client.data.query({ id: pg.id, sql: "select 1" });
    await client.data.query({ id: pg.id, sql: "delete from t", write: true });
    expect(runs).toEqual([true, false]);
  });
});
