import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { DataError, type Store } from "@evertap/api/context";
import { appRouter } from "@evertap/api/router";
import type { TunnelPhase } from "@evertap/api/rules";
import type { SavedSettings, TunnelChangeInput } from "@evertap/api/schemas";
import type { SettingsEnvironment } from "@evertap/api/settings";
import { createMemoryStore } from "@evertap/api/store/memory";
import { createRouterClient, ORPCError } from "@orpc/server";

import { SCOPES } from "./cloudflare-oauth.ts";
import { startFakeCloudflare } from "./cloudflare-testing.ts";
import { TUNNEL_UNCONNECTED, createTunnelChanges } from "./tunnel.ts";

const fake = startFakeCloudflare();
const before = { ...process.env };

beforeAll(() => {
  Object.assign(process.env, fake.env);
});

beforeEach(() => {
  fake.reset();
  steps = [];
  saveFails = null;
  seen = [];
  sessions = [];
});

afterAll(async () => {
  process.env = before;
  await fake.stop();
});

const ENVIRONMENT: SettingsEnvironment = {
  env: {},
  port: 8080,
  publicStoragePort: 9900,
  lanAddress: () => "192.168.1.20",
  lanName: "evertap.local",
  dockerAddress: () => null,
  publicAddresses: () => [],
};

const ON_THE_LAN: SavedSettings = {
  mode: "network",
  publicUrl: null,
  listenHost: "0.0.0.0",
  storageUrl: null,
};

/**
 * What the server did, in order: `save` puts settings in force, starting cloudflared for a tunnel
 * they bring and waiting for it to connect, and `run` starts or stops cloudflared.
 */
let steps: string[] = [];
/** Why putting settings in force fails, as when the UI cannot listen where they say. */
let saveFails: string | null = null;
/** Where the change was each time it was put in force, as the page would see it. */
let seen: (string | null)[] = [];
/** The browsers that started an approval, in order. */
let sessions: string[] = [];

/** The server's store, with its changes in Cloudflare, over settings kept in memory. */
const serverStore = (
  savedSettings: SavedSettings | null = ON_THE_LAN,
  now: () => number = Date.now,
): Store => {
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
    settings: ENVIRONMENT,
    savedSettings: savedSettings ?? undefined,
  });
  const putInForce = async (saved: SavedSettings, report: (phase: TunnelPhase) => void) => {
    steps.push(`save ${saved.mode}`);
    seen.push(...(await Promise.all(sessions.map((session) => changes.progress(session)))));
    if (saved.mode === "cloudflare") {
      report("connecting");
      seen.push(...(await Promise.all(sessions.map((session) => changes.progress(session)))));
    }
    if (saveFails) {
      throw new DataError(saveFails);
    }
    await store.saveSettings(saved);
  };
  const changes = createTunnelChanges({
    settings: store.settings,
    save: putInForce,
    run: (tunnel) => {
      steps.push(`run ${tunnel?.hostnames.ui ?? "nothing"}`);
      return Promise.resolve();
    },
    now,
    answerMs: 0,
  });
  return {
    ...store,
    saveSettings: async (saved) => {
      await putInForce(saved, () => undefined);
    },
    approveCloudflare: (session) => {
      sessions.push(session);
      return changes.approve(session);
    },
    changeTunnel: changes.change,
    tunnelProgress: changes.progress,
  };
};

/** A browser signed in to evertap, which opened it as `host`. */
const browser = async (store: Store, host: string) => {
  const started = await store.startPairing({ kind: "browser", name: "Browser", source: null });
  if (!started) throw new Error("Expected a pairing");
  const client = await store.approvePairing(started.code, null);
  return createRouterClient(appRouter, {
    context: {
      store,
      caller: { kind: "person", client },
      reqHeaders: new Headers({
        host,
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0",
      }),
    },
  });
};

type Browser = Awaited<ReturnType<typeof browser>>;

/** Starts `change`, approves evertap in Cloudflare as the person would, and pastes the code back. */
const approved = async (from: Browser, change: TunnelChangeInput) => {
  const { url } = await from.system.settings.tunnel.start(change);
  const pasted = await fake.approve(url);
  return from.system.settings.tunnel.finish({ change, pasted });
};

const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof ORPCError ? `${error.code}: ${error.message}` : String(error);
  }
  return "resolved";
};

/** Whether every access Cloudflare handed evertap has been given back. */
const allGivenBack = () => [...fake.state.access.values()].every((access) => access.revoked);

/** Waits for what evertap finishes once its answer is out, which ends by giving the access back. */
const givenBack = async () => {
  for (let tries = 0; tries < 100 && !allGivenBack(); tries++) {
    await Bun.sleep(10);
  }
  expect(allGivenBack()).toBe(true);
};

const SET_UP = { action: "set-up", names: { ui: "evertap.example.com" } } as const;

describe("a tunnel made in Settings", () => {
  test("asks Cloudflare for what the tunnel needs alone, with a PKCE challenge", async () => {
    const laptop = await browser(serverStore(), "192.168.1.20:8080");
    const { url } = await laptop.system.settings.tunnel.start(SET_UP);
    const consent = new URL(url);
    expect(`${consent.origin}${consent.pathname}`).toBe(
      `${fake.env.EVERTAP_CLOUDFLARE_DASH}/oauth2/auth`,
    );
    expect(Object.fromEntries(consent.searchParams)).toEqual({
      response_type: "code",
      client_id: expect.any(String),
      redirect_uri: "https://evertap.dev/auth/cloudflare",
      scope:
        "argotunnel.write zone.read dns.read dns.write cache-settings.read cache-settings.write",
      state: expect.stringMatching(/^[\w-]{43}$/),
      code_challenge: expect.stringMatching(/^[\w-]{43}$/),
      code_challenge_method: "S256",
    });
  });

  test("makes the tunnel from a browser on the LAN, signs it in at the tunnel, and gives the access back", async () => {
    const store = serverStore();
    const laptop = await browser(store, "192.168.1.20:8080");
    const outcome = await approved(laptop, {
      action: "set-up",
      names: { ui: " https://Evertap.Example.com/ ", storage: "" },
    });
    const [tunnel] = fake.state.tunnels.values();
    expect(fake.made()).toEqual({
      tunnels: [
        {
          name: "evertap",
          config: {
            ingress: [
              { hostname: "evertap.example.com", service: "http://127.0.0.1:8080" },
              { hostname: "s3.example.com", service: "http://127.0.0.1:9900" },
              { service: "http_status:404" },
            ],
          },
        },
      ],
      records: ["evertap.example.com", "s3.example.com"].map((name) => ({
        zone: "zone-1",
        name,
        type: "CNAME",
        content: `${tunnel?.id}.cfargotunnel.com`,
        proxied: true,
      })),
      rules: [
        { zone: "zone-1", ref: "evertap_s3_bypass", expression: '(http.host eq "s3.example.com")' },
      ],
    });
    expect((await store.settings()).saved).toMatchObject({
      mode: "cloudflare",
      publicUrl: "https://evertap.example.com",
      tunnel: { id: tunnel?.id, zone: "example.com", token: `run-${tunnel?.id}` },
    });
    expect(outcome).toMatchObject({
      left: null,
      revoked: true,
      settings: {
        mode: { value: "cloudflare" },
        publicUrl: { value: "https://evertap.example.com" },
        listenHost: { value: "127.0.0.1" },
        storageUrl: { value: "https://s3.example.com" },
      },
    });
    // The LAN address stops answering, so the browser signs in again at the tunnel's.
    const [link = "", requestId = ""] = outcome.signIn?.split("#") ?? [];
    expect(link).toBe("https://evertap.example.com/signin");
    expect((await store.claimPairing(requestId)).status).toBe("approved");
    expect(JSON.stringify(outcome)).not.toContain("run-");
    expect(JSON.stringify(outcome)).not.toContain("ory_at_");
    expect(fake.state.access.size).toBe(1);
    expect(allGivenBack()).toBe(true);
    expect(fake.state.calls.at(-1)).toBe("POST /oauth2/revoke");
    // Saving starts cloudflared and waits for it before the LAN address closes.
    expect(steps).toEqual(["save cloudflare"]);
  });

  test("tells the browser that started a change where it is, and no one else", async () => {
    const store = serverStore();
    const laptop = await browser(store, "192.168.1.20:8080");
    const other = await browser(store, "192.168.1.30:8080");
    await other.system.settings.tunnel.start(SET_UP);
    await approved(laptop, SET_UP);
    // The other browser started nothing, so it sees nothing; the laptop sees its own change move on.
    expect(seen).toEqual([null, "cloudflare", null, "connecting"]);
    expect(await laptop.system.settings.tunnel.progress()).toEqual({ phase: null });
  });

  test("stays on a browser that keeps its way in", async () => {
    // Before setup, evertap listens on 127.0.0.1 as it does with a tunnel.
    const store = serverStore(null);
    const here = await browser(store, "localhost:8080");
    expect((await approved(here, SET_UP)).signIn).toBeNull();
  });

  test("moves the tunnel to another domain, keeping routes added to it in Cloudflare", async () => {
    const store = serverStore();
    await approved(await browser(store, "192.168.1.20:8080"), SET_UP);
    const [tunnel] = fake.state.tunnels.values();
    const grafana = { hostname: "grafana.example.com", service: "http://127.0.0.1:3000" };
    if (!tunnel) throw new Error("Expected a tunnel");
    tunnel.config = {
      ingress: [
        { hostname: "evertap.example.com", service: "http://127.0.0.1:8080" },
        { hostname: "s3.example.com", service: "http://127.0.0.1:9900" },
        grafana,
        { service: "http_status:418" },
      ],
      originRequest: { connectTimeout: 30 },
    };

    const viaTunnel = await browser(store, "evertap.example.com");
    const outcome = await approved(viaTunnel, {
      action: "set-up",
      names: { ui: "evertap.example.net" },
    });
    // The answer goes back through the old name, which leads here until it has.
    expect(outcome).toMatchObject({ left: null, revoked: null });
    expect(fake.made().tunnels[0]?.config).toMatchObject({
      ingress: [
        { hostname: "evertap.example.net" },
        { hostname: "s3.example.net" },
        { hostname: "evertap.example.com" },
        { hostname: "s3.example.com" },
        grafana,
        { service: "http_status:418" },
      ],
    });
    await givenBack();
    expect(fake.made()).toEqual({
      tunnels: [
        {
          name: "evertap",
          config: {
            ingress: [
              { hostname: "evertap.example.net", service: "http://127.0.0.1:8080" },
              { hostname: "s3.example.net", service: "http://127.0.0.1:9900" },
              grafana,
              { service: "http_status:418" },
            ],
            originRequest: { connectTimeout: 30 },
          },
        },
      ],
      records: ["evertap.example.net", "s3.example.net"].map((name) => ({
        zone: "zone-2",
        name,
        type: "CNAME",
        content: `${tunnel.id}.cfargotunnel.com`,
        proxied: true,
      })),
      rules: [
        { zone: "zone-2", ref: "evertap_s3_bypass", expression: '(http.host eq "s3.example.net")' },
      ],
    });
    expect(outcome.signIn).toStartWith("https://evertap.example.net/signin#");
  });

  test("keeps the old names leading here when the switch to new ones fails", async () => {
    const store = serverStore();
    const here = await browser(store, "localhost:8080");
    await approved(here, SET_UP);
    saveFails = TUNNEL_UNCONNECTED;
    expect(
      await refusal(approved(here, { action: "set-up", names: { ui: "ev.example.com" } })),
    ).toBe(`BAD_REQUEST: ${TUNNEL_UNCONNECTED}`);
    expect(fake.made().tunnels[0]?.config).toMatchObject({
      ingress: [
        { hostname: "ev.example.com" },
        { hostname: "s3.example.com" },
        { hostname: "evertap.example.com" },
        { service: "http_status:404" },
      ],
    });
    expect((await store.settings()).saved).toMatchObject({
      publicUrl: "https://evertap.example.com",
    });
    expect(allGivenBack()).toBe(true);
  });

  test("removes the tunnel for a browser that keeps a way in, and says how it went", async () => {
    const store = serverStore();
    await approved(await browser(store, "192.168.1.20:8080"), SET_UP);
    steps = [];
    const here = await browser(store, "localhost:8080");
    const outcome = await approved(here, { action: "remove", next: ON_THE_LAN });
    expect(fake.made()).toEqual({ tunnels: [], records: [], rules: [] });
    expect((await store.settings()).saved).toEqual(ON_THE_LAN);
    expect(outcome).toMatchObject({ left: null, revoked: true, signIn: null });
    expect(allGivenBack()).toBe(true);
    // Cloudflare deletes the tunnel once cloudflared lets go, and the address moves last.
    expect(steps).toEqual(["run nothing", "save network"]);
  });

  test("removes the tunnel a browser came through once its answer is out, signing it in elsewhere", async () => {
    const store = serverStore();
    await approved(await browser(store, "192.168.1.20:8080"), SET_UP);
    steps = [];
    const viaTunnel = await browser(store, "evertap.example.com");
    const outcome = await approved(viaTunnel, { action: "remove", next: ON_THE_LAN });
    // The settings move first; cloudflared stops after the answer has gone back through it.
    expect((await store.settings()).saved).toEqual(ON_THE_LAN);
    expect(outcome).toMatchObject({ left: null, revoked: null });
    const [link = "", requestId = ""] = outcome.signIn?.split("#") ?? [];
    expect(link).toBe("http://192.168.1.20:8080/signin");
    expect((await store.claimPairing(requestId)).status).toBe("approved");
    for (let tries = 0; tries < 100 && !allGivenBack(); tries++) {
      await Bun.sleep(10);
    }
    expect(steps).toEqual(["save network", "run nothing"]);
    expect(fake.made()).toEqual({ tunnels: [], records: [], rules: [] });
    expect(allGivenBack()).toBe(true);
  });

  test("leaves a tunnel a browser came through in Cloudflare, signing it in elsewhere", async () => {
    const store = serverStore();
    await approved(await browser(store, "192.168.1.20:8080"), SET_UP);
    const viaTunnel = await browser(store, "evertap.example.com");
    const { signIn } = await viaTunnel.system.settings.update(ON_THE_LAN);
    expect(signIn).toStartWith("http://192.168.1.20:8080/signin#");
    expect(fake.made().tunnels).toHaveLength(1);
  });

  test("does not switch to a tunnel that does not connect, and gives the access back", async () => {
    const store = serverStore();
    saveFails = TUNNEL_UNCONNECTED;
    const laptop = await browser(store, "192.168.1.20:8080");
    expect(await refusal(approved(laptop, SET_UP))).toBe(`BAD_REQUEST: ${TUNNEL_UNCONNECTED}`);
    expect((await store.settings()).saved).toEqual(ON_THE_LAN);
    expect(allGivenBack()).toBe(true);
    // What it made stays for the next try, which uses it again.
    expect(fake.made().tunnels).toHaveLength(1);
    for (const tunnel of fake.state.tunnels.values()) {
      tunnel.status = "inactive";
    }
    saveFails = null;
    await approved(laptop, SET_UP);
    expect(fake.made().tunnels).toHaveLength(1);
  });

  test("runs the tunnel again when it cannot switch after stopping it", async () => {
    const store = serverStore();
    await approved(await browser(store, "192.168.1.20:8080"), SET_UP);
    const { saved } = await store.settings();
    steps = [];
    saveFails =
      "0.0.0.0:8080 is taken by another program. Stop that program, or set EVERTAP_PORT to a free one";
    const here = await browser(store, "localhost:8080");
    expect(await refusal(approved(here, { action: "remove", next: ON_THE_LAN }))).toBe(
      `BAD_REQUEST: ${saveFails}`,
    );
    expect((await store.settings()).saved).toEqual(saved);
    expect(steps).toEqual(["run nothing", "save network", "run evertap.example.com"]);
    expect(allGivenBack()).toBe(true);
  });

  test("leaves what it made in Cloudflare without an approval", async () => {
    const store = serverStore();
    await approved(await browser(store, "192.168.1.20:8080"), SET_UP);
    const untouched = fake.made();
    fake.state.calls = [];
    const here = await browser(store, "localhost:8080");
    await here.system.settings.update(ON_THE_LAN);
    expect((await store.settings()).saved).toEqual(ON_THE_LAN);
    expect(fake.made()).toEqual(untouched);
    expect(fake.state.calls).toEqual([]);
  });

  test("says what it could not remove, and still gives the access back", async () => {
    const store = serverStore();
    await approved(await browser(store, "192.168.1.20:8080"), SET_UP);
    const { saved } = await store.settings();
    fake.state.failing = { path: /\/dns_records\//, status: 500 };
    const here = await browser(store, "localhost:8080");
    const outcome = await approved(here, { action: "remove", next: ON_THE_LAN });
    expect((await store.settings()).saved).toEqual(ON_THE_LAN);
    if (saved?.mode !== "cloudflare" || !saved.tunnel) throw new Error("Expected a tunnel");
    const { token: _, ...ids } = saved.tunnel;
    expect(outcome.left).toEqual({
      tunnel: ids,
      reason:
        "Cloudflare could not remove DNS records from example.com: An unknown error has occurred. Try again in a minute",
    });
    expect(outcome.revoked).toBe(true);
    expect(allGivenBack()).toBe(true);
  });

  test("serves the names the person chose, and moves them on the same tunnel", async () => {
    const store = serverStore();
    const here = await browser(store, "localhost:8080");
    const custom = { ui: "db.example.com", storage: "files.example.com" };
    await approved(here, { action: "set-up", names: custom });
    const [tunnel] = fake.state.tunnels.values();
    if (!tunnel) throw new Error("Expected a tunnel");
    expect(fake.made().records.map(({ name }) => name)).toEqual([
      "db.example.com",
      "files.example.com",
    ]);
    expect(fake.made().rules.map(({ expression }) => expression)).toEqual([
      '(http.host eq "files.example.com")',
    ]);
    expect((await store.settings()).saved).toMatchObject({
      publicUrl: "https://db.example.com",
      tunnel: { zone: "example.com", hostnames: custom },
    });
    expect((await here.system.settings.get()).storageUrl.value).toBe("https://files.example.com");
    const [rule] = [...fake.state.rulesets.values()].flatMap(({ rules }) => rules);
    if (!rule) throw new Error("Expected a Cache Rule");

    // From the machine, so the browser keeps its way in at localhost.
    const renamed = { ui: "evertap.example.com", storage: "buckets.example.com" };
    const outcome = await approved(here, { action: "set-up", names: renamed });
    expect(outcome).toMatchObject({ left: null, revoked: true, signIn: null });
    expect([...fake.state.tunnels.keys()]).toEqual([tunnel.id]);
    expect(fake.made().records.map(({ name }) => name)).toEqual([
      "evertap.example.com",
      "buckets.example.com",
    ]);
    // The same Cache Rule, now for the new name.
    expect([...fake.state.rulesets.values()].flatMap(({ rules }) => rules)).toEqual([
      { ...rule, expression: '(http.host eq "buckets.example.com")' },
    ]);
    expect(fake.made().tunnels[0]?.config).toEqual({
      ingress: [
        { hostname: "evertap.example.com", service: "http://127.0.0.1:8080" },
        { hostname: "buckets.example.com", service: "http://127.0.0.1:9900" },
        { service: "http_status:404" },
      ],
    });
    expect((await store.settings()).saved).toMatchObject({
      publicUrl: "https://evertap.example.com",
      tunnel: { id: tunnel.id, hostnames: renamed },
    });
  });

  test("refuses a name more than one level under a domain in the account", async () => {
    const store = serverStore();
    expect(
      await refusal(
        approved(await browser(store, "localhost:8080"), {
          action: "set-up",
          names: { ui: "evertap.dev.example.com" },
        }),
      ),
    ).toBe(
      "BAD_REQUEST: Choose a name one level under example.com, such as evertap.example.com: Cloudflare's free certificate covers no deeper",
    );
    expect(fake.made().tunnels).toEqual([]);
    expect(allGivenBack()).toBe(true);
  });

  test("says when Cloudflare did not take the access back", async () => {
    fake.state.revokeFails = true;
    const outcome = await approved(await browser(serverStore(), "localhost:8080"), SET_UP);
    expect(outcome.revoked).toBe(false);
    expect(fake.made().tunnels).toHaveLength(1);
  });
});

describe("what the person pastes", () => {
  test("takes Cloudflare's whole address as well as evertap.dev's code", async () => {
    const store = serverStore();
    const here = await browser(store, "localhost:8080");
    const { url } = await here.system.settings.tunnel.start(SET_UP);
    const [code, state] = (await fake.approve(url)).split("#");
    const pasted = `https://evertap.dev/auth/cloudflare?code=${code}&scope=zone.read&state=${state}`;
    expect((await here.system.settings.tunnel.finish({ change: SET_UP, pasted })).revoked).toBe(
      true,
    );
  });

  test("refuses a code without its state, or from another approval, before it reaches Cloudflare", async () => {
    const store = serverStore();
    const here = await browser(store, "localhost:8080");
    const other = await browser(store, "localhost:8080");
    const { url } = await here.system.settings.tunnel.start(SET_UP);
    const pasted = await fake.approve(url);
    await other.system.settings.tunnel.start(SET_UP);
    fake.state.calls = [];
    expect(await refusal(other.system.settings.tunnel.finish({ change: SET_UP, pasted }))).toBe(
      "BAD_REQUEST: That code is from another approval. Approve evertap again from here, then paste the code it gives",
    );
    const [code = ""] = pasted.split("#");
    expect(
      await refusal(here.system.settings.tunnel.finish({ change: SET_UP, pasted: code })),
    ).toBe("BAD_REQUEST: Paste all of what evertap.dev shows, with the part after #");
    expect(fake.state.calls).toEqual([]);
    // The right one still works afterwards.
    expect((await here.system.settings.tunnel.finish({ change: SET_UP, pasted })).revoked).toBe(
      true,
    );
  });

  test("keeps an approval for ten minutes, for the browser that started it, and for one change", async () => {
    let now = Date.now();
    const store = serverStore(ON_THE_LAN, () => now);
    const here = await browser(store, "localhost:8080");
    const elsewhere = await browser(store, "localhost:8080");
    const { url } = await here.system.settings.tunnel.start(SET_UP);
    const pasted = await fake.approve(url);
    const expired = "BAD_REQUEST: This approval has expired. Approve evertap in Cloudflare again";
    expect(await refusal(elsewhere.system.settings.tunnel.finish({ change: SET_UP, pasted }))).toBe(
      expired,
    );
    now += 10 * 60 * 1000;
    expect(await refusal(here.system.settings.tunnel.finish({ change: SET_UP, pasted }))).toBe(
      expired,
    );

    const again = await fake.approve((await here.system.settings.tunnel.start(SET_UP)).url);
    await here.system.settings.tunnel.finish({ change: SET_UP, pasted: again });
    expect(
      await refusal(here.system.settings.tunnel.finish({ change: SET_UP, pasted: again })),
    ).toBe(expired);
  });
});

describe("what stops a change", () => {
  const nothingChanged = async (store: Store) => {
    expect(fake.made()).toEqual({ tunnels: [], records: [], rules: [] });
    expect((await store.settings()).saved).toEqual(ON_THE_LAN);
    expect(allGivenBack()).toBe(true);
  };

  test("names the permissions left out of the approval, and gives the rest back", async () => {
    fake.state.granted = SCOPES.filter((scope) => scope !== "dns.write" && scope !== "zone.read");
    const store = serverStore();
    expect(await refusal(approved(await browser(store, "localhost:8080"), SET_UP))).toBe(
      "BAD_REQUEST: The approval left out what evertap needs: zone.read, dns.write. Approve evertap again, leaving every permission it asks for on",
    );
    expect(fake.state.access.size).toBe(1);
    await nothingChanged(store);
  });

  test("says when the domain is not in the account the person approved", async () => {
    const store = serverStore();
    expect(
      await refusal(
        approved(await browser(store, "localhost:8080"), {
          action: "set-up",
          names: { ui: "evertap.example.org" },
        }),
      ),
    ).toBe(
      "BAD_REQUEST: example.org is not in the Cloudflare account you approved. Approve evertap for the account that has it, or check the name",
    );
    await nothingChanged(store);
  });

  test("points to an API token when Cloudflare challenges this machine", async () => {
    fake.state.challenge = true;
    const store = serverStore();
    const message = await refusal(approved(await browser(store, "localhost:8080"), SET_UP));
    expect(message).toStartWith(
      "BAD_REQUEST: Cloudflare stopped this machine's request for access, as it does some from data centers. Give evertap setup on this machine an API token instead, made at https://dash.cloudflare.com/profile/api-tokens?",
    );
    await nothingChanged(store);
  });

  test("says what the person's account may not do", async () => {
    fake.state.failing = { path: /\/rulesets\//, status: 403 };
    const store = serverStore();
    expect(await refusal(approved(await browser(store, "localhost:8080"), SET_UP))).toBe(
      "BAD_REQUEST: Cloudflare did not let evertap add a Cache Rule to example.com. Approve evertap again as a member of the account with Zone · Cache Rules · Edit",
    );
    expect(allGivenBack()).toBe(true);
  });

  test("says when a code was already used", async () => {
    const store = serverStore();
    const here = await browser(store, "localhost:8080");
    const { url } = await here.system.settings.tunnel.start(SET_UP);
    const pasted = await fake.approve(url);
    fake.state.codes.clear();
    expect(await refusal(here.system.settings.tunnel.finish({ change: SET_UP, pasted }))).toBe(
      "BAD_REQUEST: That code has expired or was already used. Approve evertap in Cloudflare again, then paste the new code",
    );
  });
});
