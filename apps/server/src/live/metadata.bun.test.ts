import { Database as Sqlite } from "bun:sqlite";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Database, ObjectStorage } from "@evertap/api/schemas";

import { openMetadata } from "./metadata.ts";

const LATEST = 4;

const postgres: Database = {
  id: "d1",
  kind: "database",
  engine: "postgresql",
  version: "18",
  name: "app",
  description: "",
  connectionUrl: "postgres://app:pw@evertap.local:15432/app",
  extensions: [],
  protected: false,
  expiresAt: null,
  sizeBytes: 0,
  lastConnectedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const redis: Database = {
  ...postgres,
  id: "d2",
  engine: "redis",
  version: "8",
  name: "cache",
  connectionUrl: "redis://default:pw@evertap.local:16379",
};

const bucket: ObjectStorage = {
  id: "b1",
  kind: "object-storage",
  engine: "garage",
  name: "uploads",
  description: "",
  endpoint: "http://evertap.local:3900",
  region: "us-east-1",
  accessKeyId: "key",
  secretAccessKey: "secret",
  reachableAnywhere: true,
  publicEndpoint: "https://s3.example.com",
  protected: false,
  expiresAt: null,
  sizeBytes: 0,
  lastConnectedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const {
  endpoint: _endpoint,
  publicEndpoint: _publicEndpoint,
  region: _region,
  ...storedBucket
} = bucket;

/** As stored before buckets could be reached from anywhere. */
const { reachableAnywhere: _reachableAnywhere, ...olderBucket } = storedBucket;

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "evertap-metadata-"));
  path = join(dir, "evertap.db");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A file as evertap wrote it before the file had a version. */
const writeUnversioned = (rows: { id: string }[]) => {
  const db = new Sqlite(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("CREATE TABLE resources (id TEXT PRIMARY KEY, data TEXT NOT NULL)");
  db.run("CREATE TABLE secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.run(
    "CREATE TABLE clients (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, data TEXT NOT NULL)",
  );
  db.run(
    "CREATE TABLE requests (code TEXT PRIMARY KEY, request_hash TEXT NOT NULL UNIQUE, data TEXT NOT NULL)",
  );
  for (const row of rows) {
    db.run("INSERT INTO resources (id, data) VALUES (?, ?)", [row.id, JSON.stringify(row)]);
  }
  db.close();
};

const versionOf = (file: string) => {
  const db = new Sqlite(file, { strict: true });
  const row = db.query<{ user_version: number }, []>("PRAGMA user_version").get();
  db.close();
  return row?.user_version;
};

const storedRow = (file: string, id: string) => {
  const db = new Sqlite(file, { strict: true });
  const row = db
    .query<{ data: string }, [string]>("SELECT data FROM resources WHERE id = ?")
    .get(id);
  db.close();
  return row ? JSON.parse(row.data) : null;
};

const backups = async () =>
  (await readdir(dir)).filter((name) => name.endsWith(".bak")).map((name) => join(dir, name));

test("a new file gets every table at the latest version, without a copy", async () => {
  const metadata = openMetadata(path);
  expect(metadata.listResources()).toEqual([]);
  expect(metadata.clientTables.listClients()).toEqual([]);
  expect(metadata.clientTables.listRequests()).toEqual([]);
  expect(metadata.secret("root")).toBe(metadata.secret("root"));
  expect(metadata.settings()).toBeNull();
  metadata.close();

  expect(versionOf(path)).toBe(LATEST);
  expect(await backups()).toEqual([]);
});

test("keeps the access settings across starts, and drops a row it cannot read", () => {
  const first = openMetadata(path);
  first.putSettings({ mode: "network", publicUrl: null, listenHost: "0.0.0.0", storageUrl: null });
  const proxied = {
    mode: "network",
    publicUrl: "https://evertap.example.com",
    listenHost: "127.0.0.1",
  } as const;
  first.putSettings({ ...proxied, storageUrl: "https://s3.example.com" });
  first.close();

  const second = openMetadata(path);
  expect(second.settings()).toEqual({ ...proxied, storageUrl: "https://s3.example.com" });
  second.close();

  // A row from before buckets had an address of their own.
  const older = new Sqlite(path, { strict: true });
  older.run("UPDATE settings SET data = ?", [JSON.stringify(proxied)]);
  older.close();
  const third = openMetadata(path);
  expect(third.settings()).toEqual({ ...proxied, storageUrl: null });
  third.close();

  const errors = spyOn(console, "error").mockImplementation(() => {});
  // A tunnel the person ran themselves was once `cloudflare` without one; it is network mode now.
  for (const unreadable of [
    JSON.stringify({ mode: "carrier-pigeon" }),
    "{not json",
    JSON.stringify({ mode: "cloudflare", publicUrl: "https://evertap.example.com" }),
  ]) {
    const db = new Sqlite(path, { strict: true });
    db.run("UPDATE settings SET data = ?", [unreadable]);
    db.close();
    const reopened = openMetadata(path);
    expect(reopened.settings(), unreadable).toBeNull();
    reopened.close();
  }
  expect(errors).toHaveBeenCalledTimes(3);
  errors.mockRestore();
});

test("a file from before versions is copied, then updated", async () => {
  // Buckets also kept their region then.
  const written = { ...olderBucket, endpoint: bucket.endpoint, region: "garage" };
  writeUnversioned([postgres, redis, written]);

  const metadata = openMetadata(path);
  expect(metadata.getResource(postgres.id)).toEqual({
    ...postgres,
    connectionUrl: "postgres://app:pw@ev.internal:5432/app",
  });
  expect(metadata.getResource(redis.id)).toEqual({
    ...redis,
    connectionUrl: "redis://default:pw@ev.internal:6379",
  });
  expect(metadata.getResource(bucket.id)).toEqual({ ...olderBucket, reachableAnywhere: false });
  metadata.close();
  expect(versionOf(path)).toBe(LATEST);
  expect(storedRow(path, bucket.id)).toEqual({ ...olderBucket, region: "garage" });

  const copies = await backups();
  expect(copies).toHaveLength(1);
  const [copy = ""] = copies;
  expect(versionOf(copy)).toBe(0);
  expect(storedRow(copy, postgres.id)).toEqual(postgres);
});

test("a bucket is stored without its endpoints and region, which are derived on read", () => {
  const metadata = openMetadata(path);
  metadata.putResource(bucket);
  expect(metadata.getResource(bucket.id)).toEqual(storedBucket);
  metadata.close();
  expect(storedRow(path, bucket.id)).toEqual(storedBucket);
});

test("a second start runs nothing", async () => {
  writeUnversioned([]);
  openMetadata(path).close();
  // Written after the URL migration, so only a second run would rewrite it.
  const first = openMetadata(path);
  first.putResource(postgres);
  first.close();

  const second = openMetadata(path);
  expect(second.getResource(postgres.id)).toEqual(postgres);
  second.close();
  expect(versionOf(path)).toBe(LATEST);
  expect(await backups()).toHaveLength(1);
});

test("a failed migration names itself and the copy, and keeps the ones before it", async () => {
  const broken = { ...postgres, connectionUrl: "not a url" };
  writeUnversioned([broken]);

  let message = "";
  try {
    openMetadata(path);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  const copies = await backups();
  expect(copies).toHaveLength(1);
  expect(message).toBe(
    `Could not update ${path}: migration 2 failed. A copy from before the update is at ${copies[0]}`,
  );
  expect(versionOf(path)).toBe(1);
  expect(storedRow(path, broken.id)).toEqual(broken);
});

test("a file from a newer evertap is refused", () => {
  const db = new Sqlite(path, { create: true });
  db.run(`PRAGMA user_version = ${LATEST + 1}`);
  db.close();

  expect(() => openMetadata(path)).toThrow("was written by a newer evertap");
  expect(versionOf(path)).toBe(LATEST + 1);
});
