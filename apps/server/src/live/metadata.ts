import { Database as Sqlite } from "bun:sqlite";

import { DATABASE_ENGINES, DATABASE_HOST, DATABASE_PORTS } from "@evertap/api/rules";
import {
  type SavedSettings,
  clientSchema,
  databaseSchema,
  objectStorageSchema,
  pairingSchema,
  savedSettingsSchema,
} from "@evertap/api/schemas";
import type { ClientRecord, ClientTables, RequestRecord } from "@evertap/api/store/clients";
import { customAlphabet } from "nanoid";
import { z } from "zod";

const newSecret = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  32,
);

/** A resource as stored: a bucket's endpoints and region are derived on read, so a row has none. */
const storedResourceSchema = z.discriminatedUnion("kind", [
  databaseSchema,
  objectStorageSchema
    .omit({ endpoint: true, publicEndpoint: true, region: true })
    // Rows from before the switch existed have none.
    .extend({ reachableAnywhere: z.boolean().default(false) }),
]);

export type StoredResource = z.infer<typeof storedResourceSchema>;

const parse = (row: { data: string }) => storedResourceSchema.parse(JSON.parse(row.data));

const clientRecordSchema = clientSchema.extend({
  tokenHash: z.string(),
  expiresAt: z.iso.datetime().nullable(),
  approvedBy: z.string().nullable(),
});
const requestRecordSchema = pairingSchema.extend({
  requestHash: z.string(),
  // Rows from before the cap per source have none.
  source: z.string().nullable().default(null),
  status: z.enum(["pending", "approved", "denied"]),
  clientId: z.string().nullable(),
});
const parseClient = (row: { data: string }): ClientRecord =>
  clientRecordSchema.parse(JSON.parse(row.data));
const parseRequest = (row: { data: string }): RequestRecord =>
  requestRecordSchema.parse(JSON.parse(row.data));

const storedDatabaseSchema = z.looseObject({
  kind: z.literal("database"),
  engine: z.enum(DATABASE_ENGINES),
  connectionUrl: z.string(),
});

/**
 * Each entry moves the file one version up (`PRAGMA user_version`). Only append: a shipped entry
 * never changes. Read rows as stored, not through today's schemas, which may not fit them yet.
 */
const MIGRATIONS: ((db: Sqlite) => void)[] = [
  // Files from before versions already have these tables.
  (db) => {
    db.run("CREATE TABLE IF NOT EXISTS resources (id TEXT PRIMARY KEY, data TEXT NOT NULL)");
    db.run("CREATE TABLE IF NOT EXISTS secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.run(
      "CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, data TEXT NOT NULL)",
    );
    db.run(
      "CREATE TABLE IF NOT EXISTS requests (code TEXT PRIMARY KEY, request_hash TEXT NOT NULL UNIQUE, data TEXT NOT NULL)",
    );
  },
  // Databases made before URLs named `ev.internal` pointed at the LAN name and the entry's port.
  (db) => {
    const rows = db.query<{ id: string; data: string }, []>("SELECT id, data FROM resources");
    const update = db.query<unknown, [string, string]>(
      "UPDATE resources SET data = ? WHERE id = ?",
    );
    for (const { id, data } of rows.all()) {
      const row = storedDatabaseSchema.safeParse(JSON.parse(data));
      if (!row.success) {
        continue;
      }
      const url = new URL(row.data.connectionUrl);
      const port = String(DATABASE_PORTS[row.data.engine]);
      if (url.hostname !== DATABASE_HOST || url.port !== port) {
        url.hostname = DATABASE_HOST;
        url.port = port;
        update.run(JSON.stringify({ ...row.data, connectionUrl: url.toString() }), id);
      }
    }
  },
  // Buckets stored the LAN name or a tunnel's hostname; their endpoint is now derived on read.
  (db) => {
    db.run(
      "UPDATE resources SET data = json_remove(data, '$.endpoint') WHERE json_extract(data, '$.kind') = 'object-storage'",
    );
  },
  // One row: the access settings, so the data directory alone brings back how evertap is reached.
  (db) => {
    db.run("CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)");
  },
];

/** Runs the pending migrations, each in its own transaction, after copying the file aside. */
const migrate = (db: Sqlite, path: string) => {
  const from =
    db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
  if (from > MIGRATIONS.length) {
    throw new Error(`${path} was written by a newer evertap. Update evertap to open it`);
  }
  if (from === MIGRATIONS.length) {
    return;
  }
  const tables = db.query<{ count: number }, []>("SELECT count(*) AS count FROM sqlite_schema");
  let backup: string | undefined;
  // A new file has nothing to keep.
  if ((tables.get()?.count ?? 0) > 0) {
    const stamp = new Date().toISOString().replaceAll(/[-:]/g, "");
    backup = `${path}.v${from}-${stamp}.bak`;
    db.run("VACUUM INTO ?", [backup]);
    console.log(`Copied ${path} to ${backup} before updating it`);
  }
  for (const [index, migration] of MIGRATIONS.slice(from).entries()) {
    const version = from + index + 1;
    try {
      db.transaction(() => {
        migration(db);
        db.run(`PRAGMA user_version = ${version}`);
      })();
    } catch (error) {
      const copy = backup ? `. A copy from before the update is at ${backup}` : "";
      throw new Error(`Could not update ${path}: migration ${version} failed${copy}`, {
        cause: error,
      });
    }
  }
};

/**
 * What evertap remembers across restarts: resources (with their credentials), admin secrets, who
 * may call it (token hashes only), and how it is reached.
 */
export type Metadata = ReturnType<typeof openMetadata>;

export const openMetadata = (path: string) => {
  const db = new Sqlite(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  try {
    migrate(db, path);
  } catch (error) {
    db.close();
    throw error;
  }

  const selectAll = db.query<{ data: string }, []>("SELECT data FROM resources");
  const selectOne = db.query<{ data: string }, [string]>("SELECT data FROM resources WHERE id = ?");
  const upsert = db.query<unknown, [string, string]>(
    "INSERT INTO resources (id, data) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data",
  );
  const removeOne = db.query<unknown, [string]>("DELETE FROM resources WHERE id = ?");
  const selectSecret = db.query<{ value: string }, [string]>(
    "SELECT value FROM secrets WHERE name = ?",
  );
  const insertSecret = db.query<unknown, [string, string]>(
    "INSERT INTO secrets (name, value) VALUES (?, ?)",
  );

  const allClients = db.query<{ data: string }, []>("SELECT data FROM clients");
  const clientById = db.query<{ data: string }, [string]>("SELECT data FROM clients WHERE id = ?");
  const clientByHash = db.query<{ data: string }, [string]>(
    "SELECT data FROM clients WHERE token_hash = ?",
  );
  const upsertClient = db.query<unknown, [string, string, string]>(
    "INSERT INTO clients (id, token_hash, data) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET token_hash = excluded.token_hash, data = excluded.data",
  );
  const removeClient = db.query<unknown, [string]>("DELETE FROM clients WHERE id = ?");
  const allRequests = db.query<{ data: string }, []>("SELECT data FROM requests");
  const requestByCode = db.query<{ data: string }, [string]>(
    "SELECT data FROM requests WHERE code = ?",
  );
  const requestByHash = db.query<{ data: string }, [string]>(
    "SELECT data FROM requests WHERE request_hash = ?",
  );
  const upsertRequest = db.query<unknown, [string, string, string]>(
    "INSERT INTO requests (code, request_hash, data) VALUES (?, ?, ?) ON CONFLICT (code) DO UPDATE SET request_hash = excluded.request_hash, data = excluded.data",
  );
  const removeRequest = db.query<unknown, [string]>("DELETE FROM requests WHERE code = ?");
  const selectSettings = db.query<{ data: string }, []>("SELECT data FROM settings WHERE id = 1");
  const upsertSettings = db.query<unknown, [string]>(
    "INSERT INTO settings (id, data) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data",
  );

  const clientTables: ClientTables = {
    listClients: () => allClients.all().map(parseClient),
    getClient: (id) => {
      const row = clientById.get(id);
      return row ? parseClient(row) : null;
    },
    findClient: (tokenHash) => {
      const row = clientByHash.get(tokenHash);
      return row ? parseClient(row) : null;
    },
    putClient: (record) => {
      upsertClient.run(record.id, record.tokenHash, JSON.stringify(record));
    },
    deleteClient: (id) => {
      removeClient.run(id);
    },
    listRequests: () => allRequests.all().map(parseRequest),
    getRequest: (code) => {
      const row = requestByCode.get(code);
      return row ? parseRequest(row) : null;
    },
    findRequest: (requestHash) => {
      const row = requestByHash.get(requestHash);
      return row ? parseRequest(row) : null;
    },
    putRequest: (record) => {
      upsertRequest.run(record.code, record.requestHash, JSON.stringify(record));
    },
    deleteRequest: (code) => {
      removeRequest.run(code);
    },
  };

  return {
    clientTables,
    listResources: () => selectAll.all().map(parse),
    getResource: (id: string) => {
      const row = selectOne.get(id);
      return row ? parse(row) : null;
    },
    putResource: (resource: StoredResource) => {
      // Parsing drops what is derived on read, such as a bucket's endpoints.
      upsert.run(resource.id, JSON.stringify(storedResourceSchema.parse(resource)));
    },
    deleteResource: (id: string) => {
      removeOne.run(id);
    },
    /**
     * The saved access settings; null before any are saved, or when the row cannot be read, which
     * falls back to the defaults of a machine not set up yet.
     */
    settings: (): SavedSettings | null => {
      const row = selectSettings.get();
      if (!row) {
        return null;
      }
      let data: unknown;
      try {
        data = JSON.parse(row.data);
      } catch {
        data = null;
      }
      const parsed = savedSettingsSchema.safeParse(data);
      if (!parsed.success) {
        // Not the row itself, which can hold a tunnel's token.
        console.error(
          `Ignoring the saved settings, which evertap cannot read: ${parsed.error.issues[0]?.message ?? "not JSON"}`,
        );
        return null;
      }
      return parsed.data;
    },
    putSettings: (settings: SavedSettings) => {
      upsertSettings.run(JSON.stringify(settings));
    },
    /** A generated password that stays the same for this name from now on. */
    secret: (name: string) => {
      const existing = selectSecret.get(name);
      if (existing) {
        return existing.value;
      }
      const value = newSecret();
      insertSecret.run(name, value);
      return value;
    },
    close: () => {
      db.close();
    },
  };
};
