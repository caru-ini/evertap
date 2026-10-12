import type {
  RequestHeadersPluginContext,
  ResponseHeadersPluginContext,
} from "@orpc/server/plugins";

import type { TunnelPhase } from "./rules.ts";
import type {
  AppliedChanges,
  Client,
  CompletedPart,
  CreateResourceInput,
  CreatedApiKey,
  DoctorReport,
  Database,
  Extension,
  ListObjectsInput,
  ObjectList,
  ObjectStorage,
  ClaimStatus,
  Pairing,
  QueryResult,
  ReadRowsInput,
  RedisKey,
  Resource,
  RowChanges,
  Rows,
  SavedSettings,
  ScanKeysInput,
  ScanKeysResult,
  StartedPairing,
  SystemStatus,
  Table,
  TableRef,
  TunnelChange,
  TunnelResult,
  WriteKeyInput,
  ExpireKeyInput,
} from "./schemas.ts";
import type { SettingsEnvironment } from "./settings.ts";

/**
 * Something the person asked for cannot be done as asked: a bad SQL statement, an unknown column,
 * a constraint the row breaks. The router passes the message on; any other error is a fault.
 */
export class DataError extends Error {}

/**
 * A service cannot do this yet, such as while its first download runs. The message says when to
 * try again, and the router passes it on.
 */
export class UnavailableError extends Error {}

/** The headers a probe reached this evertap with, as the way here passed them on. */
export type Arrival = {
  host: string | null;
  forwardedFor: string | null;
  forwardedProto: string | null;
};

/**
 * What one-time requests to a URL found: whether one reached this evertap, and whether a WebSocket
 * upgrade reached it with its Upgrade header. Something else at the URL gets them but never arrives.
 */
export type Probe =
  | { answered: false; failure: "name" | "refused" | "certificate" | "timeout" | "other" }
  | { answered: true; status: number; arrival: Arrival | null; upgrades: boolean };

/** Router owns policy; the store handles persistence and service provisioning. */
export type Store = {
  listResources: () => Promise<Resource[]>;
  getResource: (id: string) => Promise<Resource | null>;
  createResource: (input: CreateResourceInput) => Promise<Resource>;
  deleteResource: (id: string) => Promise<void>;
  setProtected: (id: string, value: boolean) => Promise<Resource>;
  /** A bucket's switch for signed links that work on any device; the router has checked it may. */
  setReachableAnywhere: (id: string, value: boolean) => Promise<Resource>;
  setDescription: (id: string, value: string) => Promise<Resource>;
  /** Clears the expiry: a temporary resource becomes a normal one. */
  keepResource: (id: string) => Promise<Resource>;
  /** What the given PostgreSQL version's instance can enable. */
  listExtensions: (version: string) => Promise<Extension[]>;

  // Data browsing. The router has already checked the engine; each call uses the resource's own
  // credentials, so it cannot reach another resource. A bucket's calls name the bucket by the
  // resource's `name`, which the router sets to the one asked for.
  listTables: (resource: Database) => Promise<Table[]>;
  readRows: (resource: Database, input: ReadRowsInput) => Promise<Rows>;
  /**
   * Applies every change in one transaction. A change that fails (no such row, a constraint, a
   * bad value) rolls all of them back and throws a DataError saying which change it was.
   */
  applyChanges: (
    resource: Database,
    table: TableRef,
    changes: RowChanges,
  ) => Promise<AppliedChanges>;
  /** `readOnly` runs the text in read-only transactions, so any change is refused. */
  runQuery: (
    resource: Database,
    sql: string,
    options?: { readOnly?: boolean },
  ) => Promise<QueryResult>;
  scanKeys: (resource: Database, input: ScanKeysInput) => Promise<ScanKeysResult>;
  /** Null when the key does not exist. */
  readKey: (resource: Database, key: string) => Promise<RedisKey | null>;
  writeKey: (resource: Database, input: WriteKeyInput) => Promise<void>;
  expireKey: (resource: Database, input: ExpireKeyInput) => Promise<void>;
  deleteKey: (resource: Database, key: string) => Promise<void>;
  /** The buckets the resource's key reaches: its first, then those its apps made, by name. */
  listBuckets: (resource: ObjectStorage) => Promise<string[]>;
  listObjects: (resource: ObjectStorage, input: ListObjectsInput) => Promise<ObjectList>;
  /**
   * Uploads pass through evertap one part at a time. A file that fits in one part is one
   * `putObject`, stored with its Content-Type. A larger one is started, sent part by part, and
   * completed with the parts' ETags. Either replaces an object with the same key.
   */
  putObject: (
    resource: ObjectStorage,
    input: { key: string; type: string; body: Blob },
  ) => Promise<void>;
  startUpload: (
    resource: ObjectStorage,
    input: { key: string; type: string },
  ) => Promise<{ uploadId: string }>;
  uploadPart: (
    resource: ObjectStorage,
    input: { key: string; uploadId: string; partNumber: number; body: Blob },
  ) => Promise<{ etag: string }>;
  completeUpload: (
    resource: ObjectStorage,
    input: { key: string; uploadId: string; parts: CompletedPart[] },
  ) => Promise<void>;
  /** Drops the parts sent so far; an upload already gone is not an error. */
  abortUpload: (resource: ObjectStorage, input: { key: string; uploadId: string }) => Promise<void>;
  /** The object's bytes as the bucket sends them; null when the key does not exist. */
  readObject: (
    resource: ObjectStorage,
    key: string,
  ) => Promise<{ body: ReadableStream<Uint8Array>; contentType: string | null } | null>;
  /** Deleting a key that does not exist is not an error. */
  deleteObject: (resource: ObjectStorage, key: string) => Promise<void>;

  /** Browsers whose session lapsed are left out. */
  listClients: () => Promise<Client[]>;
  revokeClient: (id: string) => Promise<void>;
  createApiKey: (name: string) => Promise<CreatedApiKey>;
  /**
   * `source` is the requester's address, capped at a few open requests each (an IPv6 /64 is one
   * source, and its /48 has a cap of its own); null is the machine running evertap, never capped,
   * so a flood cannot lock its owner out. Null while over a cap.
   */
  startPairing: (
    input: Pick<Pairing, "kind" | "name" | "source">,
  ) => Promise<StartedPairing | null>;
  /** The requester's own open request again (a reloaded sign-in page), or null once it is not open. */
  resumePairing: (requestId: string) => Promise<Pick<Pairing, "code" | "expiresAt"> | null>;
  /** Null once the code has expired, been approved, or been denied. */
  getPairing: (code: string) => Promise<Pairing | null>;
  /** `approvedBy` is the approving browser's client id, or null on the machine running evertap. */
  approvePairing: (code: string, approvedBy: string | null) => Promise<Client>;
  denyPairing: (code: string) => Promise<void>;
  /**
   * The requester asks with its secret. Once approved it gets its token, and only once; `name`
   * renames the client (a sign-in link learns the browser's name only here).
   */
  claimPairing: (
    requestId: string,
    name?: string,
  ) => Promise<
    { status: Exclude<ClaimStatus, "approved"> } | { status: "approved"; token: string }
  >;
  /** The client a token belongs to, recording the call; null for an unknown or lapsed token. */
  authenticate: (token: string, seen: { ip: string | null }) => Promise<Client | null>;
  status: () => Promise<SystemStatus>;
  /** Every field, local-only ones included; the router trims them for network callers. */
  doctor: () => Promise<DoctorReport>;
  /** The saved access settings, and what else decides them on this machine. */
  settings: () => Promise<{ saved: SavedSettings | null; environment: SettingsEnvironment }>;
  /**
   * Saves the access settings and moves the UI and every entry to match, without a restart. When
   * one cannot listen where they say, nothing changes and it throws a DataError saying why.
   */
  saveSettings: (settings: SavedSettings) => Promise<void>;
  /**
   * Cloudflare's page where the person approves evertap. What proves the approval is evertap's
   * stays here, for `session` alone and for ten minutes.
   */
  approveCloudflare: (session: string) => Promise<string>;
  /**
   * With what the person `pasted` after approving evertap for `session`, makes `change` in
   * Cloudflare and puts its settings in force, then gives the access back. The router has checked
   * that it may; a DataError says what to do instead. With `answerFirst`, as when the browser came
   * through the tunnel, what goes away with the change, the tunnel or its old names, goes once the
   * answer has gone out through it.
   */
  changeTunnel: (
    session: string,
    pasted: string,
    change: TunnelChange,
    options: { answerFirst: boolean },
  ) => Promise<TunnelResult>;
  /** Where the change `session` started with `changeTunnel` is, or null while none runs. */
  tunnelProgress: (session: string) => Promise<TunnelPhase | null>;
  /** Sends one-time requests to `url`'s health check, such as through the person's proxy. */
  probe: (url: string) => Promise<Probe>;
};

/**
 * Who is calling. `local` is the CLI on the machine running evertap, over the Unix socket; a
 * `person` is a signed-in browser (no client in the demo, which has no sign-in); a `client` is a
 * paired CLI or an API key.
 */
export type Caller =
  | { kind: "local" }
  | { kind: "person"; client: Client | null }
  | { kind: "client"; client: Client }
  | { kind: "anonymous" };

export type Context = ResponseHeadersPluginContext &
  RequestHeadersPluginContext & {
    store: Store;
    caller: Caller;
    /** Where a browser opens evertap; sign-in links point here. */
    origin?: string;
    /** Cookies get `Secure` and a `__Host-` name when the browser reached evertap over HTTPS. */
    https?: boolean;
    /** The caller's address, as a proxy or tunnel on this machine passed it on when one did. */
    ip?: string | null;
  };
