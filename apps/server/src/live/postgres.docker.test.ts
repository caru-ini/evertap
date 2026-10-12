import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

import { DataError } from "@evertap/api/context";
import type { Database, RowChanges, RowValues, TableRef } from "@evertap/api/schemas";
import { SQL } from "bun";

import { createPostgresDriver } from "./postgres.ts";
import { containerId, createTestContext, laterRelease } from "./testing.ts";

const PORT = 16432;
const { context, cleanup } = await createTestContext("postgresql", PORT);
let driver = createPostgresDriver(context);
const clients: SQL[] = [];

const provision = async (id: string, version: string, extensions: string[] = []) => {
  const password = `pw${id}`;
  const { connectionUrl } = await driver.provision({
    id,
    name: `app-${id}`,
    version,
    extensions,
    password,
  });
  const resource: Database = {
    id,
    kind: "database",
    engine: "postgresql",
    version,
    name: `app-${id}`,
    description: "",
    connectionUrl,
    extensions,
    protected: false,
    expiresAt: null,
    sizeBytes: 0,
    lastConnectedAt: null,
    createdAt: new Date().toISOString(),
  };
  // The entry looks a user up in the metadata, as the live store records each resource.
  context.metadata.putResource(resource);
  return resource;
};

/** One connection, so every statement on it runs in the same session. */
const client = (url: string, options: { connection?: Record<string, string> } = {}) => {
  const sql = new SQL({ url, max: 1, ...options });
  clients.push(sql);
  return sql;
};

/** The resource's URL with only the database changed, as an app reaches one it made. */
const inDatabase = (resource: Database, database: string) => {
  const url = new URL(resource.connectionUrl);
  url.pathname = `/${database}`;
  return url.href;
};

// Bun's queries are lazy thenables that `expect().rejects` never starts, so await them here.
const rejection = async (pending: PromiseLike<unknown>) => {
  try {
    await pending;
  } catch (error) {
    return error;
  }
  return null;
};

const encoder = new TextEncoder();
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** A packet before startup: its length, a code, and the rest. */
const packet = (code: number, body: Uint8Array = new Uint8Array()) => {
  const out = new Uint8Array(8 + body.length);
  const view = new DataView(out.buffer);
  view.setInt32(0, out.length);
  view.setInt32(4, code);
  out.set(body, 8);
  return out;
};

const PROTOCOL_3_0 = 196_608;
const PROTOCOL_3_2 = 196_610;

const startup = (parameters: Record<string, string>, protocol = PROTOCOL_3_0) =>
  packet(
    protocol,
    encoder.encode(
      `${Object.entries(parameters)
        .map(([name, value]) => `${name}\0${value}\0`)
        .join("")}\0`,
    ),
  );

/** Sends raw bytes to the entry and collects what comes back until it closes or `waitMs` passes. */
const raw = async (pieces: Uint8Array[], waitMs = 500) => {
  const received: number[] = [];
  let closed = false;
  const socket = await Bun.connect({
    hostname: "127.0.0.1",
    port: PORT,
    socket: {
      data: (_socket, chunk) => {
        received.push(...chunk);
      },
      close: () => {
        closed = true;
      },
    },
  });
  for (const piece of pieces) {
    socket.write(piece);
    await Bun.sleep(50);
  }
  await Bun.sleep(waitMs);
  socket.end();
  return { text: decode(new Uint8Array(received)), closed };
};

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const int32 = (value: number) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setInt32(0, value);
  return out;
};

/**
 * A session over the protocol itself, for what Bun's client does not do: send a cancel request,
 * or ask for protocol 3.2. Logs in with SCRAM-SHA-256 and reads up to the first ReadyForQuery.
 */
const bareSession = async (resource: Database, protocol: number) => {
  const url = new URL(resource.connectionUrl);
  let buffered = new Uint8Array();
  let wake: (() => void) | null = null;
  const socket = await Bun.connect({
    hostname: "127.0.0.1",
    port: PORT,
    socket: {
      data: (_socket, chunk) => {
        buffered = concat(buffered, chunk);
        wake?.();
      },
    },
  });
  const next = async () => {
    for (;;) {
      if (buffered.length >= 5) {
        const length = new DataView(buffered.buffer, buffered.byteOffset).getInt32(1);
        if (buffered.length >= 1 + length) {
          const message = {
            type: String.fromCodePoint(buffered[0] ?? 0),
            body: buffered.slice(5, 1 + length),
          };
          buffered = buffered.slice(1 + length);
          return message;
        }
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  };
  const send = (type: string, body: Uint8Array) => {
    socket.write(concat(encoder.encode(type), int32(4 + body.length), body));
  };
  socket.write(
    startup({ user: decodeURIComponent(url.username), database: url.pathname.slice(1) }, protocol),
  );
  const nonce = randomBytes(18).toString("base64");
  const firstBare = `n=,r=${nonce}`;
  const first = encoder.encode(`n,,${firstBare}`);
  let message = await next();
  if (message.type === "v") {
    message = await next();
  }
  expect(decode(message.body)).toContain("SCRAM-SHA-256");
  send("p", concat(encoder.encode("SCRAM-SHA-256\0"), int32(first.length), first));
  const serverFirst = decode((await next()).body.subarray(4));
  const fields = Object.fromEntries(
    serverFirst.split(",").map((field) => [field.slice(0, 1), field.slice(2)]),
  );
  const salted = pbkdf2Sync(
    decodeURIComponent(url.password),
    Buffer.from(fields.s ?? "", "base64"),
    Number(fields.i),
    32,
    "sha256",
  );
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const finalBare = `c=biws,r=${fields.r}`;
  const signature = createHmac("sha256", storedKey)
    .update(`${firstBare},${serverFirst},${finalBare}`)
    .digest();
  const proof = Buffer.from(clientKey.map((byte, index) => byte ^ (signature[index] ?? 0)));
  send("p", encoder.encode(`${finalBare},p=${proof.toString("base64")}`));

  let key = new Uint8Array();
  for (message = await next(); message.type !== "Z"; message = await next()) {
    expect(message.type).not.toBe("E");
    if (message.type === "K") {
      key = message.body;
    }
  }
  return {
    /** The process id and secret, as a cancel request sends them. */
    key,
    query: (sql: string) => {
      send("Q", encoder.encode(`${sql}\0`));
    },
    /** The SQLSTATE of the next error, or null when the query ends without one. */
    error: async () => {
      for (message = await next(); message.type !== "Z"; message = await next()) {
        if (message.type === "E") {
          const code = decode(message.body)
            .split("\0")
            .find((field) => field.startsWith("C"));
          return code?.slice(1) ?? "";
        }
      }
      return null;
    },
    close: () => {
      socket.end();
    },
  };
};

const cancel = (key: Uint8Array) => raw([packet(80_877_102, key)], 200);

const items = { schema: "public", name: "items" };

/** `applyChanges` with the kinds a test leaves out empty, as the API's defaults make them. */
const apply = (resource: Database, table: TableRef, changes: Partial<RowChanges>) =>
  driver.applyChanges(resource, table, { updates: [], deletes: [], inserts: [], ...changes });

let a: Database;
let b: Database;
let c: Database;

beforeAll(async () => {
  await driver.start([]);
  // One at a time, as the live store runs them.
  a = await provision("a1", "18", ["vector"]);
  b = await provision("b1", "16");
  c = await provision("c1", "16");
});

afterAll(async () => {
  await Promise.all(clients.map((sql) => sql.close()));
  await driver.close();
  await cleanup();
});

test("a URL names a generated user, a superuser in an instance of its own", async () => {
  expect(a.connectionUrl).toBe(`postgres://evertap_a1:pwa1@127.0.0.1:${PORT}/evertap_a1`);
  const [info] = await client(a.connectionUrl)`
    SELECT current_user AS who, current_database() AS db, version() AS v,
      (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
      current_setting('wal_level') AS wal`;
  expect(info).toEqual({
    who: "evertap_a1",
    db: "evertap_a1",
    v: expect.stringContaining("PostgreSQL 18"),
    superuser: true,
    wal: "logical",
  });
  const [other] = await client(b.connectionUrl)`SELECT version() AS v`;
  expect(other.v).toContain("PostgreSQL 16");
});

test("an app creates databases and roles, and reaches each database by its name", async () => {
  const sqlA = client(a.connectionUrl);
  await sqlA.unsafe("CREATE DATABASE made_by_app");
  for (const database of ["made_by_app", "postgres", "template1"]) {
    const sql = client(inDatabase(a, database));
    const [row] = await sql`SELECT current_database() AS db`;
    expect(row.db).toBe(database);
    // Left open, it would keep CREATE DATABASE from copying template1.
    await sql.close();
  }
  await sqlA.unsafe("CREATE ROLE app_role");
  await sqlA.unsafe("SET ROLE app_role");
  expect((await sqlA`SELECT current_user AS who`)[0].who).toBe("app_role");
  await sqlA.unsafe("RESET ROLE");

  // Names are the instance's own, so another resource makes the same ones.
  const sqlB = client(b.connectionUrl);
  await sqlB.unsafe("CREATE DATABASE made_by_app");
  await sqlB.unsafe("CREATE ROLE app_role");
});

test("one resource's user reaches nothing of another's", async () => {
  const crossed = await rejection(client(inDatabase(a, "evertap_b1"))`SELECT 1`);
  expect(String(crossed)).toContain('database "evertap_b1" does not exist');
  const swapped = client(b.connectionUrl.replace(":pwb1@", ":pwa1@"));
  expect(String(await rejection(swapped`SELECT 1`))).toContain("password authentication failed");

  const sqlA = client(a.connectionUrl);
  const [seen] = await sqlA`
    SELECT (SELECT count(*) FROM pg_database WHERE datname = 'evertap_b1')::int AS databases,
      (SELECT count(*) FROM pg_roles WHERE rolname = 'evertap_b1')::int AS roles`;
  expect(seen).toEqual({ databases: 0, roles: 0 });

  // A superuser runs programs in its instance; from there, the other instance stays out of reach.
  const [target] = await client(b.connectionUrl)`SELECT host(inet_server_addr()) AS ip`;
  const probe = async (address: string) => {
    await sqlA.unsafe("CREATE TEMP TABLE IF NOT EXISTS probe (line text); TRUNCATE probe");
    await sqlA.unsafe(
      `COPY probe FROM PROGRAM 'timeout 3 bash -c "</dev/tcp/${address}/5432" && echo open || echo closed'`,
    );
    return (await sqlA`SELECT line FROM probe`)[0].line;
  };
  expect(await probe("127.0.0.1")).toBe("open");
  expect(await probe(target.ip)).toBe("closed");
}, 30_000);

test("session state lasts across statements on one connection", async () => {
  const session = client(a.connectionUrl);
  const other = client(a.connectionUrl);

  await session`SELECT pg_advisory_lock(72707369)`;
  expect((await other`SELECT pg_try_advisory_lock(72707369) AS got`)[0].got).toBe(false);
  await session`SELECT pg_advisory_unlock(72707369)`;

  await session.unsafe("CREATE TEMP TABLE scratch (n int)");
  await session`INSERT INTO scratch VALUES (1)`;
  expect((await session`SELECT count(*)::int AS n FROM scratch`)[0].n).toBe(1);

  await session.unsafe("PREPARE plus AS SELECT $1::int + 1 AS n");
  expect((await session.unsafe("EXECUTE plus(41)"))[0].n).toBe(42);

  await session.unsafe("SET application_name = 'kept'");
  expect((await session`SELECT current_setting('application_name') AS name`)[0].name).toBe("kept");

  const notified = Promise.withResolvers<string>();
  const subscription = await client(a.connectionUrl).listen("events", notified.resolve);
  await other`SELECT pg_notify('events', 'hello')`;
  expect(await notified.promise).toBe("hello");
  await subscription.unlisten();
});

test("a cancel request reaches the session that asked for it", async () => {
  // Both instances run a query, likely under the same process id; only the secret tells them apart.
  const asking = await bareSession(a, PROTOCOL_3_2);
  const busy = await bareSession(b, PROTOCOL_3_0);
  // Protocol 3.2 lets PostgreSQL 18 send a longer secret than 3.0's 4 bytes.
  expect(asking.key.length).toBeGreaterThan(8);
  expect(busy.key.length).toBe(8);
  asking.query("SELECT pg_sleep(30)");
  busy.query("SELECT pg_sleep(30)");
  await Bun.sleep(300);
  const started = performance.now();
  await cancel(asking.key);
  expect(await asking.error()).toBe("57014");
  expect(performance.now() - started).toBeLessThan(5000);

  const busyError = busy.error();
  expect(await Promise.race([busyError, Bun.sleep(1000).then(() => "running")])).toBe("running");
  await cancel(busy.key);
  expect(await busyError).toBe("57014");
  asking.close();
  busy.close();
}, 30_000);

test("logical replication connections go through", async () => {
  const replication = client(a.connectionUrl, { connection: { replication: "database" } });
  const [system] = await replication.unsafe("IDENTIFY_SYSTEM");
  expect(system.dbname).toBe("evertap_a1");
});

test("the entry declines encryption and refuses what it cannot route", async () => {
  const ssl = packet(80_877_103);
  const gss = packet(80_877_104);
  const unknown = await raw([gss, ssl, startup({ user: "nobody", database: "x" })]);
  expect(unknown.text.slice(0, 2)).toBe("NN");
  expect(unknown.text).toContain("Connect with the user in the database's URL");
  expect(unknown.closed).toBe(true);

  const split = startup({ user: "evertap_zz" });
  const late = await raw([split.subarray(0, 3), split.subarray(3, 11), split.subarray(11)]);
  expect(late.text).toContain("Connect with the user in the database's URL");

  expect((await raw([startup({ database: "x" })])).text).toContain("Connect with the user");
  expect(await raw([new Uint8Array([0x16, 0x03, 0x01, 0x00])])).toEqual({
    text: "",
    closed: true,
  });
  // No session holds this key, and a server answers nothing to a cancel request.
  expect(await cancel(new Uint8Array(8))).toEqual({ text: "", closed: true });
});

test("evertap's data browser leaves no session behind", async () => {
  await driver.runQuery(c, "CREATE TABLE notes (id int PRIMARY KEY)");
  await driver.listTables(c);
  await driver.readRows(c, {
    id: c.id,
    table: { schema: "public", name: "notes" },
    offset: 0,
    limit: 10,
    filters: [],
  });
  // Both refuse while another session is in the database, unless forced.
  const maintenance = client(inDatabase(c, "postgres"));
  await maintenance.unsafe("CREATE DATABASE copied TEMPLATE evertap_c1");
  await driver.listTables(c);
  await maintenance.unsafe("DROP DATABASE evertap_c1");
  await maintenance.unsafe("CREATE DATABASE evertap_c1");
  await maintenance.close();
});

test("extensions are listed per version, and in databases made later too", async () => {
  const available = await driver.listExtensions?.("18");
  const names = available?.map((extension) => extension.name) ?? [];
  expect(names).toContain("vector");
  expect(names).toContain("uuid-ossp");
  expect(names).not.toContain("plpgsql");
  expect(names).toEqual(names.toSorted());
  expect(available?.find((extension) => extension.name === "pg_trgm")?.description).toContain(
    "trigram",
  );

  const result = await driver.runQuery(
    a,
    "SELECT extname FROM pg_extension WHERE extname = 'vector'",
  );
  expect(result.rows).toEqual([["vector"]]);
  const [later] = await client(inDatabase(a, "made_by_app"))`
    SELECT count(*)::int AS n FROM pg_extension WHERE extname = 'vector'`;
  expect(later.n).toBe(1);
});

test("tables, rows, sorting, filters and paging", async () => {
  await driver.runQuery(
    a,
    `CREATE TABLE items (
      id serial PRIMARY KEY,
      name text NOT NULL,
      score int,
      tags jsonb,
      created timestamptz DEFAULT now(),
      emb vector(3)
    );
    INSERT INTO items (name, score, tags, emb)
      SELECT 'item_' || n, n * 10, jsonb_build_object('n', n), '[1,2,3]' FROM generate_series(1, 30) n;
    CREATE TABLE logs (message text);
    INSERT INTO logs VALUES ('hello');
    CREATE VIEW item_names AS SELECT name FROM items;
    ANALYZE items;`,
  );

  const tables = await driver.listTables(a);
  expect(tables).toEqual([
    { schema: "public", name: "item_names", kind: "view", rowEstimate: null },
    { schema: "public", name: "items", kind: "table", rowEstimate: 30 },
    expect.objectContaining({ schema: "public", name: "logs", kind: "table" }),
  ]);

  const page = await driver.readRows(a, {
    id: a.id,
    table: items,
    offset: 2,
    limit: 3,
    sort: { column: "score", direction: "desc" },
    filters: [],
  });
  expect(page.total).toBe(30);
  expect(page.rows.map((row) => row[1])).toEqual(["item_28", "item_27", "item_26"]);
  expect(page.columns[0]).toEqual({
    name: "id",
    type: "integer",
    nullable: false,
    primaryKey: true,
    default: "nextval('items_id_seq'::regclass)",
  });
  expect(page.columns.find((entry) => entry.name === "emb")?.type).toBe("vector(3)");
  const first = page.rows[0] ?? [];
  expect(first[3]).toBe('{"n": 28}');
  expect(first[5]).toBe("[1,2,3]");

  const filtered = await driver.readRows(a, {
    id: a.id,
    table: items,
    offset: 0,
    limit: 100,
    filters: [
      { column: "name", op: "contains", value: "_1" },
      { column: "score", op: "gt", value: "120" },
      { column: "tags", op: "not-null", value: "" },
    ],
  });
  expect(filtered.rows.map((row) => row[1])).toEqual([
    "item_13",
    "item_14",
    "item_15",
    "item_16",
    "item_17",
    "item_18",
    "item_19",
  ]);
  expect(filtered.total).toBe(7);

  // A literal `%` must not act as a wildcard.
  const percent = await driver.readRows(a, {
    id: a.id,
    table: items,
    offset: 0,
    limit: 10,
    filters: [{ column: "name", op: "contains", value: "%" }],
  });
  expect(percent.total).toBe(0);

  expect(
    await rejection(
      driver.readRows(a, {
        id: a.id,
        table: items,
        offset: 0,
        limit: 10,
        filters: [{ column: "nope", op: "eq", value: "1" }],
      }),
    ),
  ).toBeInstanceOf(DataError);
  expect(
    await rejection(
      driver.readRows(a, {
        id: a.id,
        table: items,
        offset: 0,
        limit: 10,
        filters: [{ column: "score", op: "eq", value: "abc" }],
      }),
    ),
  ).toBeInstanceOf(DataError);
  expect(
    await rejection(
      driver.readRows(a, {
        id: a.id,
        table: { schema: "public", name: "missing" },
        offset: 0,
        limit: 10,
        filters: [],
      }),
    ),
  ).toBeInstanceOf(DataError);
});

test("apply updates, deletes and inserts by primary key", async () => {
  expect(
    await apply(a, items, { inserts: [{ name: "added", score: "7", tags: '{"new": true}' }] }),
  ).toEqual({ updated: 0, deleted: 0, inserted: 1 });
  const added = await driver.readRows(a, {
    id: a.id,
    table: items,
    offset: 0,
    limit: 10,
    filters: [{ column: "name", op: "eq", value: "added" }],
  });
  expect(added.total).toBe(1);
  const row = added.rows[0] ?? [];
  expect(row[2]).toBe(7);
  expect(row[4]).not.toBeNull();
  const id = row[0] ?? null;

  await apply(a, items, { updates: [{ key: { id }, values: { score: "8", tags: null } }] });
  const updated = await driver.readRows(a, {
    id: a.id,
    table: items,
    offset: 0,
    limit: 10,
    filters: [{ column: "id", op: "eq", value: String(id) }],
  });
  expect(updated.rows[0]?.[2]).toBe(8);
  expect(updated.rows[0]?.[3]).toBeNull();

  const missing = await rejection(
    apply(a, items, { updates: [{ key: { id: 99999 }, values: { score: "1" } }] }),
  );
  expect(missing).toBeInstanceOf(DataError);
  expect(String(missing)).toContain("Update of id=99999: That row is gone");
  expect(
    await rejection(apply(a, items, { updates: [{ key: { id }, values: { name: null } }] })),
  ).toBeInstanceOf(DataError);

  expect(await apply(a, items, { deletes: [{ id }, { id: 1 }, { id: 99999 }] })).toEqual({
    updated: 0,
    deleted: 2,
    inserted: 0,
  });

  const logs = { schema: "public", name: "logs" };
  const read = await driver.readRows(a, {
    id: a.id,
    table: logs,
    offset: 0,
    limit: 10,
    filters: [],
  });
  expect(read.rows).toEqual([["hello"]]);
  for (const changes of [
    { inserts: [{ message: "second" }] },
    { updates: [{ key: { message: "hello" }, values: { message: "x" } }] },
    { deletes: [{ message: "hello" }] },
  ]) {
    const error = await rejection(apply(a, logs, changes));
    expect(error).toBeInstanceOf(DataError);
    expect(String(error)).toContain("This table has no primary key");
  }
});

test("a batch applies every change or none", async () => {
  await driver.runQuery(
    a,
    `CREATE TABLE batch (id int PRIMARY KEY, label varchar(10) NOT NULL);
     INSERT INTO batch VALUES (1, 'one'), (2, 'two'), (3, 'three')`,
  );
  const batch = { schema: "public", name: "batch" };
  const contents = async () =>
    (await driver.runQuery(a, "SELECT id, label FROM batch ORDER BY id")).rows;

  // The insert reuses the id the delete frees, so the order updates → deletes → inserts matters.
  expect(
    await apply(a, batch, {
      updates: [{ key: { id: 1 }, values: { label: "uno" } }],
      deletes: [{ id: 2 }],
      inserts: [
        { id: "2", label: "dos" },
        { id: "4", label: "four" },
      ],
    }),
  ).toEqual({ updated: 1, deleted: 1, inserted: 2 });
  expect(await contents()).toEqual([
    [1, "uno"],
    [2, "dos"],
    [3, "three"],
    [4, "four"],
  ]);

  const before = await contents();
  const error = await rejection(
    apply(a, batch, {
      updates: [{ key: { id: 3 }, values: { label: "tres" } }],
      deletes: [{ id: 4 }],
      inserts: [
        { id: "5", label: "five" },
        { id: "6", label: "x".repeat(11) },
      ],
    }),
  );
  expect(error).toBeInstanceOf(DataError);
  expect(String(error)).toContain("New row 2: value too long for type character varying(10)");
  expect(await contents()).toEqual(before);

  const update = await rejection(
    apply(a, batch, {
      updates: [
        { key: { id: 1 }, values: { label: "ein" } },
        { key: { id: 3 }, values: { label: "x".repeat(11) } },
      ],
    }),
  );
  expect(String(update)).toContain("Update of id=3: value too long");
  expect(await contents()).toEqual(before);
});

test("values longer than the column are refused, not cut short", async () => {
  await driver.runQuery(
    a,
    `CREATE TABLE limits (id int PRIMARY KEY, v varchar(40), c char(3), b bit(3));
     INSERT INTO limits VALUES (1, repeat('x', 40), 'abc', B'101')`,
  );
  const limits = { schema: "public", name: "limits" };
  const insert = (values: RowValues) => apply(a, limits, { inserts: [values] });
  const tooLong = await rejection(insert({ id: "2", v: "x".repeat(50) }));
  expect(tooLong).toBeInstanceOf(DataError);
  expect(String(tooLong)).toContain("value too long");
  expect(await rejection(insert({ id: "2", c: "abcd" }))).toBeInstanceOf(DataError);
  expect(await rejection(insert({ id: "2", b: "1010" }))).toBeInstanceOf(DataError);
  expect(
    await rejection(
      apply(a, limits, { updates: [{ key: { id: 1 }, values: { v: "y".repeat(41) } }] }),
    ),
  ).toBeInstanceOf(DataError);

  await insert({ id: "2", v: "short", c: "de", b: "011" });
  const read = (value: string) =>
    driver.readRows(a, {
      id: a.id,
      table: limits,
      offset: 0,
      limit: 10,
      filters: [{ column: "v", op: "eq", value }],
    });
  // A cut-short filter value would have matched the 40-character row.
  expect((await read("x".repeat(50))).total).toBe(0);
  expect((await read("x".repeat(40))).rows.map((row) => row[0])).toEqual([1]);
  expect((await read("short")).rows).toEqual([[2, "short", "de ", "011"]]);
});

test("runQuery reads only the rows it can show", async () => {
  // Buffered whole, a hundred million rows would run past the time limit. In the select list
  // generate_series streams; in FROM it would build every row before the first one.
  const started = performance.now();
  const huge = await driver.runQuery(a, "SELECT generate_series(1, 100000000) AS n;");
  expect(performance.now() - started).toBeLessThan(5000);
  expect(huge.rows).toHaveLength(1000);
  expect(huge.rows[999]).toEqual([1000]);
  expect(huge.truncated).toBe(true);
  expect(huge.rowCount).toBeNull();
  expect(huge.columns).toEqual(["n"]);

  const small = await driver.runQuery(a, "  (VALUES (1), (2))");
  expect(small.rows).toEqual([[1], [2]]);
  expect(small.rowCount).toBe(2);

  // Statements a cursor does not take run as they are.
  const cte = await driver.runQuery(
    a,
    "WITH gone AS (DELETE FROM logs WHERE false RETURNING *) SELECT count(*) AS n FROM gone",
  );
  expect(cte.rows).toEqual([[0]]);
  await driver.runQuery(a, "SELECT 1 AS x INTO copied");
  expect((await driver.runQuery(a, "TABLE copied")).rows).toEqual([[1]]);
  const script = await driver.runQuery(a, "SELECT 1 AS one; SELECT 2 AS two");
  expect(script.rows).toEqual([[2]]);
  expect(String(await rejection(driver.runQuery(a, "SELECT 1/0")))).toContain("division by zero");
});

test("runQuery stops a statement after 30 seconds even with the timeout turned off", async () => {
  const error = await rejection(
    driver.runQuery(a, "SET statement_timeout = 0; SELECT pg_sleep(40)"),
  );
  expect(error).toBeInstanceOf(DataError);
  expect(String(error)).toContain("ran longer than 30 seconds");
}, 60_000);

test("runQuery returns rows, counts and the engine's errors", async () => {
  const selected = await driver.runQuery(
    a,
    "SELECT 9007199254740993::int8 AS big, 5::int8 AS small, '\\xdead'::bytea AS b, '{\"x\":1}'::jsonb AS j, 1.5::numeric AS n, true AS t, NULL AS nothing",
  );
  expect(selected.columns).toEqual(["big", "small", "b", "j", "n", "t", "nothing"]);
  expect(selected.rows).toEqual([["9007199254740993", 5, "\\xdead", '{"x":1}', "1.5", true, null]]);
  expect(selected.rowCount).toBe(1);
  expect(selected.truncated).toBe(false);

  const many = await driver.runQuery(a, "SELECT generate_series(1, 1500) AS n");
  expect(many.rows).toHaveLength(1000);
  expect(many.truncated).toBe(true);

  const changed = await driver.runQuery(a, "UPDATE items SET score = score + 1 WHERE id <= 5");
  expect(changed.rowCount).toBe(4);
  expect(changed.columns).toEqual([]);

  const script = await driver.runQuery(a, "SELECT 1 AS one; SELECT 2 AS two");
  expect(script.columns).toEqual(["two"]);

  expect(await rejection(driver.runQuery(a, "SELEC 1"))).toBeInstanceOf(DataError);
  expect(String(await rejection(driver.runQuery(a, "SELECT * FROM nowhere")))).toContain(
    "does not exist",
  );
  // Each run is its own session: an open transaction does not leak into the next.
  await driver.runQuery(a, "BEGIN; DELETE FROM items");
  const kept = await driver.runQuery(a, "SELECT count(*) AS n FROM items");
  expect(kept.rows[0]?.[0]).toBeGreaterThan(0);
});

test("runQuery refuses every change when read-only", async () => {
  await driver.runQuery(
    a,
    "CREATE TABLE guarded (n int PRIMARY KEY); INSERT INTO guarded VALUES (1)",
  );
  const readOnly = { readOnly: true };
  expect((await driver.runQuery(a, "SELECT n FROM guarded", readOnly)).rows).toEqual([[1]]);
  for (const text of [
    "INSERT INTO guarded VALUES (2)",
    "DELETE FROM guarded",
    "DROP TABLE guarded",
    "CREATE TABLE other (n int)",
    "WITH gone AS (DELETE FROM guarded RETURNING n) SELECT n FROM gone",
    "SELECT 1; UPDATE guarded SET n = 2",
  ]) {
    expect(String(await rejection(driver.runQuery(a, text, readOnly)))).toMatch(/read-only/);
  }
  expect((await driver.runQuery(a, "SELECT n FROM guarded")).rows).toEqual([[1]]);
  await driver.runQuery(a, "DROP TABLE guarded");
});

test("usage reports the size of every database and connections through the entry", async () => {
  const sqlA = client(a.connectionUrl);
  await sqlA`SELECT 1`;
  const before = (await driver.usage([a, b])).get(a.id);
  expect(before?.connected).toBe(true);
  expect(before?.sizeBytes).toBeGreaterThan(0);
  await sqlA.unsafe("CREATE DATABASE grown");
  expect((await driver.usage([a])).get(a.id)?.sizeBytes).toBeGreaterThan(before?.sizeBytes ?? 0);

  // The first call clears what earlier tests left; then only evertap touches it.
  await driver.usage([c]);
  await driver.listTables(c);
  expect((await driver.usage([c])).get(c.id)).toEqual({
    sizeBytes: expect.any(Number),
    connected: false,
  });
});

test("a restarted driver brings the entry back for existing resources", async () => {
  // One driver owns the entry's port at a time, as in one evertap process.
  await driver.close();
  const again = createPostgresDriver(context);
  await again.start([a, b]);
  const [row] = await client(b.connectionUrl)`SELECT current_database() AS db`;
  expect(row.db).toBe("evertap_b1");
  await again.close();
  await driver.start([a, b]);
});

test("a later release replaces the instances, and the data stays", async () => {
  const sqlB = client(b.connectionUrl);
  await sqlB.unsafe("CREATE TABLE kept (id int); INSERT INTO kept VALUES (1)");
  await sqlB.close();
  const names = [a, b].map((resource) => `${context.prefix}-postgres-${resource.id}`);
  const before = await Promise.all(names.map(containerId));
  await driver.close();
  driver = createPostgresDriver(laterRelease(context));
  await driver.start([a, b, c]);
  const after = await Promise.all(names.map(containerId));
  after.forEach((id, index) => {
    expect(id).not.toBe(before[index]);
  });
  // The instance takes a moment to come back up.
  let count: unknown;
  for (let attempt = 0; attempt < 50 && count === undefined; attempt++) {
    try {
      const [row] = await client(b.connectionUrl)`SELECT count(*)::int AS n FROM kept`;
      count = row.n;
    } catch {
      await Bun.sleep(200);
    }
  }
  expect(count).toBe(1);
  expect((await driver.listTables(a)).length).toBeGreaterThan(0);
});

test("a failed provision leaves no instance behind", async () => {
  expect(await rejection(provision("f1", "16", ["no_such_extension"]))).toBeInstanceOf(Error);
  const name = `${context.prefix}-postgres-f1`;
  expect(await context.docker.inspect(name)).toBeNull();
  expect((await context.docker.listByPrefix(context.prefix)).volumes).not.toContain(name);
});

test("drop removes the instance and its data", async () => {
  await driver.drop(a);
  await driver.drop(c);
  context.metadata.deleteResource(a.id);
  context.metadata.deleteResource(c.id);
  const gone = await rejection(client(a.connectionUrl)`SELECT 1`);
  expect(String(gone)).toContain("Connect with the user in the database's URL");
  expect((await driver.usage([a, c])).size).toBe(0);
  const made = await context.docker.listByPrefix(context.prefix);
  expect(made.containers).toEqual([`${context.prefix}-postgres-b1`]);
  expect(made.volumes).toEqual([`${context.prefix}-postgres-b1`]);
  expect(made.networks).toEqual([`${context.prefix}-isolated`]);
});
