import { afterAll, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import type { AppRouterClient } from "@evertap/api/router";
import { SESSION_COOKIE } from "@evertap/api/rules";
import { OBJECT_PART_SIZE } from "@evertap/api/schemas";
import { createMemoryStore } from "@evertap/api/store/memory";
import { ORPCError, createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { SimpleCsrfProtectionLinkPlugin } from "@orpc/client/plugins";

import { createAccess } from "./access.ts";
import { probeUrl } from "./reach.ts";

const store = createMemoryStore({
  version: "1.2.3",
  host: "evertap.local",
  port: 6432,
  machine: () =>
    Promise.resolve({
      disk: { totalBytes: 1000, freeBytes: 500 },
      memory: { totalBytes: 2000, freeBytes: 1500 },
      cpu: { usedRatio: 0.25, cores: 4 },
    }),
});
const access = createAccess({
  saved: {
    mode: "network",
    publicUrl: "http://evertap.test",
    listenHost: "127.0.0.1",
    storageUrl: null,
  },
  keep: () => {},
  // None, whatever the shell running the tests has set.
  variables: {},
});
// The real store reaches Docker as it loads, so it is swapped out before the app imports it.
await mock.module("./store.ts", () => ({ store, access }));
const { createApp } = await import("./app.ts");

// The app logs failed requests and errors; the tests read the responses instead.
const logs = [spyOn(console, "log"), spyOn(console, "error")].map((spy) =>
  spy.mockImplementation(() => {}),
);

const network = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (await createApp({ local: false })).fetch,
});
const dir = await mkdtemp(join(tmpdir(), "evertap-app-"));
const socket = join(dir, "evertap.sock");
const local = Bun.serve({ unix: socket, fetch: (await createApp({ local: true })).fetch });

afterAll(async () => {
  for (const spy of logs) {
    spy.mockRestore();
  }
  void network.stop(true);
  void local.stop(true);
  await rm(dir, { recursive: true, force: true });
});

/** A browser's session, signed in with a code approved on this machine. */
const signIn = async () => {
  const started = await store.startPairing({
    kind: "browser",
    name: "Chrome on macOS",
    source: null,
  });
  if (!started) throw new Error("Expected a sign-in request");
  const client = await store.approvePairing(started.code, null);
  const claimed = await store.claimPairing(started.requestId);
  if (claimed.status !== "approved") throw new Error("Expected an approved sign-in");
  return { id: client.id, token: claimed.token };
};

const browser = await signIn();
const { key: apiKey } = await store.createApiKey("CI");

/**
 * `host` is the name the caller opened evertap at, the address it connects to by default.
 * `forwardedFor` is what a proxy in front of evertap would pass on.
 */
type Credentials = { cookie?: string; bearer?: string; host?: string; forwardedFor?: string };

const connect = (
  path: "/api/rpc" | "/api/client/rpc",
  { cookie, bearer, host, forwardedFor }: Credentials,
  { csrf }: { csrf: boolean },
): AppRouterClient =>
  createORPCClient(
    new RPCLink({
      url: `${network.url.origin}${path}`,
      headers: {
        ...(cookie === undefined ? {} : { cookie: `${SESSION_COOKIE}=${cookie}` }),
        ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
        ...(host === undefined ? {} : { host }),
        ...(forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor }),
      },
      plugins: csrf ? [new SimpleCsrfProtectionLinkPlugin()] : [],
    }),
  );

const errorCode = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof ORPCError ? error.code : "not-an-orpc-error";
  }
  return "resolved";
};

/** As the web app calls: with oRPC's CSRF header. */
const ui = (credentials: Credentials) => connect("/api/rpc", credentials, { csrf: true });
/** As the CLI calls: no CSRF header. */
const cli = (credentials: Credentials) => connect("/api/client/rpc", credentials, { csrf: false });

describe("/api/rpc, the UI's path", () => {
  test("signs in a browser by its session cookie", async () => {
    expect(await ui({ cookie: browser.token }).session.get()).toEqual({
      signedIn: true,
      clientId: browser.id,
    });
  });

  test("refuses a call without oRPC's CSRF header before it runs", async () => {
    const page = connect("/api/rpc", { cookie: browser.token }, { csrf: false });
    expect(await errorCode(page.resources.create({ name: "blog" }))).toBe("CSRF_TOKEN_MISMATCH");
    expect((await store.listResources()).map((resource) => resource.name)).not.toContain("blog");
  });

  test("ignores a bearer token", async () => {
    expect(await errorCode(ui({ bearer: apiKey }).resources.list())).toBe("UNAUTHORIZED");
  });

  test("over HTTPS, takes the session from its __Host- cookie alone, which no other host can plant", async () => {
    // As a proxy or tunnel with HTTPS passes the browser's call on.
    const page = (cookie: string): AppRouterClient =>
      createORPCClient(
        new RPCLink({
          url: `${network.url.origin}/api/rpc`,
          headers: { cookie, "x-forwarded-proto": "https" },
          plugins: [new SimpleCsrfProtectionLinkPlugin()],
        }),
      );
    expect(await page(`__Host-evertap_session=${browser.token}`).session.get()).toMatchObject({
      signedIn: true,
    });
    expect(await page(`evertap_session=${browser.token}`).session.get()).toMatchObject({
      signedIn: false,
    });
  });

  test("refuses an API key sent as the session cookie", async () => {
    expect(await errorCode(ui({ cookie: apiKey }).resources.list())).toBe("UNAUTHORIZED");
  });
});

describe("/api/client/rpc, the CLI's path", () => {
  test("signs in an API key by its bearer token, without a CSRF header", async () => {
    expect(await cli({ bearer: apiKey }).resources.list()).toBeArray();
  });

  test("ignores a session cookie", async () => {
    expect(await errorCode(cli({ cookie: browser.token }).resources.list())).toBe("UNAUTHORIZED");
  });

  test("refuses a browser's session sent as a bearer token", async () => {
    expect(await errorCode(cli({ bearer: browser.token }).resources.list())).toBe("UNAUTHORIZED");
  });
});

describe("the error log", () => {
  test("leaves out refusals and keeps what failed", async () => {
    const errors = logs[1];
    errors?.mockClear();
    expect(await errorCode(cli({}).resources.list())).toBe("UNAUTHORIZED");
    expect(await errorCode(cli({ bearer: apiKey }).resources.get({ id: "never-was" }))).toBe(
      "NOT_FOUND",
    );
    expect(errors?.mock.calls).toEqual([]);

    const failure = new Error("disk gone");
    const listing = spyOn(store, "listResources").mockRejectedValueOnce(failure);
    try {
      expect(await errorCode(cli({ bearer: apiKey }).resources.list())).toBe(
        "INTERNAL_SERVER_ERROR",
      );
    } finally {
      listing.mockRestore();
    }
    expect(errors?.mock.calls).toEqual([[expect.objectContaining({ cause: failure })]]);
  });
});

describe("the request log", () => {
  const lines = () =>
    logs[0]?.mock.calls.flat().map((line) => stripVTControlCharacters(String(line)));

  test("leaves out what succeeded and refusals the caller is told about", async () => {
    logs[0]?.mockClear();
    expect((await fetch(`${network.url.origin}/api/health`)).status).toBe(200);
    expect(await errorCode(cli({}).resources.list())).toBe("UNAUTHORIZED");
    expect(await errorCode(cli({ bearer: apiKey }).resources.get({ id: "never-was" }))).toBe(
      "NOT_FOUND",
    );
    expect(lines()).toEqual([]);
  });

  test("keeps what failed", async () => {
    logs[0]?.mockClear();
    const response = await fetch(`${network.url.origin}/api/health`, {
      headers: { host: "attacker.example" },
    });
    expect(response.status).toBe(403);
    const listing = spyOn(store, "listResources").mockRejectedValueOnce(new Error("disk gone"));
    try {
      expect(await errorCode(cli({ bearer: apiKey }).resources.list())).toBe(
        "INTERNAL_SERVER_ERROR",
      );
    } finally {
      listing.mockRestore();
    }
    expect(lines()).toEqual([
      expect.stringMatching(/^GET \/api\/health 403 \d+ms$/),
      expect.stringMatching(/^POST \/api\/client\/rpc\/resources\/list 500 \d+ms$/),
    ]);
  });
});

describe("the Host a request names", () => {
  const health = (host: string) => fetch(`${network.url.origin}/api/health`, { headers: { host } });

  test("is evertap's own URL, an address, or localhost", async () => {
    for (const host of ["evertap.test", `127.0.0.1:${network.port}`, `localhost:${network.port}`]) {
      expect((await health(host)).status, host).toBe(200);
    }
  });

  test("refuses any other name, as a page that points its own name here sends", async () => {
    const response = await health("attacker.example");
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("evertap setup");
    expect(
      await errorCode(ui({ cookie: browser.token, host: "attacker.example" }).session.get()),
    ).toBe("FORBIDDEN");
  });

  test("tells the CLI why, as it prints an RPC refusal's message alone", async () => {
    let message = "";
    try {
      await cli({ bearer: apiKey, host: "evertap.lan" }).resources.list();
    } catch (error) {
      message = error instanceof ORPCError ? error.message : String(error);
    }
    expect(message).toStartWith(
      "evertap does not answer to this address. Use the address it was set up with",
    );
  });

  test("refuses one that does not parse, saying nothing about this machine", async () => {
    const response = await health("[");
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(process.cwd());
  });

  test("takes the LAN name in network mode", async () => {
    expect((await health(`${access.environment.lanName}:8080`)).status).toBe(200);
  });

  test("reaches the check on changes that would cut the browser off", async () => {
    const elsewhere = {
      mode: "network",
      publicUrl: "https://elsewhere.example",
      listenHost: "127.0.0.1",
    } as const;
    const page = ui({ cookie: browser.token, host: "evertap.test" });
    expect(await page.system.settings.preview(elsewhere)).toMatchObject({ cutOff: true });
    expect((await store.settings()).saved).toBeNull();
  });
});

describe("the URL check", () => {
  test("arrives at the health check, WebSocket upgrade included", async () => {
    expect(await probeUrl(network.url.origin)).toMatchObject({
      answered: true,
      status: 200,
      arrival: { host: network.url.host },
      upgrades: true,
    });
  });

  test("learns the Host a proxy sends, even one evertap refuses", async () => {
    const renaming = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        const { pathname, search } = new URL(request.url);
        return fetch(`${network.url.origin}${pathname}${search}`, {
          headers: { host: "internal.example" },
        });
      },
    });
    try {
      expect(await probeUrl(renaming.url.origin)).toMatchObject({
        answered: true,
        status: 403,
        arrival: { host: "internal.example" },
      });
    } finally {
      void renaming.stop(true);
    }
  });
});

describe("the caller's address", () => {
  const requestFrom = async (forwardedFor: string) => {
    const { code } = await cli({ forwardedFor }).clients.pairing.start({ name: "laptop" });
    return (await store.getPairing(code))?.source;
  };

  test("is the last X-Forwarded-For entry from a proxy on loopback, and the socket's in local mode", async () => {
    expect(await requestFrom("198.51.100.7, 203.0.113.9")).toBe("203.0.113.9");
    access.save({ mode: "local" });
    try {
      expect(await requestFrom("198.51.100.7, 203.0.113.9")).toBe("127.0.0.1");
    } finally {
      access.save({
        mode: "network",
        publicUrl: "http://evertap.test",
        listenHost: "127.0.0.1",
        storageUrl: null,
      });
    }
  });
});

describe("the local socket", () => {
  const machine: AppRouterClient = createORPCClient(
    new RPCLink({
      url: "http://localhost/api/client/rpc",
      fetch: (request, init) => fetch(request, { ...init, unix: socket }),
    }),
  );

  test("treats every call as the machine running evertap, with no sign-in", async () => {
    expect((await machine.session.link()).url).toStartWith("http://evertap.test/signin#");
  });

  test("may make a change no browser could, as no setting moves the socket", async () => {
    await machine.system.settings.update({ mode: "local" });
    expect((await store.settings()).saved).toEqual({ mode: "local" });
  });

  test("never treats a network call as local, even from loopback", async () => {
    expect(await errorCode(ui({ cookie: browser.token }).session.link())).toBe("FORBIDDEN");
    expect(await errorCode(cli({ bearer: apiKey }).session.link())).toBe("FORBIDDEN");
  });
});

// Objects the stand-in bucket holds; `slow.bin` goes quiet between its two bytes.
const files = await store.createResource({
  engine: "garage",
  name: "files",
  description: "",
  extensions: [],
  temporary: false,
});
const stored = new Map<string, { chunks: string[]; type: string | null; gapMs?: number }>([
  ["site/index.html", { chunks: ["<script>alert(1)</script>"], type: "text/html" }],
  ["it's (1).bin", { chunks: ["raw"], type: null }],
  ["slow.bin", { chunks: ["a", "b"], type: null, gapMs: 6000 }],
]);
store.readObject = (_resource, key) => {
  const object = stored.get(key);
  if (!object) {
    return Promise.resolve(null);
  }
  const body = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      for (const [index, chunk] of object.chunks.entries()) {
        if (index > 0 && object.gapMs) {
          await Bun.sleep(object.gapMs);
        }
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
  return Promise.resolve({ body, contentType: object.type });
};
const uploaded: string[] = [];
store.putObject = async (_resource, { key, body }) => {
  uploaded.push(`${key} ${body.size}`);
};

const linkTo = async (key: string) =>
  (await ui({ cookie: browser.token }).data.objectUrl({ id: files.id, key })).url;
const download = (url: string, headers: Record<string, string>, origin = network.url.origin) =>
  fetch(`${origin}${url}`, { headers });
const asBrowser = { cookie: `${SESSION_COOKIE}=${browser.token}` };

describe("objects through the UI's origin", () => {
  test("downloads an uploaded page as a sandboxed attachment, never as a page", async () => {
    const response = await download(await linkTo("site/index.html"), asBrowser);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<script>alert(1)</script>");
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''index.html",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("encodes every character a filename* may not carry as it is", async () => {
    const response = await download(await linkTo("it's (1).bin"), asBrowser);
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''it%27s%20%281%29.bin",
    );
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
  });

  test("refuses a download without the browser's session cookie", async () => {
    const url = await linkTo("site/index.html");
    const refused: Record<string, string>[] = [
      {},
      { authorization: `Bearer ${apiKey}` },
      { cookie: `${SESSION_COOKIE}=${apiKey}` },
    ];
    for (const headers of refused) {
      const response = await download(url, headers);
      expect(response.status).toBe(401);
      expect(response.headers.get("content-disposition")).toBeNull();
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-security-policy")).toContain("sandbox");
    }
  });

  test("over HTTPS, takes the session from its __Host- cookie alone", async () => {
    const url = await linkTo("site/index.html");
    const overHttps = (cookie: string) => download(url, { cookie, "x-forwarded-proto": "https" });
    expect((await overHttps(`__Host-evertap_session=${browser.token}`)).status).toBe(200);
    expect((await overHttps(`evertap_session=${browser.token}`)).status).toBe(401);
  });

  test("refuses a link evertap did not sign for that object", async () => {
    const url = new URL(await linkTo("site/index.html"), network.url.origin);
    const signature = url.searchParams.get("signature") ?? "";
    url.searchParams.set(
      "signature",
      `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`,
    );
    expect((await download(url.pathname + url.search, asBrowser)).status).toBe(403);
    url.searchParams.delete("signature");
    expect((await download(url.pathname + url.search, asBrowser)).status).toBe(403);
  });

  test("says when the object is gone", async () => {
    expect((await download(await linkTo("never-was.txt"), asBrowser)).status).toBe(404);
  });

  test("hands download links only to a browser", async () => {
    expect(
      await errorCode(cli({ bearer: apiKey }).data.objectUrl({ id: files.id, key: "a" })),
    ).toBe("FORBIDDEN");
  });

  test("keeps the link's key and signature out of the request log", async () => {
    logs[0]?.mockClear();
    expect((await download(await linkTo("never-was.txt"), asBrowser)).status).toBe(404);
    const lines = logs[0]?.mock.calls.flat().map(String) ?? [];
    expect(lines.some((line) => line.includes("/api/objects"))).toBe(true);
    expect(lines.some((line) => line.includes("signature="))).toBe(false);
  });

  test("keeps a download going while the bucket is quiet for longer than the idle timeout", async () => {
    const quiet = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      idleTimeout: 1,
      fetch: (await createApp({ local: false })).fetch,
    });
    try {
      const response = await download(await linkTo("slow.bin"), asBrowser, quiet.url.origin);
      expect(await response.text()).toBe("ab");
    } finally {
      void quiet.stop(true);
    }
  }, 15_000);

  test("takes uploads only with the CSRF header and in parts of at most 16 MiB", async () => {
    const page = connect("/api/rpc", { cookie: browser.token }, { csrf: false });
    const part = new Blob(["hi"]);
    expect(await errorCode(page.data.putObject({ id: files.id, key: "a.txt", body: part }))).toBe(
      "CSRF_TOKEN_MISMATCH",
    );
    const tooBig = new Blob([new Uint8Array(OBJECT_PART_SIZE + 1)]);
    expect(
      await errorCode(
        ui({ cookie: browser.token }).data.putObject({ id: files.id, key: "b", body: tooBig }),
      ),
    ).toBe("BAD_REQUEST");
    await ui({ cookie: browser.token }).data.putObject({ id: files.id, key: "a.txt", body: part });
    expect(uploaded).toEqual(["a.txt 2"]);
  });

  test("refuses a body far over one part before reading it", async () => {
    const before = uploaded.length;
    const response = await fetch(`${network.url.origin}/api/rpc/data/putObject`, {
      method: "POST",
      headers: { "content-length": String(OBJECT_PART_SIZE * 2) },
      body: new Uint8Array(OBJECT_PART_SIZE * 2),
    });
    expect(response.status).toBe(413);
    expect(uploaded).toHaveLength(before);
  });
});
