import { afterAll, describe, expect, test } from "bun:test";

import type { ObjectStorage } from "@evertap/api/schemas";

import { createObjectBrowser } from "./s3.ts";

const packed = Bun.gzipSync("hello");

// A stand-in instance holding one object stored gzip-encoded, as a static site's assets often are.
const instance = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => {
    if (new URL(request.url).pathname === "/files/notes.txt") {
      return new Response(packed, {
        headers: { "content-type": "text/plain", "content-encoding": "gzip" },
      });
    }
    return new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
  },
});

afterAll(() => {
  void instance.stop(true);
});

const browser = createObjectBrowser(() => Promise.resolve(instance.url.origin));

const bucket: ObjectStorage = {
  id: "b1",
  kind: "object-storage",
  engine: "garage",
  name: "files",
  description: "",
  endpoint: "http://ev.internal:3900",
  region: "us-east-1",
  accessKeyId: "AKIATEST",
  secretAccessKey: "secret",
  reachableAnywhere: false,
  publicEndpoint: null,
  protected: false,
  expiresAt: null,
  sizeBytes: 0,
  lastConnectedAt: null,
  createdAt: "2026-10-02T00:00:00.000Z",
};

describe("readObject", () => {
  test("hands over an object stored gzip-encoded as it is stored", async () => {
    const object = await browser.readObject(bucket, "notes.txt");
    expect(object?.contentType).toBe("text/plain");
    expect(new Uint8Array(await new Response(object?.body).arrayBuffer())).toEqual(packed);
  });

  test("answers null for a key that does not exist", async () => {
    expect(await browser.readObject(bucket, "never-was.txt")).toBeNull();
  });
});
