import { DataError, type Store } from "@evertap/api/context";
import {
  DATABASE_ENGINES,
  DATABASE_VERSIONS,
  RESOURCE_ENGINES,
  STORAGE_ENGINES,
  STORAGE_REGION,
  TEMPORARY_WINDOW_MS,
  bucketEndpoint,
  isDatabaseEngine,
  type DatabaseEngine,
  type ResourceEngine,
} from "@evertap/api/rules";
import type {
  Database,
  DoctorReport,
  MachineUsage,
  ObjectStorage,
  Resource,
  Update,
} from "@evertap/api/schemas";
import { createClientRegistry } from "@evertap/api/store/clients";
import { customAlphabet } from "nanoid";

import type { Drivers, Usage } from "./driver.ts";
import type { Metadata, StoredResource } from "./metadata.ts";

const newId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
const newPassword = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  24,
);

const USAGE_INTERVAL_MS = 30_000;
/**
 * How long a create waits for a first download before asking to try again. Cloudflare drops a
 * response after 125 s, and starting the instance takes part of that too.
 */
const DOWNLOAD_WAIT_MS = 60_000;

const report = (engine: ResourceEngine) => (error: unknown) => {
  // A DataError already says what to do; its stack would bury that.
  if (error instanceof DataError) {
    console.error(`starting ${engine}: ${error.message}`);
  } else {
    console.error(`starting ${engine}:`, error);
  }
};

export type LiveStoreOptions = {
  /** evertap's own version, as the binary was built. */
  version: string;
  host: string;
  metadata: Metadata;
  drivers: Drivers;
  machine: () => Promise<MachineUsage>;
  /**
   * The doctor's checks outside the store: Docker, the access mode and tunnel, the name evertap is
   * reached by, the entries, and what else wants their addresses.
   */
  checks: () => Promise<
    Pick<DoctorReport, "docker" | "access" | "tunnel" | "dataDir" | "lan" | "entries" | "conflicts">
  >;
  /** What to record and print when an engine cannot start, such as a DataError saying why. */
  explain?: (engine: ResourceEngine, error: unknown) => unknown;
  /** Downloads the images, or throws `UnavailableError` once `waitMs` passes and goes on alone. */
  pull: (images: string[], waitMs: number) => Promise<void>;
  /** Where buckets reached from anywhere are served now; null while nothing leads there. */
  storageUrl: () => string | null;
  /** A newer release than this evertap, as the update check last found. */
  update?: () => Update | null;
  now?: () => Date;
};

/**
 * Resources backed by real services; clients and sessions kept in the same SQLite file. The
 * settings and the probe are the caller's to add, as both work through what runs outside it: the
 * listeners and the health check.
 */
export const createLiveStore = (
  options: LiveStoreOptions,
): Omit<
  Store,
  "settings" | "saveSettings" | "approveCloudflare" | "changeTunnel" | "tunnelProgress" | "probe"
> & {
  close: () => Promise<void>;
} => {
  const { metadata, drivers } = options;
  const now = options.now ?? (() => new Date());
  const clients = createClientRegistry(metadata.clientTables, now);

  // One change at a time per engine: two first resources on a version must not race to start it.
  const queues = new Map<ResourceEngine, Promise<unknown>>();
  const serial = <T>(engine: ResourceEngine, run: () => Promise<T>) => {
    const next = (queues.get(engine) ?? Promise.resolve()).then(run, run);
    queues.set(
      engine,
      next.catch(() => undefined),
    );
    return next;
  };

  const sqlDriver = ({ engine }: { engine: DatabaseEngine }) => {
    const driver = engine === "redis" ? undefined : drivers[engine];
    if (!driver) {
      throw new Error(`no driver for ${engine}`);
    }
    return driver;
  };
  const redisDriver = () => {
    if (!drivers.redis) {
      throw new Error("no driver for redis");
    }
    return drivers.redis;
  };
  const storageDriver = ({ engine }: { engine: ObjectStorage["engine"] }) => {
    const driver = drivers[engine];
    if (!driver) {
      throw new Error(`no driver for ${engine}`);
    }
    return driver;
  };

  const withEndpoint = (row: StoredResource): Resource =>
    row.kind === "object-storage"
      ? {
          ...row,
          endpoint: bucketEndpoint(row.engine),
          region: STORAGE_REGION,
          publicEndpoint: row.reachableAnywhere ? options.storageUrl() : null,
        }
      : row;

  const readAll = () => metadata.listResources().map(withEndpoint);
  const read = (id: string) => {
    const row = metadata.getResource(id);
    return row ? withEndpoint(row) : null;
  };

  const mustGet = (id: string) => {
    const row = read(id);
    if (!row) {
      throw new Error(`resource not found: ${id}`);
    }
    return row;
  };
  const update = (id: string, change: (row: Resource) => Resource) => {
    const row = change(mustGet(id));
    metadata.putResource(row);
    return withEndpoint(row);
  };

  const databases = (engine: DatabaseEngine) =>
    readAll().filter((row): row is Database => row.kind === "database" && row.engine === engine);
  const buckets = (engine: ObjectStorage["engine"]) =>
    readAll().filter(
      (row): row is ObjectStorage => row.kind === "object-storage" && row.engine === engine,
    );

  /** `still` checks the row again once the engine's earlier changes are done, as it may have changed. */
  const drop = async (row: Resource, still: (current: Resource) => boolean = () => true) => {
    const run = async () => {
      const current = read(row.id);
      if (!current || !still(current)) {
        return;
      }
      if (current.kind === "database") {
        await sqlOrRedis(current).drop(current);
      } else {
        await storageDriver(current).drop(current);
      }
      metadata.deleteResource(current.id);
    };
    await serial(row.engine, run);
  };
  const sqlOrRedis = ({ engine }: { engine: DatabaseEngine }) =>
    engine === "redis" ? redisDriver() : sqlDriver({ engine });

  /** Undefined when the engine has no driver or nothing to measure. */
  const measure = (engine: ResourceEngine): Promise<Map<string, Usage>> | undefined => {
    if (isDatabaseEngine(engine)) {
      const driver = drivers[engine];
      const rows = databases(engine);
      return driver && rows.length > 0 ? driver.usage(rows) : undefined;
    }
    const driver = drivers[engine];
    const rows = buckets(engine);
    return driver && rows.length > 0 ? driver.usage(rows) : undefined;
  };

  const refreshUsage = async () => {
    const at = now();
    for (const engine of RESOURCE_ENGINES) {
      const pending = measure(engine);
      if (!pending) {
        continue;
      }
      let usage;
      try {
        usage = await pending;
      } catch (error) {
        console.error(`usage for ${engine}:`, error);
        continue;
      }
      for (const [id, { sizeBytes, connected }] of usage) {
        if (!metadata.getResource(id)) {
          continue;
        }
        update(id, (row) => ({
          ...row,
          sizeBytes,
          lastConnectedAt: connected ? at.toISOString() : row.lastConnectedAt,
          // A connection keeps a temporary resource alive for another window.
          expiresAt:
            connected && row.expiresAt !== null
              ? new Date(at.getTime() + TEMPORARY_WINDOW_MS).toISOString()
              : row.expiresAt,
        }));
      }
    }
    const expired = (row: Resource) =>
      row.expiresAt !== null && !row.protected && new Date(row.expiresAt) <= at;
    for (const row of readAll()) {
      if (expired(row)) {
        try {
          await drop(row, expired);
        } catch (error) {
          console.error(`deleting expired ${row.name}:`, error);
        }
      }
    }
  };

  const health = new Map<ResourceEngine, DoctorReport["engines"][number]>();
  const start = async (engine: ResourceEngine, run: () => Promise<void>) => {
    health.set(engine, { engine, state: "starting" });
    try {
      await serial(engine, run);
      health.set(engine, { engine, state: "ready" });
    } catch (thrown) {
      const error = options.explain?.(engine, thrown) ?? thrown;
      health.set(engine, {
        engine,
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      report(engine)(error);
    }
  };

  // Entries and instances come up in the background so the UI answers while images download.
  for (const engine of DATABASE_ENGINES) {
    const driver = drivers[engine];
    if (driver) {
      void start(engine, () => driver.start(databases(engine)));
    }
  }
  for (const engine of STORAGE_ENGINES) {
    const driver = drivers[engine];
    if (driver) {
      void start(engine, () => driver.start(buckets(engine)));
    }
  }
  const timer = setInterval(() => {
    void refreshUsage();
  }, USAGE_INTERVAL_MS);

  return {
    ...clients,

    listResources: () =>
      Promise.resolve(readAll().toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))),

    getResource: (id) => Promise.resolve(read(id)),

    createResource: async (input) => {
      const createdAt = now();
      const expiresAt = input.temporary
        ? new Date(createdAt.getTime() + TEMPORARY_WINDOW_MS).toISOString()
        : null;
      const id = newId();
      // Outside the engine's queue: a startup still downloading the same thing must not hold it.
      if (input.engine === "garage") {
        const driver = storageDriver({ engine: input.engine });
        await options.pull(driver.images(), DOWNLOAD_WAIT_MS);
        const credentials = await serial(input.engine, () =>
          driver.provision({ id, name: input.name }),
        );
        const row: StoredResource = {
          id,
          kind: "object-storage",
          engine: input.engine,
          name: input.name,
          description: input.description,
          ...credentials,
          reachableAnywhere: false,
          protected: false,
          expiresAt,
          sizeBytes: 0,
          lastConnectedAt: null,
          createdAt: createdAt.toISOString(),
        };
        metadata.putResource(row);
        return withEndpoint(row);
      }
      const engine = input.engine;
      const driver = sqlOrRedis({ engine });
      const version = input.version ?? DATABASE_VERSIONS[engine][0];
      await options.pull(driver.images(version), DOWNLOAD_WAIT_MS);
      const { connectionUrl } = await serial(engine, () =>
        driver.provision({
          id,
          name: input.name,
          version,
          extensions: input.extensions,
          password: newPassword(),
        }),
      );
      const row: Database = {
        id,
        kind: "database",
        engine,
        version,
        name: input.name,
        description: input.description,
        connectionUrl,
        extensions: input.extensions,
        protected: false,
        expiresAt,
        sizeBytes: 0,
        lastConnectedAt: null,
        createdAt: createdAt.toISOString(),
      };
      metadata.putResource(row);
      return row;
    },

    deleteResource: async (id) => {
      await drop(mustGet(id));
    },

    setProtected: (id, value) =>
      Promise.resolve(update(id, (row) => ({ ...row, protected: value }))),

    setReachableAnywhere: (id, value) =>
      Promise.resolve(
        update(id, (row) =>
          row.kind === "object-storage" ? { ...row, reachableAnywhere: value } : row,
        ),
      ),

    setDescription: (id, value) =>
      Promise.resolve(update(id, (row) => ({ ...row, description: value }))),

    keepResource: (id) => Promise.resolve(update(id, (row) => ({ ...row, expiresAt: null }))),

    listExtensions: async (version) => {
      const driver = drivers.postgresql;
      if (!driver?.listExtensions) {
        return [];
      }
      // They are read from the version's image, so its first download comes first here too.
      await options.pull(driver.images(version), DOWNLOAD_WAIT_MS);
      return driver.listExtensions(version);
    },

    listTables: (resource) => sqlDriver(resource).listTables(resource),
    readRows: (resource, input) => sqlDriver(resource).readRows(resource, input),
    applyChanges: (resource, table, changes) =>
      sqlDriver(resource).applyChanges(resource, table, changes),
    runQuery: (resource, sql, run) => sqlDriver(resource).runQuery(resource, sql, run),
    scanKeys: (resource, input) => redisDriver().scanKeys(resource, input),
    readKey: (resource, key) => redisDriver().readKey(resource, key),
    writeKey: (resource, input) => redisDriver().writeKey(resource, input),
    expireKey: (resource, input) => redisDriver().expireKey(resource, input),
    deleteKey: (resource, key) => redisDriver().deleteKey(resource, key),
    listBuckets: (resource) => storageDriver(resource).listBuckets(resource),
    listObjects: (resource, input) => storageDriver(resource).listObjects(resource, input),
    putObject: (resource, input) => storageDriver(resource).putObject(resource, input),
    startUpload: (resource, input) => storageDriver(resource).startUpload(resource, input),
    uploadPart: (resource, input) => storageDriver(resource).uploadPart(resource, input),
    completeUpload: (resource, input) => storageDriver(resource).completeUpload(resource, input),
    abortUpload: (resource, input) => storageDriver(resource).abortUpload(resource, input),
    readObject: (resource, key) => storageDriver(resource).readObject(resource, key),
    deleteObject: (resource, key) => storageDriver(resource).deleteObject(resource, key),

    status: async () => ({
      version: options.version,
      update: options.update?.() ?? null,
      mode: "live",
      host: options.host,
      ...(await options.machine()),
      engines: RESOURCE_ENGINES.filter((engine) => drivers[engine] !== undefined),
    }),

    doctor: async () => ({
      version: options.version,
      update: options.update?.() ?? null,
      ...(await options.checks()),
      engines: RESOURCE_ENGINES.map(
        (engine) => health.get(engine) ?? { engine, state: "unavailable" as const },
      ),
      machine: await options.machine(),
    }),

    close: async () => {
      clearInterval(timer);
      await Promise.all(Object.values(drivers).map((driver) => driver?.close()));
      metadata.close();
    },
  };
};
