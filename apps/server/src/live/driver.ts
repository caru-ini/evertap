import type { Store } from "@evertap/api/context";
import type { Database, Extension, ObjectStorage } from "@evertap/api/schemas";

import type { Docker } from "./docker.ts";
import type { Address } from "./listener.ts";
import type { Metadata } from "./metadata.ts";

export type DriverContext = {
  docker: Docker;
  metadata: Metadata;
  /** Prefix for container, volume and network names; nothing without it is ever touched. */
  prefix: string;
  /** The entry's configured port, where an older evertap published its container. */
  publicPort: number;
  /** Host and port written into connection URLs: `ev.internal` on the standard port. */
  urlHost: string;
  urlPort: number;
  /** Where the entry listens now; the settings can move it while evertap runs (`rebind`). */
  entry: () => Address;
  /** A directory the driver owns, for config files it mounts into its entry. */
  dir: string;
};

export type ProvisionInput = {
  id: string;
  name: string;
  version: string;
  extensions: string[];
  password: string;
};

export type Usage = {
  sizeBytes: number;
  /** A client other than evertap was connected at some point since the last call. */
  connected: boolean;
};

type DriverBase = {
  /** What `provision` needs downloaded for the version, so the store can fetch it first. */
  images: (version: string) => string[];
  /** Brings up the entry and every instance these resources live on. Runs once at startup. */
  start: (resources: Database[]) => Promise<void>;
  /** Creates the database and its credentials, starting the version's instance on first use. */
  provision: (input: ProvisionInput) => Promise<{ connectionUrl: string }>;
  /** Removes the database, its credentials and its data. */
  drop: (resource: Database) => Promise<void>;
  /** Keyed by resource id; a resource missing from the map keeps its last numbers. */
  usage: (resources: Database[]) => Promise<Map<string, Usage>>;
  /**
   * Moves the entry to where `entry` now says, if it listens yet. Throws when it cannot listen
   * there, leaving it unbound until the next call.
   */
  rebind: () => void;
  /** Closes connections and listeners; containers keep running. */
  close: () => Promise<void>;
};

export type SqlDriver = DriverBase &
  Pick<Store, "listTables" | "readRows" | "applyChanges" | "runQuery"> & {
    /** PostgreSQL only. */
    listExtensions?: (version: string) => Promise<Extension[]>;
  };

export type RedisDriver = DriverBase &
  Pick<Store, "scanKeys" | "readKey" | "writeKey" | "expireKey" | "deleteKey">;

/** What a new bucket's owner is handed; the name is the bucket's own, the endpoint derived. */
export type BucketCredentials = Pick<ObjectStorage, "accessKeyId" | "secretAccessKey">;

export type StorageDriver = {
  /** What `provision` needs downloaded, so the store can fetch it first. */
  images: () => string[];
  /** Brings up the entry, and the shared instance when buckets already live on it. */
  start: (resources: ObjectStorage[]) => Promise<void>;
  /** Creates a key and its first bucket, starting the instance on first use. */
  provision: (input: { id: string; name: string }) => Promise<BucketCredentials>;
  /** Deletes every bucket the key reaches, objects and all, then the key. */
  drop: (resource: ObjectStorage) => Promise<void>;
  usage: (resources: ObjectStorage[]) => Promise<Map<string, Usage>>;
  /** Passes a request from the entry for buckets reached from anywhere on as the entry would. */
  forward: (request: Request) => Promise<Response>;
  /** As `DriverBase.rebind`. */
  rebind: () => void;
  close: () => Promise<void>;
} & Pick<
  Store,
  | "listBuckets"
  | "listObjects"
  | "putObject"
  | "startUpload"
  | "uploadPart"
  | "completeUpload"
  | "abortUpload"
  | "readObject"
  | "deleteObject"
>;

export type Drivers = {
  postgresql?: SqlDriver;
  mysql?: SqlDriver;
  redis?: RedisDriver;
  garage?: StorageDriver;
};
