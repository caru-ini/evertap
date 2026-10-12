import { DataError, UnavailableError } from "@evertap/api/context";
import type { Database } from "@evertap/api/schemas";
import { memoryClientTables } from "@evertap/api/store/clients";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SqlDriver, StorageDriver } from "./driver.ts";
import type { Metadata, StoredResource } from "./metadata.ts";
import { createLiveStore } from "./store.ts";

const NOW = new Date("2026-01-10T00:00:00.000Z");

const expiredRow: Database = {
  id: "r1",
  kind: "database",
  engine: "postgresql",
  version: "18",
  name: "scratch",
  description: "",
  connectionUrl: "postgres://scratch:pw@127.0.0.1:6432/scratch",
  extensions: [],
  protected: false,
  expiresAt: "2026-01-01T00:00:00.000Z",
  sizeBytes: 0,
  lastConnectedAt: null,
  createdAt: "2025-12-25T00:00:00.000Z",
};

const memoryMetadata = (rows: StoredResource[]): Metadata => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    clientTables: memoryClientTables(),
    listResources: () => [...byId.values()],
    getResource: (id) => byId.get(id) ?? null,
    putResource: (row) => {
      byId.set(row.id, row);
    },
    deleteResource: (id) => {
      byId.delete(id);
    },
    secret: () => "secret",
    settings: () => null,
    putSettings: () => {},
    close: () => {},
  };
};

const unused = () => Promise.reject(new Error("not used here"));

/** A driver whose `start` holds the engine's queue until `release` is called. */
const heldDriver = () => {
  const started = Promise.withResolvers<void>();
  const drop = vi.fn(() => Promise.resolve());
  const driver: SqlDriver = {
    images: (version) => [`pgvector/pgvector:pg${version}`],
    start: () => started.promise,
    provision: unused,
    drop,
    usage: () => Promise.resolve(new Map()),
    rebind: () => {},
    close: () => Promise.resolve(),
    listTables: unused,
    readRows: unused,
    applyChanges: unused,
    runQuery: unused,
  };
  return { driver, drop, release: () => started.resolve() };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

afterEach(() => {
  vi.useRealTimers();
});

describe("expired resources", () => {
  const setup = () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const metadata = memoryMetadata([expiredRow]);
    const { driver, drop, release } = heldDriver();
    const store = createLiveStore({
      version: "1.2.3",
      host: "127.0.0.1",
      metadata,
      drivers: { postgresql: driver },
      machine: () =>
        Promise.resolve({
          disk: { totalBytes: 1, freeBytes: 1 },
          memory: { totalBytes: 1, freeBytes: 1 },
          cpu: { usedRatio: 0, cores: 1 },
        }),
      checks: () =>
        Promise.resolve({
          docker: null,
          access: null,
          tunnel: null,
          lan: null,
          entries: [],
          conflicts: [],
        }),
      pull: () => Promise.resolve(),
      storageUrl: () => null,
      now: () => NOW,
    });
    return { metadata, drop, release, store };
  };

  it("are dropped once the engine's earlier changes finish", async () => {
    const { metadata, drop, release, store } = setup();
    vi.advanceTimersByTime(30_000);
    await settle();
    expect(drop).not.toHaveBeenCalled();
    release();
    await settle();
    expect(drop).toHaveBeenCalledTimes(1);
    expect(metadata.getResource(expiredRow.id)).toBeNull();
    await store.close();
  });

  it("stay when protected while the drop waited its turn", async () => {
    const { metadata, drop, release, store } = setup();
    vi.advanceTimersByTime(30_000);
    await settle();
    await store.setProtected(expiredRow.id, true);
    release();
    await settle();
    expect(drop).not.toHaveBeenCalled();
    expect(metadata.getResource(expiredRow.id)?.protected).toBe(true);
    await store.close();
  });
});

describe("buckets", () => {
  it("are created and dropped by their engine's driver", async () => {
    const metadata = memoryMetadata([]);
    const drop = vi.fn(() => Promise.resolve());
    const driver: StorageDriver = {
      images: () => ["dxflrs/garage"],
      start: () => Promise.resolve(),
      provision: ({ name }) =>
        Promise.resolve({ accessKeyId: `GK-${name}`, secretAccessKey: "secret" }),
      drop,
      usage: () => Promise.resolve(new Map()),
      forward: unused,
      rebind: () => {},
      close: () => Promise.resolve(),
      listBuckets: unused,
      listObjects: unused,
      putObject: unused,
      startUpload: unused,
      uploadPart: unused,
      completeUpload: unused,
      abortUpload: unused,
      readObject: unused,
      deleteObject: unused,
    };
    const store = createLiveStore({
      version: "1.2.3",
      host: "127.0.0.1",
      metadata,
      drivers: { garage: driver },
      machine: () =>
        Promise.resolve({
          disk: { totalBytes: 1, freeBytes: 1 },
          memory: { totalBytes: 1, freeBytes: 1 },
          cpu: { usedRatio: 0, cores: 1 },
        }),
      checks: () =>
        Promise.resolve({
          docker: null,
          access: null,
          tunnel: null,
          lan: null,
          entries: [],
          conflicts: [],
        }),
      pull: () => Promise.resolve(),
      storageUrl: () => null,
      now: () => NOW,
    });

    expect((await store.status()).engines).toEqual(["garage"]);
    const created = await store.createResource({
      engine: "garage",
      name: "files",
      description: "",
      extensions: [],
      temporary: false,
    });
    expect(created).toMatchObject({
      kind: "object-storage",
      engine: "garage",
      name: "files",
      endpoint: "http://ev.internal:3900",
      region: "us-east-1",
      accessKeyId: "GK-files",
      expiresAt: null,
    });
    // Derived on each read, so never stored.
    expect(metadata.getResource(created.id)).not.toHaveProperty("endpoint");
    expect(metadata.getResource(created.id)).not.toHaveProperty("region");
    expect(await store.getResource(created.id)).toEqual(created);

    await store.deleteResource(created.id);
    expect(drop).toHaveBeenCalledWith(created);
    expect(metadata.getResource(created.id)).toBeNull();
    await store.close();
  });
});

describe("an engine that cannot start", () => {
  it("records and prints what `explain` makes of the error, in one line", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const taken = Object.assign(new Error("Failed to listen at 127.0.0.1"), { code: "EADDRINUSE" });
    const { driver } = heldDriver();
    const store = createLiveStore({
      version: "1.2.3",
      host: "127.0.0.1",
      metadata: memoryMetadata([]),
      drivers: { postgresql: { ...driver, start: () => Promise.reject(taken) } },
      machine: () =>
        Promise.resolve({
          disk: { totalBytes: 1, freeBytes: 1 },
          memory: { totalBytes: 1, freeBytes: 1 },
          cpu: { usedRatio: 0, cores: 1 },
        }),
      checks: () =>
        Promise.resolve({
          docker: null,
          access: null,
          tunnel: null,
          lan: null,
          entries: [],
          conflicts: [],
        }),
      pull: () => Promise.resolve(),
      storageUrl: () => null,
      explain: (engine, error) =>
        error === taken ? new DataError(`127.0.0.1:6432 is taken by ${engine}'s rival`) : error,
    });
    await settle();

    expect((await store.doctor()).engines[0]).toEqual({
      engine: "postgresql",
      state: "failed",
      error: "127.0.0.1:6432 is taken by postgresql's rival",
    });
    expect(errors).toHaveBeenCalledWith(
      "starting postgresql: 127.0.0.1:6432 is taken by postgresql's rival",
    );
    errors.mockRestore();
    await store.close();
  });
});

describe("a newer release", () => {
  it("shows in the status and the doctor, as the update check last found it", async () => {
    const update = {
      version: "1.3.0",
      url: "https://github.com/caru-ini/evertap/releases/tag/v1.3.0",
      advice: "Run the install script again",
    };
    let found: typeof update | null = null;
    const store = createLiveStore({
      version: "1.2.3",
      host: "127.0.0.1",
      metadata: memoryMetadata([]),
      drivers: {},
      machine: () =>
        Promise.resolve({
          disk: { totalBytes: 1, freeBytes: 1 },
          memory: { totalBytes: 1, freeBytes: 1 },
          cpu: { usedRatio: 0, cores: 1 },
        }),
      checks: () =>
        Promise.resolve({
          docker: null,
          access: null,
          tunnel: null,
          lan: null,
          entries: [],
          conflicts: [],
        }),
      pull: () => Promise.resolve(),
      storageUrl: () => null,
      update: () => found,
    });

    expect((await store.status()).update).toBeNull();
    found = update;
    expect((await store.status()).update).toEqual(update);
    expect((await store.doctor()).update).toEqual(update);
    await store.close();
  });
});

describe("first downloads", () => {
  it("are fetched before a create takes its turn, so a slow startup cannot hold the request", async () => {
    const metadata = memoryMetadata([]);
    const { driver, release } = heldDriver();
    const provision = vi.spyOn(driver, "provision");
    const pull = vi.fn(() =>
      Promise.reject(new UnavailableError("This service is still downloading")),
    );
    const store = createLiveStore({
      version: "1.2.3",
      host: "127.0.0.1",
      metadata,
      drivers: { postgresql: driver },
      machine: () =>
        Promise.resolve({
          disk: { totalBytes: 1, freeBytes: 1 },
          memory: { totalBytes: 1, freeBytes: 1 },
          cpu: { usedRatio: 0, cores: 1 },
        }),
      checks: () =>
        Promise.resolve({
          docker: null,
          access: null,
          tunnel: null,
          lan: null,
          entries: [],
          conflicts: [],
        }),
      pull,
      storageUrl: () => null,
      now: () => NOW,
    });

    // The driver's start never finishes here, yet the create answers.
    await expect(
      store.createResource({
        engine: "postgresql",
        name: "app",
        description: "",
        version: "16",
        extensions: [],
        temporary: false,
      }),
    ).rejects.toBeInstanceOf(UnavailableError);
    expect(pull).toHaveBeenCalledWith(["pgvector/pgvector:pg16"], expect.any(Number));
    expect(provision).not.toHaveBeenCalled();
    expect(metadata.listResources()).toEqual([]);
    release();
    await store.close();
  });
});
