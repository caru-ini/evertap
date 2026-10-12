import {
  DATABASE_HOST,
  DATABASE_PORTS,
  DEMO_PAIRING_CODE,
  STORAGE_REGION,
  STORAGE_URL_EXAMPLE,
  bucketEndpoint,
} from "@evertap/api/rules";
import type { Client, Extension, Pairing, Resource, SavedSettings } from "@evertap/api/schemas";
import type { SettingsEnvironment } from "@evertap/api/settings";
import { createMemoryStore } from "@evertap/api/store/memory";

import { config } from "./config.ts";
import { readMachine } from "./machine.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();
const url = (id: string, password: string) =>
  `postgres://evertap_${id}:${password}@${DATABASE_HOST}:${DATABASE_PORTS.postgresql}/evertap_${id}`;

/** Sample rows for each supported service until the real drivers exist. */
const SAMPLE: Resource[] = [
  {
    kind: "database",
    engine: "postgresql",
    version: "17",
    id: "app",
    name: "app_dev",
    description: "Web app local development",
    connectionUrl: url("app", "Q7mV2xL9pR4sT1wZ8kN3bF6h"),
    extensions: ["vector", "pg_trgm"],
    protected: true,
    expiresAt: null,
    sizeBytes: 184_000_000,
    lastConnectedAt: ago(0.02),
    createdAt: ago(41),
  },
  {
    kind: "database",
    engine: "postgresql",
    version: "18",
    id: "blog",
    name: "blog",
    description: "",
    connectionUrl: url("blog", "d4Hn8sK2mP6vX1qL9wR3tY7c"),
    extensions: [],
    protected: false,
    expiresAt: null,
    sizeBytes: 23_500_000,
    lastConnectedAt: ago(3),
    createdAt: ago(12),
  },
  {
    kind: "database",
    engine: "postgresql",
    version: "18",
    id: "scratch",
    name: "scratch",
    description: "Trying drizzle migrations. Goes away this weekend",
    connectionUrl: url("scratch", "b2Nf5jT8rW1xC4mK7pL0sV9z"),
    extensions: ["uuid-ossp"],
    protected: false,
    expiresAt: new Date(Date.now() + 2 * DAY_MS).toISOString(),
    sizeBytes: 7_800_000,
    lastConnectedAt: null,
    createdAt: ago(1),
  },
  {
    kind: "database",
    engine: "mysql",
    version: "8.4",
    id: "shop",
    name: "shop_dev",
    description: "Local storefront development",
    connectionUrl: `mysql://evertap_shop:demo_mysql_password@${DATABASE_HOST}:${DATABASE_PORTS.mysql}/evertap_shop`,
    extensions: [],
    protected: false,
    expiresAt: null,
    sizeBytes: 48_000_000,
    lastConnectedAt: ago(0.5),
    createdAt: ago(8),
  },
  {
    kind: "database",
    engine: "redis",
    version: "8.2",
    id: "sessions",
    name: "sessions",
    description: "Session cache for local development",
    connectionUrl: `redis://evertap_sessions:demo_redis_password@${DATABASE_HOST}:${DATABASE_PORTS.redis}/0`,
    extensions: [],
    protected: false,
    expiresAt: null,
    sizeBytes: 1_250_000,
    lastConnectedAt: ago(0.01),
    createdAt: ago(7),
  },
  {
    kind: "object-storage",
    engine: "garage",
    id: "uploads",
    name: "app-uploads",
    description: "Files uploaded during development",
    endpoint: bucketEndpoint("garage"),
    region: STORAGE_REGION,
    accessKeyId: "DEMO_UPLOADS_ACCESS_KEY",
    secretAccessKey: "demo_uploads_secret_access_key",
    reachableAnywhere: true,
    // Derived from the settings on read.
    publicEndpoint: null,
    protected: false,
    expiresAt: null,
    sizeBytes: 320_000_000,
    lastConnectedAt: ago(0.25),
    createdAt: ago(6),
  },
  {
    kind: "object-storage",
    engine: "garage",
    id: "assets",
    name: "static-assets",
    description: "Shared assets for local projects",
    endpoint: bucketEndpoint("garage"),
    region: STORAGE_REGION,
    accessKeyId: "DEMO_ASSETS_ACCESS_KEY",
    secretAccessKey: "demo_assets_secret_access_key",
    reachableAnywhere: false,
    publicEndpoint: null,
    protected: true,
    expiresAt: null,
    sizeBytes: 86_000_000,
    lastConnectedAt: ago(1),
    createdAt: ago(5),
  },
];

const SAMPLE_CLIENTS: Client[] = [
  {
    id: "macbook",
    kind: "cli",
    name: "work-macbook",
    lastUsedAt: ago(0.02),
    lastUsedIp: "192.168.1.23",
    createdAt: ago(40),
  },
  {
    id: "desktop",
    kind: "cli",
    name: "home-desktop",
    lastUsedAt: ago(9),
    lastUsedIp: "192.168.1.40",
    createdAt: ago(21),
  },
  {
    id: "phone",
    kind: "browser",
    name: "Safari on iOS",
    lastUsedAt: ago(1),
    lastUsedIp: "192.168.1.31",
    createdAt: ago(30),
  },
  {
    id: "actions",
    kind: "api-key",
    name: "github-actions",
    lastUsedAt: ago(2),
    // A documentation address (RFC 5737): CI calls from outside the LAN.
    lastUsedIp: "203.0.113.77",
    createdAt: ago(14),
  },
];

// No CLI exists yet to ask, so one request stays open for the approval page.
const SAMPLE_PAIRINGS: Pairing[] = [
  {
    code: DEMO_PAIRING_CODE,
    kind: "cli",
    name: "thinkpad",
    requestedAt: ago(0.001),
    expiresAt: new Date(Date.now() + 365 * DAY_MS).toISOString(),
    source: "192.168.1.42",
  },
];

// Behind a proxy on this machine, so Settings can show both a change it allows (to the LAN, or a
// tunnel) and one it refuses (local, which stops listening where the proxy reaches).
const SAMPLE_SETTINGS: SavedSettings = {
  mode: "network",
  publicUrl: "https://evertap.example.com",
  listenHost: "127.0.0.1",
  storageUrl: STORAGE_URL_EXAMPLE,
};

/** The contrib set the image ships, as `pg_available_extensions` reports it (name + comment). */
const SAMPLE_EXTENSIONS: Extension[] = [
  { name: "vector", description: "vector data type and ivfflat and hnsw access methods" },
  {
    name: "pg_trgm",
    description: "text similarity measurement and index searching based on trigrams",
  },
  { name: "pgcrypto", description: "cryptographic functions" },
  { name: "uuid-ossp", description: "generate universally unique identifiers (UUIDs)" },
  { name: "hstore", description: "data type for storing sets of (key, value) pairs" },
  { name: "citext", description: "data type for case-insensitive character strings" },
  { name: "ltree", description: "data type for hierarchical tree-like structures" },
  { name: "btree_gin", description: "support for indexing common datatypes in GIN" },
  { name: "btree_gist", description: "support for indexing common datatypes in GiST" },
  {
    name: "pg_stat_statements",
    description: "track planning and execution statistics of all SQL statements executed",
  },
  { name: "unaccent", description: "text search dictionary that removes accents" },
  { name: "fuzzystrmatch", description: "determine similarities and distance between strings" },
  { name: "tablefunc", description: "functions that manipulate whole tables, including crosstab" },
  {
    name: "intarray",
    description: "functions, operators, and index support for 1-D arrays of integers",
  },
  { name: "cube", description: "data type for multidimensional cubes" },
  {
    name: "earthdistance",
    description: "calculate great-circle distances on the surface of the Earth",
  },
  { name: "isn", description: "data types for international product numbering standards" },
  {
    name: "seg",
    description: "data type for representing line segments or floating-point intervals",
  },
  { name: "bloom", description: "bloom access method - signature file based index" },
  { name: "dblink", description: "connect to other PostgreSQL databases from within a database" },
  { name: "postgres_fdw", description: "foreign-data wrapper for remote PostgreSQL servers" },
  { name: "file_fdw", description: "foreign-data wrapper for flat file access" },
  { name: "amcheck", description: "functions for verifying relation integrity" },
  { name: "pgstattuple", description: "show tuple-level statistics" },
  { name: "pg_buffercache", description: "examine the shared buffer cache" },
  { name: "pg_prewarm", description: "prewarm relation data" },
  { name: "pgrowlocks", description: "show row-level locking information" },
  { name: "pageinspect", description: "inspect the contents of database pages at a low level" },
  {
    name: "pg_visibility",
    description: "examine the visibility map (VM) and page-level visibility info",
  },
  { name: "pg_freespacemap", description: "examine the free space map (FSM)" },
  {
    name: "pg_walinspect",
    description: "functions to inspect contents of PostgreSQL Write-Ahead Log",
  },
  { name: "pg_surgery", description: "extension to perform surgery on a damaged relation" },
  { name: "lo", description: "Large Object maintenance" },
  { name: "moddatetime", description: "functions for tracking last modification time" },
  { name: "tcn", description: "Triggered change notifications" },
  {
    name: "tsm_system_rows",
    description: "TABLESAMPLE method which accepts number of rows as a limit",
  },
  {
    name: "tsm_system_time",
    description: "TABLESAMPLE method which accepts time in milliseconds as a limit",
  },
  { name: "dict_int", description: "text search dictionary template for integers" },
  {
    name: "dict_xsyn",
    description: "text search dictionary template for extended synonym processing",
  },
  { name: "sslinfo", description: "information about SSL certificates" },
  { name: "xml2", description: "XPath querying and XSLT" },
];

/** The store behind `EVERTAP_DEMO=1`: sample rows in memory, nothing started. */
export const createDemoStore = (version: string, settings: SettingsEnvironment) =>
  createMemoryStore({
    version,
    host: DATABASE_HOST,
    port: DATABASE_PORTS.postgresql,
    mysqlPort: DATABASE_PORTS.mysql,
    redisPort: DATABASE_PORTS.redis,
    machine: () => readMachine(config.dataDir),
    extensions: SAMPLE_EXTENSIONS,
    seed: SAMPLE,
    clients: SAMPLE_CLIENTS,
    pairings: SAMPLE_PAIRINGS,
    settings,
    savedSettings: SAMPLE_SETTINGS,
  });
