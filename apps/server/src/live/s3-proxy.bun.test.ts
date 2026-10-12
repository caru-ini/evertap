import { afterAll, describe, expect, test } from "bun:test";

import { bucketEndpoint } from "@evertap/api/rules";
import { AwsClient } from "aws4fetch";

import { startConnect } from "../cli/connect.ts";
import { createRelay } from "../relay.ts";
import { startPublicS3, startS3Proxy } from "./s3-proxy.ts";
import { freePort } from "./testing.ts";

// A stand-in Garage that echoes what reached it.
const reached: string[] = [];
const instance = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => {
    const { pathname, search } = new URL(request.url);
    reached.push(`${request.method} ${pathname}${search}`);
    const { expect: expected, ...echoed } = {
      path: pathname + search,
      host: request.headers.get("host"),
      authorization: request.headers.get("authorization"),
      expect: request.headers.get("expect"),
    };
    return Response.json(expected === null ? echoed : { ...echoed, expect: expected });
  },
});

const KEYS = new Map([["PHOTOSKEY", "photos-id"]]);
const created: string[] = [];
const port = freePort();
const proxy = startS3Proxy({
  hostname: "127.0.0.1",
  port,
  upstream: () => Promise.resolve(instance.port ?? 0),
  unreachable: () => {},
  resolve: (accessKeyId) => KEYS.get(accessKeyId) ?? null,
  created: (accessKeyId, bucket) => {
    created.push(`${accessKeyId} ${bucket}`);
    return Promise.resolve();
  },
});

afterAll(() => {
  proxy.stop();
  void instance.stop(true);
});

const entry = `http://127.0.0.1:${port}`;

/** A request signed with `accessKeyId` for the entry's address, in its header. */
const signedFetch = (accessKeyId: string, path: string, init: RequestInit = {}) =>
  new AwsClient({ accessKeyId, secretAccessKey: "secret", service: "s3", region: "us-east-1" })
    .sign(`${entry}${path}`, init)
    .then((request) => fetch(request));

describe("Garage's S3 entry", () => {
  test("passes bucket requests on unchanged, Host included", async () => {
    for (const path of ["/photos/cat.jpg?versionId=1", "/photos/100%/a%2"]) {
      const response = await fetch(`${entry}${path}`);
      expect(await response.json(), path).toEqual({
        path,
        host: `127.0.0.1:${port}`,
        authorization: null,
      });
    }
  });

  test("drops Expect, which it has answered already, unless the client signed it", async () => {
    const plain = await fetch(`${entry}/photos/a.txt`, {
      method: "PUT",
      headers: { expect: "100-continue" },
      body: "a",
    });
    expect(await plain.json()).not.toHaveProperty("expect");
    const authorization =
      "AWS4-HMAC-SHA256 Credential=KEY/20261005/us-east-1/s3/aws4_request, SignedHeaders=expect;host, Signature=0";
    const signedExpect = await fetch(`${entry}/photos/a.txt`, {
      method: "PUT",
      headers: { expect: "100-continue", authorization },
      body: "a",
    });
    expect(await signedExpect.json()).toMatchObject({ expect: "100-continue" });
  });

  test("answers ACL requests for its own keys itself, and passes on the rest", async () => {
    reached.length = 0;
    const get = await signedFetch("PHOTOSKEY", "/photos/cat.jpg?acl");
    expect(get.status).toBe(200);
    const policy = await get.text();
    expect(policy).toContain("<Permission>FULL_CONTROL</Permission>");
    expect(policy).toContain("<ID>PHOTOSKEY</ID>");
    for (const path of ["/photos/cat.jpg?acl", "/photos?acl"]) {
      const put = await signedFetch("PHOTOSKEY", path, {
        method: "PUT",
        headers: { "x-amz-acl": "public-read" },
      });
      expect(put.status, path).toBe(200);
    }
    expect(reached).toEqual([]);

    await signedFetch("OTHERKEY", "/photos/cat.jpg?acl");
    await signedFetch("PHOTOSKEY", "/photos/cat.jpg?acl", { method: "DELETE" });
    expect(reached).toEqual(["GET /photos/cat.jpg?acl", "DELETE /photos/cat.jpg?acl"]);
  });

  test("tells the driver about a bucket one of its keys created", async () => {
    created.length = 0;
    await signedFetch("PHOTOSKEY", "/uploads", { method: "PUT" });
    await signedFetch("PHOTOSKEY", "/my.files/", { method: "PUT" });
    await signedFetch("PHOTOSKEY", "/photos?x-id=CreateBucket", { method: "PUT" });
    // Not a CreateBucket: an object, a bucket's settings, or a key evertap did not hand out.
    await signedFetch("PHOTOSKEY", "/uploads/a.txt", { method: "PUT", body: "a" });
    await signedFetch("PHOTOSKEY", "/uploads?cors", {
      method: "PUT",
      body: "<CORSConfiguration/>",
    });
    await signedFetch("OTHERKEY", "/elsewhere", { method: "PUT" });
    expect(created).toEqual(["PHOTOSKEY uploads", "PHOTOSKEY my.files", "PHOTOSKEY photos"]);
  });

  test("counts use by the key that signed, once per poll", async () => {
    proxy.takeConnected("photos-id");
    await signedFetch("PHOTOSKEY", "/photos/cat.jpg");
    expect(proxy.takeConnected("photos-id")).toBe(true);
    expect(proxy.takeConnected("photos-id")).toBe(false);
  });

  test("takes a request signed for ev.internal through the CLI's relay unchanged", async () => {
    const relay = createRelay({
      entry: () => ({ hostname: "127.0.0.1", port }),
      caller: () => Promise.resolve("a"),
      stillAllowed: () => Promise.resolve(true),
    });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      websocket: relay.websocket,
      fetch: async (request, bun) => (await relay.upgrade(request, bun)) ?? undefined,
    });
    const mirror = freePort();
    const running = startConnect({
      url: `http://127.0.0.1:${server.port}`,
      token: "x",
      hostname: "127.0.0.1",
      engines: ["garage"],
      ports: { garage: mirror },
      unavailable: () => {},
    });
    try {
      const url = new URL(`${bucketEndpoint("garage")}/photos/cat.jpg`);
      const signed = await new AwsClient({
        accessKeyId: "KEY",
        secretAccessKey: "secret",
        service: "s3",
        region: "us-east-1",
      }).sign(url.href);
      // What an app sends when ev.internal points at the CLI: the Host it signed.
      const request = [
        `GET ${url.pathname} HTTP/1.1`,
        `Host: ${url.host}`,
        ...[...signed.headers].map(([name, value]) => `${name}: ${value}`),
        "Connection: close",
        "",
        "",
      ].join("\r\n");
      const response = await new Promise<string>((resolve, reject) => {
        let received = "";
        void Bun.connect({
          hostname: "127.0.0.1",
          port: mirror,
          socket: {
            open: (socket) => {
              socket.write(request);
            },
            data: (_socket, chunk) => {
              received += new TextDecoder().decode(chunk);
            },
            close: () => {
              resolve(received);
            },
            error: (_socket, error) => {
              reject(error);
            },
          },
        });
      });
      expect(JSON.parse(response.slice(response.indexOf("\r\n\r\n") + 4))).toEqual({
        path: url.pathname,
        host: "ev.internal:3900",
        authorization: signed.headers.get("authorization"),
      });
    } finally {
      running.stop();
      void server.stop(true);
    }
  });
});

/** A link signed with `accessKeyId` for a proxy's address. */
const signed = (accessKeyId: string, path: string) =>
  new AwsClient({ accessKeyId, secretAccessKey: "secret", service: "s3", region: "us-east-1" })
    .sign(`https://s3.example.com${path}`, { aws: { signQuery: true } })
    .then((request) => new URL(request.url));

/** A presigned POST's form: its fields, then the file, which S3 takes last. */
const form = (credential: string, file: string) => {
  const body = new FormData();
  body.append("key", "form.txt");
  body.append("policy", "x".repeat(30_000));
  body.append("X-Amz-Credential", credential);
  body.append("x-amz-signature", "0");
  body.append("file", new Blob([file]));
  return body;
};

const CREDENTIAL = "20261005/us-east-1/s3/aws4_request";

/** A form written by hand, to send what a FormData would not. */
const rawForm = (parts: string[]) => ({
  method: "POST",
  headers: { "content-type": "multipart/form-data; boundary=evertap-test" },
  body: `${parts.map((part) => `--evertap-test\r\n${part}\r\n`).join("")}--evertap-test--\r\n`,
});

const field = (name: string, value: string) =>
  `Content-Disposition: form-data; name="${name}"\r\n\r\n${value}`;

const filePart = `Content-Disposition: form-data; name="file"; filename="a.txt"\r\n\r\nz`;

describe("the entry for buckets reached from anywhere", () => {
  const forwarded: { method: string; path: string; host: string | null; body: string }[] = [];
  const publicEntry = startPublicS3({
    reachable: (accessKeyId) => accessKeyId === "PHOTOSKEY",
    forward: async (request) => {
      const { pathname, search } = new URL(request.url);
      forwarded.push({
        method: request.method,
        path: pathname + search,
        host: request.headers.get("host"),
        body: await request.text(),
      });
      return new Response("ok");
    },
  });
  const at = { hostname: "127.0.0.1", port: freePort() };
  publicEntry.move(at);
  const url = `http://127.0.0.1:${at.port}`;

  afterAll(() => {
    publicEntry.stop();
  });

  test("passes on what a switched-on key signs, as it came", async () => {
    forwarded.length = 0;
    const link = await signed("PHOTOSKEY", "/uploads/cat.jpg");
    const get = await fetch(`${url}${link.pathname}${link.search}`, {
      headers: { host: "s3.example.com" },
    });
    expect(get.status).toBe(200);
    const header = await fetch(`${url}/`, {
      headers: {
        authorization:
          "AWS4-HMAC-SHA256 Credential=PHOTOSKEY/20261005/us-east-1/s3/aws4_request, SignedHeaders=host, Signature=0",
      },
    });
    expect(header.status).toBe(200);
    // A CORS preflight carries no key, and the engine answers it from the bucket's rules.
    await fetch(`${url}/backups/a.txt`, {
      method: "OPTIONS",
      headers: { origin: "https://app.example.com", "access-control-request-method": "PUT" },
    });
    expect(forwarded).toEqual([
      {
        method: "GET",
        path: `/uploads/cat.jpg${link.search}`,
        host: "s3.example.com",
        body: "",
      },
      { method: "GET", path: "/", host: `127.0.0.1:${at.port}`, body: "" },
      { method: "OPTIONS", path: "/backups/a.txt", host: `127.0.0.1:${at.port}`, body: "" },
    ]);
  });

  test("reads a form upload's key from its fields, and passes the whole form on", async () => {
    forwarded.length = 0;
    const file = "y".repeat(256 * 1024);
    const response = await fetch(`${url}/uploads`, {
      method: "POST",
      body: form("PHOTOSKEY/20261005/us-east-1/s3/aws4_request", file),
    });
    expect(response.status).toBe(200);
    expect(forwarded).toHaveLength(1);
    const passed = forwarded[0]?.body ?? "";
    expect(passed).toContain("PHOTOSKEY/20261005/us-east-1/s3/aws4_request");
    expect(passed).toContain(`\r\n\r\n${file}\r\n`);
    expect(passed.endsWith("--\r\n")).toBe(true);
  });

  test("refuses any other key, a form signed by one, and a request with none", async () => {
    forwarded.length = 0;
    const other = await signed("BACKUPSKEY", "/uploads/a.txt");
    for (const path of ["/uploads/a.txt", "/", `${other.pathname}${other.search}`]) {
      const response = await fetch(`${url}${path}`);
      expect(response.status, path).toBe(403);
      expect(await response.text(), path).toContain("<Code>AccessDenied</Code>");
    }
    for (const credential of ["BACKUPSKEY/20261005/us-east-1/s3/aws4_request", "nothing"]) {
      const response = await fetch(`${url}/uploads`, {
        method: "POST",
        body: form(credential, "z"),
      });
      expect(response.status, credential).toBe(403);
    }
    expect((await fetch(`${url}/uploads`, { method: "POST" })).status).toBe(403);
    expect(forwarded).toEqual([]);
  });

  test("reads the key where Garage reads it, so a request cannot name one key to each", async () => {
    forwarded.length = 0;
    const other = await signed("BACKUPSKEY", "/uploads/a.txt");
    const otherQuery = `${other.pathname}${other.search}`;
    const claim = `AWS4-HMAC-SHA256 Credential=PHOTOSKEY/${CREDENTIAL}, SignedHeaders=host, Signature=0`;
    const refused: [string, RequestInit][] = [
      // Garage reads a presigned query before any header, and its names in any case.
      [otherQuery, { headers: { authorization: claim } }],
      [otherQuery.replaceAll("X-Amz-", "x-amz-"), { headers: { authorization: claim } }],
      [
        `${otherQuery}&x-amz-credential=PHOTOSKEY%2F${encodeURIComponent(CREDENTIAL)}`,
        { headers: { authorization: claim } },
      ],
      // Garage keeps the last Credential of a header.
      ...[
        `AWS4-HMAC-SHA256 Credential=PHOTOSKEY/${CREDENTIAL}, Credential=BACKUPSKEY/${CREDENTIAL}, SignedHeaders=host, Signature=0`,
        `AWS4-HMAC-SHA256 Credential=BACKUPSKEY/${CREDENTIAL}, Credential=PHOTOSKEY/${CREDENTIAL}, SignedHeaders=host, Signature=0`,
        `AWS4-HMAC-SHA256 XCredential=PHOTOSKEY/${CREDENTIAL}, Credential=BACKUPSKEY/${CREDENTIAL}, SignedHeaders=host, Signature=0`,
      ].map((authorization): [string, RequestInit] => [
        "/uploads/a.txt",
        { headers: { authorization } },
      ]),
      // A form is read by its parts: a key inside another field's value, a field given twice, one
      // after the file, or a file past what is read are not the form's key.
      [
        "/uploads",
        rawForm([
          field(
            "x-ignore-note",
            `x\r\nContent-Disposition: form-data; name="x-amz-credential"\r\n\r\nPHOTOSKEY/${CREDENTIAL}`,
          ),
          field("X-Amz-Credential", `BACKUPSKEY/${CREDENTIAL}`),
          filePart,
        ]),
      ],
      [
        "/uploads",
        rawForm([
          field("x-amz-credential", `PHOTOSKEY/${CREDENTIAL}`),
          field("X-Amz-Credential", `BACKUPSKEY/${CREDENTIAL}`),
          filePart,
        ]),
      ],
      [
        "/uploads",
        rawForm([
          field("key", "a.txt"),
          filePart,
          field("x-amz-credential", `PHOTOSKEY/${CREDENTIAL}`),
        ]),
      ],
      // Nor is a form Garage could read otherwise: a field in another charset, text before the
      // first part, or a boundary written with quoting.
      [
        "/uploads",
        rawForm([
          `Content-Type: text/plain; charset=utf-16le\r\n${field("x-amz-credential", `PHOTOSKEY/${CREDENTIAL}`)}`,
          filePart,
        ]),
      ],
      [
        "/uploads",
        {
          ...rawForm([]),
          body: `preamble\r\n${rawForm([field("x-amz-credential", `PHOTOSKEY/${CREDENTIAL}`), filePart]).body}`,
        },
      ],
      [
        "/uploads",
        {
          ...rawForm([field("x-amz-credential", `PHOTOSKEY/${CREDENTIAL}`), filePart]),
          headers: { "content-type": 'multipart/form-data; boundary="evertap\\-test"' },
        },
      ],
      [
        "/uploads",
        rawForm([
          field("x-ignore-pad", "p".repeat(70_000)),
          field("x-amz-credential", `PHOTOSKEY/${CREDENTIAL}`),
          filePart,
        ]),
      ],
      // Garage takes a POST to a bucket as a form whatever the header or the query says.
      [
        "/uploads?foo=1",
        {
          ...rawForm([field("x-amz-credential", `BACKUPSKEY/${CREDENTIAL}`), filePart]),
          headers: {
            authorization: claim,
            "content-type": "multipart/form-data; boundary=evertap-test",
          },
        },
      ],
    ];
    for (const [path, init] of refused) {
      const response = await fetch(`${url}${path}`, init);
      expect(response.status, `${path} ${JSON.stringify(init.headers)}`).toBe(403);
    }
    expect(forwarded).toEqual([]);

    const own = await signed("PHOTOSKEY", "/uploads/a.txt");
    const passed: [string, RequestInit][] = [
      [`${own.pathname}${own.search}`.replaceAll("X-Amz-", "x-amz-"), {}],
      ["/uploads", rawForm([field("X-Amz-Credential", `PHOTOSKEY/${CREDENTIAL}`), filePart])],
      [
        "/uploads",
        {
          ...rawForm([field("x-amz-credential", `PHOTOSKEY/${CREDENTIAL}`), filePart]),
          headers: {
            authorization: `AWS4-HMAC-SHA256 Credential=BACKUPSKEY/${CREDENTIAL}, SignedHeaders=host, Signature=0`,
            "content-type": "multipart/form-data; boundary=evertap-test",
          },
        },
      ],
      ["/uploads?delete", { method: "POST", headers: { authorization: claim } }],
    ];
    for (const [path, init] of passed) {
      const response = await fetch(`${url}${path}`, init);
      expect(response.status, path).toBe(200);
    }
    expect(forwarded.map((request) => request.method)).toEqual(["GET", "POST", "POST", "POST"]);
  });

  test("tells a CDN to keep none of its answers, refusals included", async () => {
    const link = await signed("PHOTOSKEY", "/uploads/cat.jpg");
    for (const path of [`${link.pathname}${link.search}`, "/uploads/a.txt"]) {
      const response = await fetch(`${url}${path}`);
      expect(response.headers.get("cloudflare-cdn-cache-control"), path).toBe("no-store");
    }
  });

  test("stops listening while nothing leads there, and listens again", async () => {
    const link = await signed("PHOTOSKEY", "/uploads/cat.jpg");
    const path = `${url}${link.pathname}${link.search}`;
    publicEntry.move(null);
    const closed = await fetch(path).then(
      () => "answered",
      () => "refused",
    );
    expect(closed).toBe("refused");
    publicEntry.move(at);
    expect((await fetch(path)).status).toBe(200);
  });
});
