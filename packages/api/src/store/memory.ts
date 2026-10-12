import { customAlphabet } from "nanoid";

import { DataError, type Store } from "../context.ts";
import {
  DATABASE_VERSIONS,
  RESOURCE_ENGINES,
  STORAGE_PORTS,
  STORAGE_REGION,
  TEMPORARY_WINDOW_MS,
} from "../rules.ts";
import type {
  Client,
  MachineUsage,
  Extension,
  Pairing,
  Resource,
  SavedSettings,
} from "../schemas.ts";
import { type SettingsEnvironment, choiceOf, resolveSettings } from "../settings.ts";
import { createClientRegistry, memoryClientTables } from "./clients.ts";

const newId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
const newPassword = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  24,
);
const newAccessKeyId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 20);
const newSecretAccessKey = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  40,
);

const noData = () =>
  Promise.reject(
    new DataError("The demo has no data to browse. Run evertap with Docker to see real data"),
  );

const noTunnel = () =>
  Promise.reject(
    new DataError(
      "The demo does not reach Cloudflare. Run evertap with Docker to set up a Cloudflare Tunnel",
    ),
  );

/** A fresh database on Postgres 17 is about 7.5 MB before any table exists. */
const EMPTY_DATABASE_BYTES = 7_800_000;

export type MemoryStoreOptions = {
  /** evertap's own version, which only the server knows. */
  version: string;
  /** Host in database URLs and bucket endpoints. */
  host: string;
  port: number;
  mysqlPort?: number;
  redisPort?: number;
  machine: () => Promise<MachineUsage>;
  /** The same catalog for every PostgreSQL version. */
  extensions?: Extension[];
  seed?: Resource[];
  clients?: Client[];
  pairings?: Pairing[];
  /** Nothing listens on what these say: saving settings only keeps them. */
  settings?: SettingsEnvironment;
  savedSettings?: SavedSettings;
  now?: () => Date;
};

/** Stand-in for resource drivers; also gives the router tests a store with no I/O. */
export const createMemoryStore = (options: MemoryStoreOptions): Store => {
  const rows = new Map((options.seed ?? []).map((row) => [row.id, row]));
  const now = options.now ?? (() => new Date());
  const tables = memoryClientTables();
  // Seeded clients and requests hold secrets nobody knows: they show in the UI but never sign in.
  for (const client of options.clients ?? []) {
    tables.putClient({ ...client, tokenHash: newId(), expiresAt: null, approvedBy: null });
  }
  for (const pairing of options.pairings ?? []) {
    tables.putRequest({
      ...pairing,
      requestHash: newId(),
      status: "pending",
      clientId: null,
    });
  }
  const clients = createClientRegistry(tables, now);
  const environment = options.settings ?? {
    env: {},
    port: 8080,
    publicStoragePort: 9900,
    lanAddress: () => null,
    lanName: "evertap.local",
    dockerAddress: () => null,
    publicAddresses: () => [],
  };
  let saved = options.savedSettings ?? null;

  const mustGet = (id: string) => {
    const row = rows.get(id);
    if (!row) {
      throw new Error(`resource not found: ${id}`);
    }
    return row;
  };
  /** A bucket's public endpoint follows the settings, as in live mode. */
  const read = (row: Resource): Resource =>
    row.kind === "object-storage"
      ? {
          ...row,
          publicEndpoint: row.reachableAnywhere
            ? resolveSettings(saved, environment).storageUrl.value
            : null,
        }
      : row;
  const put = (row: Resource) => {
    rows.set(row.id, row);
    return Promise.resolve(read(row));
  };

  return {
    listResources: () =>
      Promise.resolve(
        [...rows.values()].map(read).toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)),
      ),

    getResource: (id) => {
      const row = rows.get(id);
      return Promise.resolve(row ? read(row) : null);
    },

    createResource: (input) => {
      const createdAt = now();
      const common = {
        id: newId(),
        name: input.name,
        description: input.description,
        protected: false,
        expiresAt: input.temporary
          ? new Date(createdAt.getTime() + TEMPORARY_WINDOW_MS).toISOString()
          : null,
        sizeBytes: input.engine === "postgresql" ? EMPTY_DATABASE_BYTES : 0,
        lastConnectedAt: null,
        createdAt: createdAt.toISOString(),
      };
      let row: Resource;
      if (input.engine === "garage") {
        row = {
          ...common,
          kind: "object-storage",
          engine: input.engine,
          endpoint: `http://${options.host}:${STORAGE_PORTS[input.engine]}`,
          region: STORAGE_REGION,
          accessKeyId: newAccessKeyId(),
          secretAccessKey: newSecretAccessKey(),
          reachableAnywhere: false,
          publicEndpoint: null,
        };
      } else {
        const protocol = input.engine === "postgresql" ? "postgres" : input.engine;
        const port =
          input.engine === "postgresql"
            ? options.port
            : input.engine === "mysql"
              ? (options.mysqlPort ?? 3306)
              : (options.redisPort ?? 6379);
        const username = `evertap_${common.id}`;
        const database = input.engine === "redis" ? "0" : username;
        row = {
          ...common,
          kind: "database",
          engine: input.engine,
          version: input.version ?? DATABASE_VERSIONS[input.engine][0],
          connectionUrl: `${protocol}://${username}:${newPassword()}@${options.host}:${port}/${database}`,
          extensions: input.extensions,
        };
      }
      return put(row);
    },

    deleteResource: (id) => {
      mustGet(id);
      rows.delete(id);
      return Promise.resolve();
    },

    setProtected: (id, value) => put({ ...mustGet(id), protected: value }),

    setReachableAnywhere: (id, value) => {
      const row = mustGet(id);
      if (row.kind !== "object-storage") {
        throw new Error(`not a bucket: ${id}`);
      }
      return put({ ...row, reachableAnywhere: value });
    },

    setDescription: (id, value) => put({ ...mustGet(id), description: value }),

    keepResource: (id) => put({ ...mustGet(id), expiresAt: null }),

    listExtensions: () => Promise.resolve(options.extensions ?? []),

    listTables: noData,
    readRows: noData,
    applyChanges: noData,
    runQuery: noData,
    scanKeys: noData,
    readKey: noData,
    writeKey: noData,
    expireKey: noData,
    deleteKey: noData,
    listBuckets: noData,
    listObjects: noData,
    putObject: noData,
    startUpload: noData,
    uploadPart: noData,
    completeUpload: noData,
    abortUpload: noData,
    readObject: noData,
    deleteObject: noData,

    ...clients,

    // The demo never checks for a newer release.
    status: async () => ({
      version: options.version,
      update: null,
      mode: "demo",
      host: options.host,
      ...(await options.machine()),
      engines: [...RESOURCE_ENGINES],
    }),

    doctor: async () => ({
      version: options.version,
      update: null,
      docker: null,
      engines: [],
      machine: await options.machine(),
      access: choiceOf(resolveSettings(saved, environment), environment),
      tunnel: null,
      lan: null,
      entries: [],
      conflicts: [],
    }),

    settings: () => Promise.resolve({ saved, environment }),

    saveSettings: (settings) => {
      saved = settings;
      return Promise.resolve();
    },

    approveCloudflare: noTunnel,
    changeTunnel: noTunnel,
    tunnelProgress: () => Promise.resolve(null),

    // With nothing to send a request through, it arrives as a proxy on this machine passes it on.
    probe: (url) => {
      const { host, protocol } = new URL(url);
      return Promise.resolve({
        answered: true,
        status: 200,
        arrival: { host, forwardedFor: "203.0.113.7", forwardedProto: protocol.slice(0, -1) },
        upgrades: true,
      });
    },
  };
};
