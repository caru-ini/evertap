import { z } from "zod";

import {
  ACCESS_CHOICES,
  ACCESS_MODES,
  CLIENT_NAME_MAX,
  DATABASE_ENGINES,
  DATABASE_VERSIONS,
  DESCRIPTION_MAX,
  LISTEN_USES,
  RESOURCE_ENGINES,
  STORAGE_ENGINES,
  STORAGE_URL_EXAMPLE,
  TUNNEL_PHASES,
  isDatabaseEngine,
  resourceNameError,
  zoneOf,
} from "./rules.ts";

/** One row of `pg_available_extensions`: what this instance can enable. */
export const extensionSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export type Extension = z.infer<typeof extensionSchema>;

const resourceFields = {
  id: z.string(),
  name: z.string(),
  description: z.string(),
  /** Delete protection. MCP may only delete when this is false. */
  protected: z.boolean(),
  /**
   * Set only on temporary resources: when evertap deletes it unless a connection pushes the time
   * forward. `null` means permanent; presence of the time is what "temporary" means.
   */
  expiresAt: z.iso.datetime().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  lastConnectedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
};

export const databaseSchema = z.object({
  ...resourceFields,
  kind: z.literal("database"),
  engine: z.enum(DATABASE_ENGINES),
  /** Major version, one of `DATABASE_VERSIONS` for the engine when it was created. */
  version: z.string(),
  connectionUrl: z.string(),
  extensions: z.array(z.string()),
});

export type Database = z.infer<typeof databaseSchema>;

export const objectStorageSchema = z.object({
  ...resourceFields,
  kind: z.literal("object-storage"),
  engine: z.enum(STORAGE_ENGINES),
  endpoint: z.string(),
  region: z.string(),
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  /** Signed links to it work on any device, through `publicEndpoint`. They still need a signature. */
  reachableAnywhere: z.boolean(),
  /**
   * Where to sign links that work on any device: set while `reachableAnywhere` is on and buckets
   * have an address of their own. Every other call keeps to `endpoint`.
   */
  publicEndpoint: z.string().nullable(),
});

export type ObjectStorage = z.infer<typeof objectStorageSchema>;

export const resourceSchema = z.discriminatedUnion("kind", [databaseSchema, objectStorageSchema]);

export type Resource = z.infer<typeof resourceSchema>;

export const createResourceInputSchema = z
  .object({
    engine: z.enum(RESOURCE_ENGINES).default("postgresql"),
    name: z.string().trim(),
    description: z.string().trim().max(DESCRIPTION_MAX).default(""),
    /** Databases only; omitted means the newest version. */
    version: z.string().optional(),
    extensions: z.array(z.string().trim().min(1)).default([]),
    /** Meant for agents: the resource expires after a week without a connection unless kept. */
    temporary: z.boolean().default(false),
  })
  .superRefine((input, ctx) => {
    const error = resourceNameError(input.name, input.engine);
    if (error) {
      ctx.addIssue({ code: "custom", message: error, path: ["name"] });
    }
    if (input.version !== undefined) {
      if (!isDatabaseEngine(input.engine)) {
        ctx.addIssue({
          code: "custom",
          message: "Buckets have no version. Remove the version",
          path: ["version"],
        });
      } else if (!DATABASE_VERSIONS[input.engine].some((version) => version === input.version)) {
        ctx.addIssue({
          code: "custom",
          message: `Choose one of ${DATABASE_VERSIONS[input.engine].join(", ")}`,
          path: ["version"],
        });
      }
    }
    if (input.engine !== "postgresql" && input.extensions.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "Extensions are available for PostgreSQL only. Clear the extension selection",
        path: ["extensions"],
      });
    }
  });

export type CreateResourceInput = z.infer<typeof createResourceInputSchema>;

export const capacitySchema = z.object({
  totalBytes: z.number().int().nonnegative(),
  freeBytes: z.number().int().nonnegative(),
});

export type Capacity = z.infer<typeof capacitySchema>;

/** The machine evertap runs on, shown in the sidebar footer. */
export const machineUsageSchema = z.object({
  disk: capacitySchema,
  memory: capacitySchema,
  cpu: z.object({
    /** Busy share across all cores since the previous read. */
    usedRatio: z.number().min(0).max(1),
    cores: z.number().int().nonnegative(),
  }),
});

export type MachineUsage = z.infer<typeof machineUsageSchema>;

/**
 * A newer stable release than this evertap, as its daily check last found. Null when there is none,
 * or when it does not check: in the demo, run from source, or with `EVERTAP_UPDATE_CHECK=0`.
 */
export const updateSchema = z.object({
  version: z.string(),
  /** The release's page. */
  url: z.string(),
  /** How to upgrade where evertap runs. */
  advice: z.string(),
});

export type Update = z.infer<typeof updateSchema>;

export const systemStatusSchema = machineUsageSchema.extend({
  /** evertap's own version: a release, or `dev` when run from source. */
  version: z.string(),
  update: updateSchema.nullable(),
  mode: z.enum(["demo", "live"]),
  /** The LAN name (`evertap.local`); database URLs name `ev.internal` instead. */
  host: z.string(),
  /** Engines that can be created right now; the others are not available on this box yet. */
  engines: z.array(z.enum(RESOURCE_ENGINES)),
});

export type SystemStatus = z.infer<typeof systemStatusSchema>;

export const listenHostSchema = z.union([z.ipv4(), z.ipv6()], {
  error: "Give an IP address of this machine, such as 127.0.0.1, or 0.0.0.0 for every interface",
});

const originSchema = (what: string, example: string) =>
  z
    .url({ protocol: /^https?$/, error: `Give the address ${what}, such as ${example}` })
    .refine((url) => {
      // Runs even when the check above failed.
      if (!URL.canParse(url)) {
        return true;
      }
      const { pathname, search, hash } = new URL(url);
      return pathname === "/" && search === "" && hash === "";
    }, `Give the address without a path, such as ${example}`)
    .transform((url) => new URL(url).origin);

/** The UI is served from the root, so an origin alone. */
export const publicUrlSchema = originSchema(
  "browsers open evertap at",
  "https://evertap.example.com",
);

/** An origin alone: a path would change what requests sign, and break their signatures. */
export const storageUrlSchema = originSchema(
  "your proxy or tunnel serves buckets at",
  STORAGE_URL_EXAMPLE,
);

/**
 * A Cloudflare Tunnel evertap made with access the person gave it, which evertap did not keep:
 * enough to run it, and to change or remove it with access given again.
 */
export const tunnelSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  zoneId: z.string(),
  /** The domain its names are in, such as example.com. */
  zone: z.string(),
  /** The names it serves, which the person chose: evertap's own, and buckets'. */
  hostnames: z.object({ ui: z.string(), storage: z.string() }),
  /** The DNS records setup made for those names. */
  dnsRecordIds: z.array(z.string()),
  /** The Cache Rule that keeps Cloudflare from caching the S3 entry's answers. */
  cacheRule: z.object({ rulesetId: z.string(), ruleId: z.string() }),
  /** What cloudflared runs the tunnel with. Anyone holding it can serve the tunnel's names. */
  token: z.string(),
});

export type Tunnel = z.infer<typeof tunnelSchema>;

/**
 * The access settings kept in the data directory, one shape per mode. A mode keeps only what it
 * lets the person choose; the rest follows from the mode.
 */
export const savedSettingsSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("network"),
    /** Null takes `http://<listen address>:<port>`, or the LAN address for every interface. */
    publicUrl: publicUrlSchema.nullable(),
    /** 127.0.0.1 behind a proxy on this machine, 0.0.0.0 for the LAN. */
    listenHost: listenHostSchema,
    /** Where the proxy serves buckets reached from anywhere; null until the person gives one. */
    storageUrl: storageUrlSchema.nullable().default(null),
  }),
  z.object({
    mode: z.literal("cloudflare"),
    publicUrl: publicUrlSchema,
    /**
     * The tunnel evertap runs, which serves buckets at its own name for them. A tunnel the person
     * runs is `network` mode behind their own proxy.
     */
    tunnel: tunnelSchema,
  }),
  z.object({ mode: z.literal("local") }),
]);

export type SavedSettings = z.infer<typeof savedSettingsSchema>;

const setting = <T extends z.ZodType>(value: T) =>
  z.object({ value, source: z.enum(["env", "saved", "default"]) });

/**
 * The access settings in force, each with where it came from: its environment variable
 * (`SETTING_VARIABLES`), the saved settings, or the mode's default.
 */
export const settingsSchema = z.object({
  /** Null until evertap is set up. */
  mode: setting(z.enum(ACCESS_MODES).nullable()),
  /** Where browsers open evertap, and so where sign-in links point; null when it cannot tell. */
  publicUrl: setting(z.string().nullable()),
  /** Where the UI listens. */
  listenHost: setting(z.string()),
  /** The tunnel evertap runs, without what runs it; null when it runs none. */
  tunnel: tunnelSchema.omit({ token: true }).nullable(),
  /**
   * Where buckets reached from anywhere are served: the person's address for them, or the name a
   * tunnel evertap made serves them at. Null outside the modes that other machines reach evertap in.
   */
  storageUrl: setting(z.string().nullable()),
});

export type Settings = z.infer<typeof settingsSchema>;

/** Where a Cloudflare Tunnel on this machine sends each of the names it serves. */
export const tunnelOriginsSchema = z.object({
  /** The UI, as `http://127.0.0.1:8080`. */
  ui: z.string(),
  /** The public S3 entry. */
  storage: z.string(),
});

export type TunnelOrigins = z.infer<typeof tunnelOriginsSchema>;

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A name as typed, as DNS writes it: lowercase, without a scheme, a slash, or the final dot. */
const typedName = (typed: string) =>
  typed
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .replace(/\.$/, "");

/** Why `name` cannot be a name of the tunnel, or null. */
const nameProblem = (name: string, example: string) => {
  const labels = name.split(".");
  if (name.length > 253 || !labels.every((label) => LABEL.test(label))) {
    return `Use letters, digits, and hyphens between dots, such as ${example}`;
  }
  // The domain itself, or a name with no domain under it.
  return labels.length < 3 ? `Give a name under your domain, such as ${example}` : null;
};

/**
 * The names a tunnel evertap makes serves, as the person gives them: evertap's own, and buckets',
 * which without one is `s3.` in the same domain. Each sits one label under the domain, as Universal
 * SSL covers no deeper, so the two share it.
 */
export const tunnelNamesSchema = z
  .object({ ui: z.string(), storage: z.string().nullish() })
  .transform(({ ui, storage }, context) => {
    const name = typedName(ui);
    const problem = nameProblem(name, "evertap.example.com");
    if (problem) {
      context.addIssue({ code: "custom", message: problem, path: ["ui"] });
      return z.NEVER;
    }
    const zone = zoneOf(name);
    const other = name === `s3.${zone}` ? `files.${zone}` : `s3.${zone}`;
    const buckets = storage?.trim() ? typedName(storage) : `s3.${zone}`;
    const refusal =
      nameProblem(buckets, other) ??
      (zoneOf(buckets) === zone
        ? buckets === name
          ? `Give buckets a name of their own, such as ${other}`
          : null
        : `Give buckets a name in ${zone}, such as ${other}`);
    if (refusal) {
      context.addIssue({ code: "custom", message: refusal, path: ["storage"] });
      return z.NEVER;
    }
    return { ui: name, storage: buckets };
  });

export type TunnelNames = z.output<typeof tunnelNamesSchema>;

/** What a person does to the tunnel evertap runs, with access they give it in Cloudflare. */
export const tunnelChangeSchema = z.discriminatedUnion("action", [
  /** Makes the tunnel for `names`, or moves the one evertap runs to them. */
  z.object({ action: z.literal("set-up"), names: tunnelNamesSchema }),
  /** Puts `next` in force, then removes the tunnel evertap ran from Cloudflare. */
  z.object({ action: z.literal("remove"), next: savedSettingsSchema }),
]);

export type TunnelChange = z.infer<typeof tunnelChangeSchema>;

/** A change as the person gives it, before its names are checked and filled in. */
export type TunnelChangeInput = z.input<typeof tunnelChangeSchema>;

/** How a change with Cloudflare went, besides the settings it put in force. */
export const tunnelResultSchema = z.object({
  /**
   * What evertap made in Cloudflare and could not remove once unused, with why, for the person to
   * remove; null when nothing was left.
   */
  left: z.object({ tunnel: tunnelSchema.omit({ token: true }), reason: z.string() }).nullable(),
  /**
   * False when Cloudflare did not confirm it took back the access the person gave evertap. Null
   * while evertap still removes the tunnel or its old names, which it does once the answer has
   * gone out through it.
   */
  revoked: z.boolean().nullable(),
});

export type TunnelResult = z.infer<typeof tunnelResultSchema>;

export const tunnelOutcomeSchema = tunnelResultSchema.extend({
  settings: settingsSchema,
  /**
   * A one-time link that signs this browser in at the new address, when the change leaves it no
   * way back to evertap at the one it came from and another machine can open that address.
   */
  signIn: z.string().nullable(),
});

export type TunnelOutcome = z.infer<typeof tunnelOutcomeSchema>;

/** Where the person's change to the tunnel is; null while none of theirs runs. */
export const tunnelProgressSchema = z.object({ phase: z.enum(TUNNEL_PHASES).nullable() });

/** What putting settings in force would do, before anything moves. */
export const settingsPreviewSchema = z.object({
  settings: settingsSchema,
  /** Whether it leaves this browser without its way in, at the address it came to evertap at. */
  cutOff: z.boolean(),
});

export type SettingsPreview = z.infer<typeof settingsPreviewSchema>;

/** The settings a change put in force. */
export const settingsUpdateSchema = z.object({
  settings: settingsSchema,
  /** As `tunnelOutcomeSchema` has it. */
  signIn: z.string().nullable(),
});

/** What choosing network mode needs to know about this machine, and what goes in front of it. */
export const networkGuideSchema = z.object({
  /** Where the UI can listen in network mode, in the order to offer them. */
  listenChoices: z.array(
    z.object({
      /** Docker's bridge is offered only where Docker has one. */
      use: z.enum(LISTEN_USES),
      address: z.string(),
      /** The URL's default there; null when it cannot tell. */
      defaultUrl: z.string().nullable(),
      /** A public address listening there opens the UI on, to warn about; null when none. */
      exposes: z.string().nullable(),
    }),
  ),
  /** A public address the UI answers on where it listens now; null when none. */
  exposedAt: z.string().nullable(),
  /** Where this computer opens evertap in local mode. */
  localUrl: z.string(),
  /**
   * What to paste into a reverse proxy in front of evertap. Null outside network mode, and when
   * the URL reaches evertap's own listener with no proxy between.
   */
  proxy: z
    .object({
      /** Where the proxy sends requests: the UI's own address. */
      upstream: z.string(),
      caddy: z.string(),
      nginx: z.string(),
    })
    .nullable(),
  /** The way in for buckets reached from anywhere. Null outside network and cloudflare modes. */
  buckets: z
    .object({
      /** Where the proxy or tunnel sends requests for buckets. */
      upstream: z.string(),
      /**
       * What to paste into a reverse proxy, for the address in force or `STORAGE_URL_EXAMPLE` until
       * one is given. Null in cloudflare mode, where the tunnel leads there.
       */
      proxy: z.object({ caddy: z.string(), nginx: z.string() }).nullable(),
    })
    .nullable(),
});

export type NetworkGuide = z.infer<typeof networkGuideSchema>;

/** Whether the URL in force reaches this evertap, as evertap itself tried it. */
export const reachSchema = z.object({
  url: z.string(),
  /** `elsewhere`: something answered there, but not this evertap. */
  result: z.enum(["reached", "elsewhere", "unreachable"]),
  /** What to do, one sentence each: to reach evertap at all, or what the proxy should pass on. */
  problems: z.array(z.string()),
});

export type Reach = z.infer<typeof reachSchema>;

/**
 * What `system.doctor` checks. Fields marked "local only" are filled only over the local Unix
 * socket; a caller over the network gets the rest.
 */
export const doctorReportSchema = z.object({
  /** evertap's own version: a release, or `dev` when run from source. */
  version: z.string(),
  update: updateSchema.nullable(),
  /** Null in demo mode, which starts nothing. */
  docker: z
    .object({
      reachable: z.boolean(),
      /** Docker Engine's own version. */
      version: z.string().optional(),
      /** The Engine API version evertap speaks, the newest that both sides support. */
      apiVersion: z.string(),
      /** Local only. */
      socket: z.string().optional(),
      /** What about this Docker install puts evertap at risk, each saying what to do. */
      warnings: z.array(
        z.object({ kind: z.enum(["outdated", "snap", "rootless"]), message: z.string() }),
      ),
    })
    .nullable(),
  /** Empty in demo mode. */
  engines: z.array(
    z.object({
      engine: z.enum(RESOURCE_ENGINES),
      state: z.enum(["starting", "ready", "failed", "unavailable"]),
      /** Why it failed to start. Local only. */
      error: z.string().optional(),
    }),
  ),
  machine: machineUsageSchema,
  /** Where browsers open evertap from; null until it is set up, when only this machine can. */
  access: z.enum(ACCESS_CHOICES).nullable(),
  /** The Cloudflare Tunnel evertap runs; null when it runs none, as in demo mode. */
  tunnel: z
    .object({
      /** The name browsers open evertap at through it. */
      hostname: z.string(),
      /** `connecting`: cloudflared runs but has no link to Cloudflare yet. */
      state: z.enum(["connected", "connecting", "stopped"]),
      /** Links to Cloudflare that are up, as cloudflared counts them. */
      connections: z.number().int().nonnegative(),
      /** Why cloudflared could not start. Local only. */
      error: z.string().optional(),
    })
    .nullable(),
  /** Local only. */
  dataDir: z.string().optional(),
  /**
   * How this machine resolves the name evertap is reached by: `ev.internal` in local mode, the LAN
   * name otherwise when it was set or evertap is opened at it. Null in demo mode, for an IP, or when
   * no name is checked.
   */
  lan: z.object({ host: z.string(), addresses: z.array(z.string()) }).nullable(),
  /** Whether each engine's entry answers on this machine. Empty in demo mode. */
  entries: z.array(
    z.object({ engine: z.enum(RESOURCE_ENGINES), address: z.string(), reachable: z.boolean() }),
  ),
  /**
   * The person's own Docker containers that publish where one of evertap's listeners is: a running
   * one keeps evertap from listening, a stopped one cannot start while evertap runs. Empty in demo
   * mode.
   */
  conflicts: z.array(
    z.object({
      name: z.string(),
      /** evertap's listener it clashes with. */
      address: z.string(),
      running: z.boolean(),
      /** What it does to evertap or evertap to it, and what to do. */
      message: z.string(),
    }),
  ),
});

export type DoctorReport = z.infer<typeof doctorReportSchema>;

/**
 * What may call evertap: a paired CLI, an API key, or a signed-in browser. Browsers act for a
 * person; the other two are clients and cannot approve or revoke anything.
 */
export const clientSchema = z.object({
  id: z.string(),
  kind: z.enum(["cli", "api-key", "browser"]),
  /**
   * A CLI reports its machine's name, a browser is named from its user agent, and an API key is
   * named by the person who creates it.
   */
  name: z.string(),
  lastUsedAt: z.iso.datetime().nullable(),
  /** Where the last call came from, so a call from an unexpected place stands out. */
  lastUsedIp: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export type Client = z.infer<typeof clientSchema>;

/** A CLI or a browser waiting for a person to approve the code it shows. */
export const pairingSchema = z.object({
  code: z.string(),
  kind: z.enum(["cli", "browser"]),
  name: z.string(),
  requestedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  /**
   * The requester's address, so a code passed on by someone else (RFC 8628's remote phishing)
   * shows where it came from; null for the machine running evertap.
   */
  source: z.string().nullable(),
});

export type Pairing = z.infer<typeof pairingSchema>;

/** What the requester keeps: `requestId` is the secret it polls with and never shows. */
export const startedPairingSchema = z.object({
  code: z.string(),
  expiresAt: z.iso.datetime(),
  requestId: z.string(),
});

export type StartedPairing = z.infer<typeof startedPairingSchema>;

export const claimStatusSchema = z.enum(["pending", "approved", "denied", "expired"]);

export type ClaimStatus = z.infer<typeof claimStatusSchema>;

export const clientNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name")
  .max(CLIENT_NAME_MAX, `Use ${CLIENT_NAME_MAX} characters or fewer`);

/** The only time the key itself leaves evertap. */
export const createdApiKeySchema = z.object({
  client: clientSchema,
  key: z.string(),
});

export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;

/** A value as the data browser shows it; dates, JSON and bytes arrive as text. */
export const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export type Cell = z.infer<typeof cellSchema>;

/** PostgreSQL schema or MySQL database, plus the table's name. */
export const tableRefSchema = z.object({
  schema: z.string().min(1),
  name: z.string().min(1),
});

export type TableRef = z.infer<typeof tableRefSchema>;

export const tableSchema = tableRefSchema.extend({
  kind: z.enum(["table", "view"]),
  /** The planner's estimate; exact counts are too slow on large tables. */
  rowEstimate: z.number().int().nullable(),
});

export type Table = z.infer<typeof tableSchema>;

export const columnSchema = z.object({
  name: z.string(),
  /** The engine's own spelling, such as `character varying(40)` or `int unsigned`. */
  type: z.string(),
  nullable: z.boolean(),
  primaryKey: z.boolean(),
  /** The default expression, or null when the column has none. */
  default: z.string().nullable(),
});

export type Column = z.infer<typeof columnSchema>;

export const ROW_PAGE_MAX = 500;

export const rowFilterSchema = z.object({
  column: z.string().min(1),
  op: z.enum(["eq", "neq", "lt", "gt", "contains", "null", "not-null"]),
  /** Ignored by `null` and `not-null`. */
  value: z.string().default(""),
});

export type RowFilter = z.infer<typeof rowFilterSchema>;

export const readRowsInputSchema = z.object({
  id: z.string().min(1),
  table: tableRefSchema,
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(ROW_PAGE_MAX).default(100),
  sort: z.object({ column: z.string().min(1), direction: z.enum(["asc", "desc"]) }).optional(),
  filters: z.array(rowFilterSchema).max(10).default([]),
});

export type ReadRowsInput = z.infer<typeof readRowsInputSchema>;

export const rowsSchema = z.object({
  columns: z.array(columnSchema),
  /** Each row lists its cells in `columns` order. */
  rows: z.array(z.array(cellSchema)),
  /** Rows matching the filters. */
  total: z.number().int().nonnegative(),
});

export type Rows = z.infer<typeof rowsSchema>;

/** Primary-key values that pick one row; tables without a primary key are read-only. */
export const rowKeySchema = z.record(z.string(), cellSchema);

export type RowKey = z.infer<typeof rowKeySchema>;

/** Column → new value as text (the engine casts it), or null. */
export const rowValuesSchema = z.record(z.string(), z.string().nullable());

export type RowValues = z.infer<typeof rowValuesSchema>;

/**
 * Edits staged in the browser, saved together in one transaction: all apply or none do. They run
 * as updates, then deletes, then inserts. Rows are picked by primary key, so tables without one
 * and views refuse every change.
 */
export const rowChangesSchema = z
  .object({
    updates: z
      .array(
        z.object({
          key: rowKeySchema,
          values: rowValuesSchema.refine((values) => Object.keys(values).length > 0, {
            message: "Change at least one value",
          }),
        }),
      )
      .max(ROW_PAGE_MAX)
      .default([]),
    deletes: z.array(rowKeySchema).max(ROW_PAGE_MAX).default([]),
    /** Omitted columns keep their defaults. */
    inserts: z.array(rowValuesSchema).max(ROW_PAGE_MAX).default([]),
  })
  .refine(
    (changes) => changes.updates.length + changes.deletes.length + changes.inserts.length > 0,
    { message: "Make a change first" },
  );

export type RowChanges = z.infer<typeof rowChangesSchema>;

export const appliedChangesSchema = z.object({
  updated: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
  inserted: z.number().int().nonnegative(),
});

export type AppliedChanges = z.infer<typeof appliedChangesSchema>;

export const QUERY_ROWS_MAX = 1000;

export const queryResultSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(cellSchema)),
  /** Rows returned or changed, when the engine reports it. */
  rowCount: z.number().int().nullable(),
  /** More than `QUERY_ROWS_MAX` rows came back; the rest were dropped. */
  truncated: z.boolean(),
  durationMs: z.number().nonnegative(),
});

export type QueryResult = z.infer<typeof queryResultSchema>;

export const REDIS_SCAN_MAX = 500;
export const REDIS_VALUE_MAX = 1000;
export const REDIS_STRING_MAX = 1_000_000;

export const redisKeySummarySchema = z.object({
  key: z.string(),
  type: z.string(),
  /** Milliseconds left, or null when the key never expires. */
  ttlMs: z.number().int().nullable(),
});

export type RedisKeySummary = z.infer<typeof redisKeySummarySchema>;

export const scanKeysInputSchema = z.object({
  id: z.string().min(1),
  pattern: z.string().min(1).default("*"),
  /** `0` starts a scan; the response's `cursor` continues it until it comes back as `0`. */
  cursor: z.string().default("0"),
  count: z.number().int().min(1).max(REDIS_SCAN_MAX).default(100),
});

export type ScanKeysInput = z.infer<typeof scanKeysInputSchema>;

export const scanKeysResultSchema = z.object({
  keys: z.array(redisKeySummarySchema),
  cursor: z.string(),
});

export type ScanKeysResult = z.infer<typeof scanKeysResultSchema>;

/** A value in one of the types the browser can edit; anything else is shown as read-only. */
export const redisValueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("string"), value: z.string() }),
  z.object({
    type: z.literal("hash"),
    entries: z.array(z.object({ field: z.string(), value: z.string() })),
  }),
  z.object({ type: z.literal("list"), items: z.array(z.string()) }),
  z.object({ type: z.literal("set"), members: z.array(z.string()) }),
  z.object({
    type: z.literal("zset"),
    members: z.array(z.object({ member: z.string(), score: z.number() })),
  }),
]);

export type RedisValue = z.infer<typeof redisValueSchema>;

export const redisKeySchema = z.object({
  key: z.string(),
  ttlMs: z.number().int().nullable(),
  /**
   * Null when the browser cannot edit it safely: streams and module types, values that are not
   * UTF-8 text, strings over `REDIS_STRING_MAX` bytes, infinite sorted-set scores.
   */
  value: redisValueSchema.nullable(),
  type: z.string(),
  /** Only the first `REDIS_VALUE_MAX` elements came back. */
  truncated: z.boolean(),
});

export type RedisKey = z.infer<typeof redisKeySchema>;

export const writeKeyInputSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  /** Replaces the whole value. */
  value: redisValueSchema,
  /** Milliseconds until expiry; null keeps the key forever. */
  ttlMs: z.number().int().positive().nullable(),
  /** Refuse instead of replacing when the key already exists. */
  createOnly: z.boolean().default(false),
});

export type WriteKeyInput = z.infer<typeof writeKeyInputSchema>;

export const expireKeyInputSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  /** Milliseconds until expiry; null removes the expiry. The value is left as it is. */
  ttlMs: z.number().int().positive().nullable(),
});

export type ExpireKeyInput = z.infer<typeof expireKeyInputSchema>;

/** Objects and folders shown per page of a bucket's listing. */
export const OBJECT_PAGE_SIZE = 200;
/**
 * Bytes per request when the browser uploads a file through evertap: under the 100 MB a request
 * through Cloudflare may carry and quick to answer within its 125 s, while S3's 10,000 parts still
 * reach 168 GB.
 */
export const OBJECT_PART_SIZE = 16 * 1024 * 1024;
export const OBJECT_PARTS_MAX = 10_000;

/** The largest call evertap reads: one upload part and room for the rest of the call. */
export const RPC_BODY_MAX = OBJECT_PART_SIZE + 1024 * 1024;

export const storedObjectSchema = z.object({
  key: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  lastModified: z.iso.datetime(),
  /** The stored Content-Type; null when the bucket keeps none. */
  contentType: z.string().nullable(),
});

export type StoredObject = z.infer<typeof storedObjectSchema>;

/**
 * One of a bucket resource's buckets: its first, or one an app made with its key, which S3 lets
 * hold dots. Omitted means the first.
 */
export const bucketNameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, "Choose one of this resource's buckets");

export const listObjectsInputSchema = z.object({
  id: z.string().min(1),
  bucket: bucketNameSchema.optional(),
  /** Empty for the bucket's top level; otherwise ends with `/`. */
  prefix: z.string().default(""),
  /** From the previous page's `cursor`; omitted for the first page. */
  cursor: z.string().optional(),
});

export type ListObjectsInput = z.infer<typeof listObjectsInputSchema>;

export const objectListSchema = z.object({
  /** Full prefixes of the folders directly under `prefix`, each ending with `/`. */
  folders: z.array(z.string()),
  objects: z.array(storedObjectSchema),
  /** Null on the last page. */
  cursor: z.string().nullable(),
});

export type ObjectList = z.infer<typeof objectListSchema>;

export const objectKeySchema = z
  .string()
  .min(1, "Enter a name")
  .max(1024)
  // URLs drop `.` and `..` segments, so such a key would reach another object or none.
  .refine(
    (key) => !key.split("/").some((segment) => segment === "." || segment === ".."),
    "Remove the . and .. folders from the name",
  );

export const partNumberSchema = z.number().int().min(1).max(OBJECT_PARTS_MAX);

export const completedPartSchema = z.object({
  partNumber: partNumberSchema,
  /** The ETag the bucket answered the part's upload with, quotes included. */
  etag: z.string().min(1),
});

export type CompletedPart = z.infer<typeof completedPartSchema>;
