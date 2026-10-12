import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { Readable } from "node:stream";

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  GetObjectAclCommand,
  GetObjectCommand,
  ListBucketsCommand,
  PutObjectAclCommand,
  PutObjectCommand,
  S3Client as AwsS3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { formatConnection } from "@evertap/api/connections";
import { DataError } from "@evertap/api/context";
import { STORAGE_REGION } from "@evertap/api/rules";
import { OBJECT_PAGE_SIZE, type ObjectStorage } from "@evertap/api/schemas";
import { AwsClient } from "aws4fetch";
import { S3Client } from "bun";
import { z } from "zod";

import type { DriverContext, StorageDriver } from "./driver.ts";
import { createGarageDriver } from "./garage.ts";
import { startPublicS3 } from "./s3-proxy.ts";
import { containerId, createTestContext, freePort, laterRelease } from "./testing.ts";

const PORT = 19200;
const endpoint = `http://127.0.0.1:${PORT}`;
const region = STORAGE_REGION;

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
};

/** The S3 error code an AWS SDK call failed with. */
const sdkError = async (promise: Promise<unknown>) => {
  const error = await failure(promise);
  return error instanceof S3ServiceException ? error.name : error;
};

/** S3's smallest part apart from the last. */
const PART = 5 * 1024 * 1024;

const text = (value: string) => new TextEncoder().encode(value);

const hmac = (key: string | Buffer, data: string) =>
  createHmac("sha256", key).update(data).digest();

/** What the resource's owner would use: the entry, with the key handed out. */
const ownerClient = (resource: ObjectStorage, bucket = resource.name) =>
  new S3Client({
    endpoint: resource.endpoint,
    region: resource.region,
    bucket,
    accessKeyId: resource.accessKeyId,
    secretAccessKey: resource.secretAccessKey,
  });

/** The AWS SDK as an app sets it up, with only path-style addressing chosen in code. */
const sdkClient = (resource: ObjectStorage) =>
  new AwsS3Client({
    endpoint: resource.endpoint,
    region: resource.region,
    credentials: { accessKeyId: resource.accessKeyId, secretAccessKey: resource.secretAccessKey },
    forcePathStyle: true,
  });

/** The names ListBuckets answers the resource's key with, in any order. */
const bucketNames = async (resource: ObjectStorage) =>
  ((await sdkClient(resource).send(new ListBucketsCommand({}))).Buckets ?? [])
    .map((bucket) => bucket.Name ?? "")
    .toSorted();

let context: DriverContext;
let cleanup: () => Promise<void>;
let driver: StorageDriver;
let a: ObjectStorage;
let b: ObjectStorage;

/** As the object browser does it: the file in one call, or in parts past one part. */
const upload = async (
  target: ObjectStorage,
  key: string,
  body: Uint8Array<ArrayBuffer>,
  type = "",
) => {
  if (body.length <= PART) {
    await driver.putObject(target, { key, type, body: new Blob([body]) });
    return;
  }
  const { uploadId } = await driver.startUpload(target, { key, type });
  const parts = [];
  for (let start = 0, partNumber = 1; start < body.length; partNumber++) {
    const part = new Blob([body.slice(start, start + PART)]);
    const { etag } = await driver.uploadPart(target, { key, uploadId, partNumber, body: part });
    parts.push({ partNumber, etag });
    start += PART;
  }
  await driver.completeUpload(target, { key, uploadId, parts });
};

const resource = async (id: string, name: string): Promise<ObjectStorage> => ({
  id,
  kind: "object-storage",
  engine: "garage",
  name,
  description: "",
  // Not `ev.internal` through the CLI's relay: the tests reach the entry itself.
  endpoint,
  region,
  ...(await driver.provision({ id, name })),
  reachableAnywhere: false,
  publicEndpoint: null,
  protected: false,
  expiresAt: null,
  sizeBytes: 0,
  lastConnectedAt: null,
  createdAt: new Date().toISOString(),
});

/** Every bucket on the node, as the admin API lists them. */
const allBuckets = async () => {
  const published = (await context.docker.inspect(`${context.prefix}-garage`))?.ports;
  const response = await fetch(`http://127.0.0.1:${published?.["3903/tcp"]}/v2/ListBuckets`, {
    headers: { authorization: `Bearer ${context.metadata.secret("garage-admin")}` },
  });
  return z.array(z.object({ id: z.string() })).parse(await response.json());
};

beforeAll(async () => {
  const test = await createTestContext("garage", PORT);
  context = test.context;
  cleanup = test.cleanup;
  driver = createGarageDriver(context);
  await driver.start([]);
  a = await resource("aaaa", "photos");
  b = await resource("bbbb", "backups");
});

afterAll(async () => {
  await driver?.close();
  await cleanup?.();
});

describe("entry", () => {
  it("hands out a key per resource, for us-east-1", () => {
    expect(a.region).toBe("us-east-1");
    expect(a.accessKeyId).not.toBe(b.accessKeyId);
  });

  it("lets a key read and write its own bucket and nothing else", async () => {
    const owner = ownerClient(a);
    await owner.write("hello.txt", "hi");
    expect(await owner.file("hello.txt").text()).toBe("hi");
    const intruder = new S3Client({
      endpoint,
      region,
      bucket: b.name,
      accessKeyId: a.accessKeyId,
      secretAccessKey: a.secretAccessKey,
    });
    expect(await failure(intruder.write("x.txt", "x"))).toBeInstanceOf(Error);
    expect(await failure(intruder.list())).toBeInstanceOf(Error);
    await owner.delete("hello.txt");
  });

  it("refuses a request signed for another region", async () => {
    const response = await new AwsClient({
      accessKeyId: a.accessKeyId,
      secretAccessKey: a.secretAccessKey,
      service: "s3",
      region: "eu-west-1",
    }).fetch(`${endpoint}/${a.name}`);
    expect(response.status).toBe(400);
  });

  it("counts use through the entry, once per poll", async () => {
    await ownerClient(b).write("seen.txt", "1");
    const first = await driver.usage([a, b]);
    expect(first.get(b.id)?.connected).toBe(true);
    const second = await driver.usage([a, b]);
    expect(second.get(b.id)?.connected).toBe(false);
    await ownerClient(b).delete("seen.txt");
  });

  it("leaves use alone when evertap reads and writes objects itself", async () => {
    await driver.usage([b]);
    await upload(b, "quiet.txt", text("q"));
    await new Response((await driver.readObject(b, "quiet.txt"))?.body).text();
    await driver.deleteObject(b, "quiet.txt");
    expect(await driver.listBuckets(b)).toEqual([b.name]);
    expect((await driver.usage([b])).get(b.id)?.connected).toBe(false);
  });

  it("answers browsers from any origin", async () => {
    const response = await fetch(`${endpoint}/${a.name}/x.txt`, {
      method: "OPTIONS",
      headers: { Origin: "http://app.test", "Access-Control-Request-Method": "PUT" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers ACL requests, as libraries send them on copies and writes", async () => {
    const sdk = sdkClient(a);
    await sdk.send(
      new PutObjectCommand({ Bucket: a.name, Key: "acl.txt", Body: "a", ACL: "private" }),
    );
    await sdk.send(new PutObjectAclCommand({ Bucket: a.name, Key: "acl.txt", ACL: "public-read" }));
    const acl = await sdk.send(new GetObjectAclCommand({ Bucket: a.name, Key: "acl.txt" }));
    expect(acl.Grants?.map((grant) => grant.Permission)).toEqual(["FULL_CONTROL"]);
    await ownerClient(a).delete("acl.txt");
  });
});

describe("buckets an app creates", () => {
  it("lets each resource's key create the same name, apart from the other's", async () => {
    await sdkClient(a).send(new CreateBucketCommand({ Bucket: "uploads" }));
    await sdkClient(b).send(new CreateBucketCommand({ Bucket: "uploads" }));
    await ownerClient(a, "uploads").write("whose.txt", "a");
    await ownerClient(b, "uploads").write("whose.txt", "b");
    expect(await ownerClient(a, "uploads").file("whose.txt").text()).toBe("a");
    expect(await ownerClient(b, "uploads").file("whose.txt").text()).toBe("b");

    expect(await bucketNames(a)).toEqual(["photos", "uploads"]);
    expect(await bucketNames(b)).toEqual(["backups", "uploads"]);
    expect(await driver.listBuckets(a)).toEqual(["photos", "uploads"]);
  });

  it("says the first bucket is already the key's own, and keeps the key from deleting it", async () => {
    const sdk = sdkClient(a);
    expect(await sdkError(sdk.send(new CreateBucketCommand({ Bucket: a.name })))).toBe(
      "BucketAlreadyOwnedByYou",
    );
    expect(await sdkError(sdk.send(new DeleteBucketCommand({ Bucket: a.name })))).toBe(
      "AccessDenied",
    );
  });

  it("allows browsers from any origin, as the first bucket does", async () => {
    const preflight = await fetch(`${endpoint}/uploads/x.txt`, {
      method: "OPTIONS",
      headers: { Origin: "http://app.test", "Access-Control-Request-Method": "PUT" },
    });
    expect(preflight.status).toBe(200);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    const signer = new AwsClient({
      accessKeyId: a.accessKeyId,
      secretAccessKey: a.secretAccessKey,
      service: "s3",
      region,
    });
    const get = await signer.fetch(`${endpoint}/uploads/whose.txt`, {
      headers: { Origin: "http://app.test" },
    });
    expect(await get.text()).toBe("a");
    expect(get.headers.get("access-control-allow-origin")).toBe("*");
    expect(get.headers.get("access-control-expose-headers")).toContain("ETag");
  });

  it("are browsed with the resource's key", async () => {
    const other = { ...a, name: "uploads" };
    expect((await driver.listObjects(other, { id: a.id, prefix: "" })).objects).toEqual([
      expect.objectContaining({ key: "whose.txt", sizeBytes: 1 }),
    ]);
  });
});

describe("the AWS SDK with the .env lines", () => {
  const saved = new Map<string, string | undefined>();
  let sdk: AwsS3Client;

  beforeAll(() => {
    for (const line of formatConnection(b, "env").split("\n")) {
      const [name = "", ...value] = line.split("=");
      saved.set(name, process.env[name]);
      process.env[name] = value.join("=");
    }
    // Nothing else in code: the endpoint, region, key, and checksums come from the environment.
    sdk = new AwsS3Client({ forcePathStyle: true });
  });

  afterAll(() => {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it("uploads to a presigned PUT link", async () => {
    const url = await getSignedUrl(sdk, new PutObjectCommand({ Bucket: b.name, Key: "link.txt" }), {
      expiresIn: 300,
    });
    const put = await fetch(url, { method: "PUT", body: "through a link" });
    expect(put.status, await put.text()).toBe(200);
    expect(await ownerClient(b).file("link.txt").text()).toBe("through a link");
  });

  it("uploads a stream and in parts, and reads them back", async () => {
    await sdk.send(
      new PutObjectCommand({
        Bucket: b.name,
        Key: "stream.txt",
        Body: Readable.from([text("a stream"), text(" of parts")]),
        ContentLength: 17,
      }),
    );
    expect(await ownerClient(b).file("stream.txt").text()).toBe("a stream of parts");

    const big = new Uint8Array(PART * 2 + 123).map((_, index) => index % 251);
    await new Upload({ client: sdk, params: { Bucket: b.name, Key: "big.bin", Body: big } }).done();
    const got = await sdk.send(new GetObjectCommand({ Bucket: b.name, Key: "big.bin" }));
    const stored = await got.Body?.transformToByteArray();
    expect(stored?.length).toBe(big.length);
    expect(Bun.hash(stored ?? new Uint8Array())).toBe(Bun.hash(big));
    for (const key of ["link.txt", "stream.txt", "big.bin"]) {
      await ownerClient(b).delete(key);
    }
  });
});

describe("reached from anywhere", () => {
  const publicEntry = startPublicS3({
    reachable: (accessKeyId) => accessKeyId === a.accessKeyId,
    forward: (request) => driver.forward(request),
  });
  const at = { hostname: "127.0.0.1", port: freePort() };
  const entry = `http://127.0.0.1:${at.port}`;
  /** How a link signed for the proxy's address arrives, through the proxy; or at `to`. */
  const viaProxy = (link: string, init: RequestInit = {}, to?: string) => {
    const url = new URL(link);
    const headers = new Headers(init.headers);
    headers.set("host", url.host);
    return fetch(`${to ?? entry}${url.pathname}${url.search}`, { ...init, headers });
  };
  const signedLink = (target: ObjectStorage, path: string, method: string) =>
    new AwsClient({
      accessKeyId: target.accessKeyId,
      secretAccessKey: target.secretAccessKey,
      service: "s3",
      region,
    })
      .sign(`https://s3.example.com/${path}?X-Amz-Expires=300`, {
        method,
        aws: { signQuery: true },
      })
      .then((request) => request.url);
  /** A form upload to `bucket`, signed with the target's key by a policy, after `extra` fields. */
  const formUpload = (
    target: ObjectStorage,
    bucket: string,
    key: string,
    extra: Record<string, string> = {},
    to = entry,
  ) => {
    const now = new Date();
    const amzDate = now
      .toISOString()
      .replaceAll(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
    const day = amzDate.slice(0, 8);
    const credential = `${target.accessKeyId}/${day}/${region}/s3/aws4_request`;
    const policy = Buffer.from(
      JSON.stringify({
        expiration: new Date(now.getTime() + 300_000).toISOString(),
        conditions: [
          { bucket },
          { key },
          { "x-amz-algorithm": "AWS4-HMAC-SHA256" },
          { "x-amz-credential": credential },
          { "x-amz-date": amzDate },
        ],
      }),
    ).toString("base64");
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${target.secretAccessKey}`, day), region), "s3"),
      "aws4_request",
    );
    const form = new FormData();
    for (const [name, value] of Object.entries({
      ...extra,
      key,
      "x-amz-algorithm": "AWS4-HMAC-SHA256",
      "x-amz-credential": credential,
      "x-amz-date": amzDate,
      policy,
      "x-amz-signature": createHmac("sha256", signingKey).update(policy).digest("hex"),
    })) {
      form.append(name, value);
    }
    form.append("file", new Blob(["sent by a form"]));
    return viaProxy(`https://s3.example.com/${bucket}`, { method: "POST", body: form }, to);
  };

  beforeAll(() => {
    publicEntry.move(at);
  });

  afterAll(() => {
    publicEntry.stop();
  });

  it("takes links signed for its own address, for each of the key's buckets", async () => {
    await driver.usage([a]);
    for (const bucket of [a.name, "uploads"]) {
      const put = await viaProxy(await signedLink(a, `${bucket}/anywhere.txt`, "PUT"), {
        method: "PUT",
        body: "from a phone",
      });
      expect(put.status).toBe(200);
      expect(put.headers.get("cloudflare-cdn-cache-control")).toBe("no-store");
      const get = await viaProxy(await signedLink(a, `${bucket}/anywhere.txt`, "GET"));
      expect(await get.text()).toBe("from a phone");
      expect(get.headers.get("cloudflare-cdn-cache-control")).toBe("no-store");
      await ownerClient(a, bucket).delete("anywhere.txt");
    }
    expect((await driver.usage([a])).get(a.id)?.connected).toBe(true);
  });

  it("refuses a key that is not switched on, even for a bucket name the other has", async () => {
    await ownerClient(b, "uploads").write("private.txt", "no");
    for (const path of [`${b.name}/private.txt`, "uploads/private.txt"]) {
      const get = await viaProxy(await signedLink(b, path, "GET"));
      expect(get.status, path).toBe(403);
      expect(get.headers.get("cloudflare-cdn-cache-control")).toBe("no-store");
    }
    await ownerClient(b, "uploads").delete("private.txt");
  });

  it("refuses a switched-off key's own signature, whatever else the request names", async () => {
    await ownerClient(b).write("secret.txt", "b's");
    const scope = `${new Date().toISOString().slice(0, 10).replaceAll("-", "")}/${region}/s3/aws4_request`;
    const claim = `AWS4-HMAC-SHA256 Credential=${a.accessKeyId}/${scope}, SignedHeaders=host, Signature=0`;
    // A header naming the switched-on key, on a link the other signed: Garage reads the link.
    const link = await signedLink(b, `${b.name}/secret.txt`, "GET");
    // The other's signed header with the switched-on key's Credential first: Garage keeps the last.
    const signed = await new AwsClient({
      accessKeyId: b.accessKeyId,
      secretAccessKey: b.secretAccessKey,
      service: "s3",
      region,
    }).sign(`https://s3.example.com/${b.name}/secret.txt`);
    const twoKeys = new Headers(signed.headers);
    twoKeys.set(
      "authorization",
      (signed.headers.get("authorization") ?? "").replace(
        "AWS4-HMAC-SHA256 ",
        `AWS4-HMAC-SHA256 Credential=${a.accessKeyId}/${scope}, `,
      ),
    );
    const attempts: [string, RequestInit][] = [
      [link, { headers: { authorization: claim } }],
      [signed.url, { headers: twoKeys }],
    ];
    // The other's form, with the switched-on key in a field Garage ignores.
    const decoy = {
      "x-ignore-note": `x\r\nContent-Disposition: form-data; name="x-amz-credential"\r\n\r\n${a.accessKeyId}/${scope}`,
    };
    const statuses = [];
    for (const [url, init] of attempts) {
      statuses.push((await viaProxy(url, init)).status);
      // Garage itself takes the other's signature, so only the entry stands in the way.
      expect(await (await viaProxy(url, init, endpoint)).text(), url).toBe("b's");
    }
    statuses.push((await formUpload(b, b.name, "form.txt", decoy)).status);
    expect(statuses).toEqual([403, 403, 403]);
    expect(await ownerClient(b).exists("form.txt")).toBe(false);
    const direct = await formUpload(b, b.name, "form.txt", decoy, endpoint);
    expect(direct.status, await direct.text()).toBeLessThan(300);
    await ownerClient(b).delete("form.txt");
    await ownerClient(b).delete("secret.txt");
  });

  it("answers a browser's preflight", async () => {
    const response = await fetch(`${entry}/${a.name}/x.txt`, {
      method: "OPTIONS",
      headers: { Origin: "https://app.example.com", "Access-Control-Request-Method": "PUT" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("takes a form upload signed by a switched-on key, and refuses one signed by another", async () => {
    const response = await formUpload(a, "uploads", "form.txt");
    expect(response.status, await response.text()).toBeLessThan(300);
    expect(await ownerClient(a, "uploads").file("form.txt").text()).toBe("sent by a form");
    await ownerClient(a, "uploads").delete("form.txt");

    const refused = await formUpload(b, "uploads", "form.txt");
    expect(refused.status).toBe(403);
    expect(await ownerClient(b, "uploads").exists("form.txt")).toBe(false);
  });
});

describe("objects", () => {
  it("lists folders and objects one level at a time", async () => {
    await upload(a, "docs/readme.md", text("# hi"), "text/markdown");
    await upload(a, "docs/deep/note.txt", text("n"), "text/plain");
    await upload(a, "top.txt", text("t"));

    const top = await driver.listObjects(a, { id: a.id, prefix: "" });
    expect(top.folders).toEqual(["docs/"]);
    expect(top.objects.map((item) => item.key)).toEqual(["top.txt"]);
    expect(top.cursor).toBeNull();

    const docs = await driver.listObjects(a, { id: a.id, prefix: "docs/" });
    expect(docs.folders).toEqual(["docs/deep/"]);
    expect(docs.objects).toEqual([
      {
        key: "docs/readme.md",
        sizeBytes: 4,
        lastModified: expect.any(String),
        contentType: "text/markdown",
      },
    ]);
    expect((await ownerClient(a).file("docs/readme.md").stat()).type).toBe("text/markdown");
  });

  it("uploads a file in parts, an empty file, and a name that needs escaping", async () => {
    const big = new Uint8Array(PART * 2 + 123).map((_, index) => index % 251);
    await upload(a, "parts/big.bin", big, "application/x-evertap-test");
    expect((await ownerClient(a).file("parts/big.bin").stat()).type).toBe(
      "application/x-evertap-test",
    );
    const stored = new Uint8Array(await ownerClient(a).file("parts/big.bin").arrayBuffer());
    expect(stored.length).toBe(big.length);
    expect(Bun.hash(stored)).toBe(Bun.hash(big));

    await upload(a, "parts/empty.txt", new Uint8Array(0));
    expect((await ownerClient(a).file("parts/empty.txt").stat()).size).toBe(0);

    await upload(a, "parts/写真 #1 & more.txt", text("jp"));
    expect(await ownerClient(a).file("parts/写真 #1 & more.txt").text()).toBe("jp");

    const listed = await driver.listObjects(a, { id: a.id, prefix: "parts/" });
    expect(listed.objects.map((item) => item.key).toSorted()).toEqual(
      ["parts/big.bin", "parts/empty.txt", "parts/写真 #1 & more.txt"].toSorted(),
    );
    for (const item of listed.objects) {
      await driver.deleteObject(a, item.key);
    }
  });

  it("abandons an upload and says so when it is completed after all", async () => {
    const { uploadId } = await driver.startUpload(a, { key: "gone.bin", type: "" });
    const part = { key: "gone.bin", uploadId, partNumber: 1, body: new Blob(["x"]) };
    const { etag } = await driver.uploadPart(a, part);
    await driver.abortUpload(a, { key: "gone.bin", uploadId });
    await driver.abortUpload(a, { key: "gone.bin", uploadId });
    expect(await failure(driver.uploadPart(a, part))).toBeInstanceOf(DataError);
    const error = await failure(
      driver.completeUpload(a, {
        key: "gone.bin",
        uploadId,
        parts: [{ partNumber: 1, etag }],
      }),
    );
    expect(error).toBeInstanceOf(DataError);
    expect(await ownerClient(a).exists("gone.bin")).toBe(false);
  });

  it("pages through a long folder", async () => {
    const keys = Array.from(
      { length: OBJECT_PAGE_SIZE + 5 },
      (_, index) => `many/${String(index).padStart(3, "0")}`,
    );
    const owner = ownerClient(a);
    for (let index = 0; index < keys.length; index += 50) {
      await Promise.all(keys.slice(index, index + 50).map((key) => owner.write(key, "")));
    }
    const first = await driver.listObjects(a, { id: a.id, prefix: "many/" });
    expect(first.objects).toHaveLength(OBJECT_PAGE_SIZE);
    expect(first.cursor).not.toBeNull();
    const second = await driver.listObjects(a, {
      id: a.id,
      prefix: "many/",
      cursor: first.cursor ?? undefined,
    });
    expect(second.objects.map((item) => item.key)).toEqual(keys.slice(OBJECT_PAGE_SIZE));
    expect(second.cursor).toBeNull();
  });

  it("reads an object back, and a missing one as nothing", async () => {
    const object = await driver.readObject(a, "docs/readme.md");
    expect(object?.contentType).toBe("text/markdown");
    expect(await new Response(object?.body).text()).toBe("# hi");
    expect(await driver.readObject(a, "docs/never-was.md")).toBeNull();
  });

  it("deletes an object, and a missing one quietly", async () => {
    await driver.deleteObject(a, "top.txt");
    await driver.deleteObject(a, "never-was.txt");
    const top = await driver.listObjects(a, { id: a.id, prefix: "" });
    expect(top.objects).toEqual([]);
  });

  it("reports the size of every bucket the key reaches", async () => {
    // `docs/` holds 5 bytes, and `uploads` 1. Garage updates its counters in the background.
    let size = 0;
    for (let attempt = 0; attempt < 40 && size !== 6; attempt++) {
      size = (await driver.usage([a])).get(a.id)?.sizeBytes ?? 0;
      await Bun.sleep(250);
    }
    expect(size).toBe(6);
  });
});

describe("lifecycle", () => {
  it("keeps serving after a restart of evertap", async () => {
    await driver.close();
    driver = createGarageDriver(context);
    await driver.start([a, b]);
    expect(await ownerClient(a).file("docs/readme.md").text()).toBe("# hi");
    expect((await driver.usage([a])).get(a.id)?.connected).toBe(true);
  });

  it("keeps buckets and keys when a later release replaces the instance", async () => {
    const name = `${context.prefix}-garage`;
    const before = await containerId(name);
    await driver.close();
    driver = createGarageDriver(laterRelease(context));
    await driver.start([a, b]);
    expect(await containerId(name)).not.toBe(before);
    expect(await ownerClient(a).file("docs/readme.md").text()).toBe("# hi");
    await ownerClient(b).write("after.txt", "ok");
    expect(await ownerClient(b).file("after.txt").text()).toBe("ok");
    expect(await ownerClient(b, "uploads").file("whose.txt").text()).toBe("b");
  });

  it("drops every bucket of a resource with its objects, then its key, and can drop it again", async () => {
    const before = (await allBuckets()).length;
    await driver.drop(a);
    await driver.drop(a);
    expect((await allBuckets()).length).toBe(before - 2);
    expect(await failure(ownerClient(a).list())).toBeInstanceOf(Error);
    // The name is free again.
    a = await resource("cccc", "photos");
    expect((await driver.listObjects(a, { id: a.id, prefix: "" })).objects).toEqual([]);
    expect(await driver.listBuckets(a)).toEqual(["photos"]);
    await ownerClient(b).write("still.txt", "here");
    expect(await ownerClient(b).file("still.txt").text()).toBe("here");
    expect(await ownerClient(b, "uploads").file("whose.txt").text()).toBe("b");
  });
});
