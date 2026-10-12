import { afterAll, describe, expect, test } from "bun:test";

import { freePort } from "./live/testing.ts";
import { arrived, probeUrl } from "./reach.ts";

/** Answers its health check as evertap does, noting the probes that reach it. */
const evertap = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => {
    const token = new URL(request.url).searchParams.get("probe");
    if (token) {
      arrived(token, request.headers);
    }
    return Response.json({ ok: true });
  },
});

/** Another evertap, or any site that answers the same path. */
const other = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => Response.json({ ok: true }),
});

/** A proxy that passes requests on as plain ones, without the Host or a forwarded header. */
const careless = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) => {
    const { pathname, search } = new URL(request.url);
    const response = await fetch(`${evertap.url.origin}${pathname}${search}`);
    return new Response(response.body, response);
  },
});

afterAll(() => {
  for (const server of [evertap, other, careless]) {
    void server.stop(true);
  }
});

describe("probeUrl", () => {
  test("arrives at this evertap, WebSocket upgrade included", async () => {
    expect(await probeUrl(evertap.url.origin)).toEqual({
      answered: true,
      status: 200,
      arrival: { host: evertap.url.host, forwardedFor: null, forwardedProto: null },
      upgrades: true,
    });
  });

  test("never arrives from something else at the URL", async () => {
    expect(await probeUrl(other.url.origin)).toEqual({
      answered: true,
      status: 200,
      arrival: null,
      upgrades: false,
    });
  });

  test("sees what a proxy drops on the way", async () => {
    expect(await probeUrl(careless.url.origin)).toEqual({
      answered: true,
      status: 200,
      arrival: { host: evertap.url.host, forwardedFor: null, forwardedProto: null },
      upgrades: false,
    });
  });

  test("tells a URL nothing answers at", async () => {
    expect(await probeUrl(`http://127.0.0.1:${freePort()}`)).toEqual({
      answered: false,
      failure: "refused",
    });
  });
});
