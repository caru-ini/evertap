import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";

import { DataError } from "@evertap/api/context";
import type { Database, RowChanges, TableRef } from "@evertap/api/schemas";
import { SQL } from "bun";
import { z } from "zod";

import { config } from "../config.ts";
import type { DriverContext, SqlDriver } from "./driver.ts";
import { DATABASE_IMAGES } from "./images.ts";
import { createMysqlDriver } from "./mysql.ts";
import { containerId, createTestContext, laterRelease } from "./testing.ts";

const PORT = 23306;

let context: DriverContext;
let driver: SqlDriver;
let cleanup: () => Promise<void>;
let a: Database;
let b: Database;

const resource = (id: string, name: string, version: string, connectionUrl: string): Database => ({
  id,
  kind: "database",
  engine: "mysql",
  version,
  name,
  description: "",
  connectionUrl,
  extensions: [],
  protected: false,
  expiresAt: null,
  sizeBytes: 0,
  lastConnectedAt: null,
  createdAt: new Date().toISOString(),
});

/** An app's connection: through the entry, over plain TCP, as the URL says. */
const open = (url: string) => new SQL(url, { adapter: "mysql", max: 1 });

/** The same URL with another database, as an app reaches one it created. */
const withDatabase = (url: string, database: string) => url.replace(/\/[^/]*$/, `/${database}`);

const table = (name: string) => ({ schema: "evertap_aaaa", name });

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
};

/** Retries `check` for a few seconds, for what the server tidies up just after a client leaves. */
const eventually = async (check: () => Promise<void>) => {
  for (let attempt = 0; ; attempt++) {
    try {
      await check();
      return;
    } catch (error) {
      if (attempt > 40) {
        throw error;
      }
      await Bun.sleep(500);
    }
  }
};

const sha1 = (data: Buffer) => createHash("sha1").update(data).digest();

/** An error packet's message, or null for any other packet. */
const failed = (packet: Buffer) =>
  packet[0] === 0xff ? `${packet.readUInt16LE(1)} ${packet.subarray(9).toString()}` : null;

/**
 * A client that logs in without a database, which Bun's cannot, as Rails and Laravel do before
 * they create one. It speaks just enough of the protocol: mysql_native_password, and COM_QUERY
 * answered by the first packet of the reply.
 */
const rawSession = async (url: string) => {
  const { hostname, port, username, password } = new URL(url);
  let pending = Buffer.alloc(0);
  const queue: Buffer[] = [];
  const waiting: ((packet: Buffer) => void)[] = [];
  const socket = await Bun.connect({
    hostname,
    port: Number(port),
    socket: {
      data: (_socket, chunk) => {
        pending = Buffer.concat([pending, chunk]);
        while (pending.length >= 4 && pending.length >= 4 + pending.readUIntLE(0, 3)) {
          const end = 4 + pending.readUIntLE(0, 3);
          const packet = pending.subarray(4, end);
          pending = pending.subarray(end);
          const resolve = waiting.shift();
          if (resolve) {
            resolve(packet);
          } else {
            queue.push(packet);
          }
        }
      },
    },
  });
  const next = () => {
    const queued = queue.shift();
    return queued
      ? Promise.resolve(queued)
      : new Promise<Buffer>((resolve) => waiting.push(resolve));
  };
  const send = (sequence: number, payload: Buffer) => {
    const header = Buffer.alloc(4);
    header.writeUIntLE(payload.length, 0, 3);
    header[3] = sequence;
    socket.write(Buffer.concat([header, payload]));
  };
  const scramble = (nonce: Buffer) => {
    const stage1 = sha1(Buffer.from(decodeURIComponent(password)));
    const mask = sha1(Buffer.concat([nonce, sha1(stage1)]));
    return Buffer.from(stage1.map((byte, index) => byte ^ (mask[index] ?? 0)));
  };
  const greeting = await next();
  const versionEnd = greeting.indexOf(0, 1);
  const threadId = greeting.readUInt32LE(versionEnd + 1);
  const nonce = Buffer.concat([
    greeting.subarray(versionEnd + 5, versionEnd + 13),
    greeting.subarray(versionEnd + 32, versionEnd + 44),
  ]);
  // Long password, 4.1 protocol, secure connection and plugin auth, and no database.
  const fixed = Buffer.alloc(32);
  fixed.writeUInt32LE(0x1 | 0x200 | 0x8000 | 0x80000, 0);
  fixed.writeUInt32LE(1 << 24, 4);
  fixed[8] = 45;
  const auth = scramble(nonce);
  send(
    1,
    Buffer.concat([
      fixed,
      Buffer.from(`${decodeURIComponent(username)}\0`),
      Buffer.from([auth.length]),
      auth,
      Buffer.from("mysql_native_password\0"),
    ]),
  );
  let reply = await next();
  if (reply[0] === 0xfe) {
    const pluginEnd = reply.indexOf(0, 1);
    send(3, scramble(reply.subarray(pluginEnd + 1, pluginEnd + 21)));
    reply = await next();
  }
  if (reply[0] !== 0) {
    socket.end();
    throw new Error(`login failed: ${failed(reply) ?? reply.toString("hex")}`);
  }
  return {
    /** The id in the server's greeting, which Connector/J and the mysql client cancel with. */
    threadId,
    /** Resolves with the error's message, or null when the statement did not fail. */
    query: async (statement: string) => {
      send(0, Buffer.concat([Buffer.from([0x03]), Buffer.from(statement)]));
      return failed(await next());
    },
    close: () => socket.end(),
  };
};

/** Runs `cmd` in a running container, as `docker exec` does, and returns what it printed. */
const exec = async (name: string, cmd: string[]) => {
  const call = (path: string, body: unknown) =>
    fetch(`http://docker/v${context.docker.apiVersion}${path}`, {
      method: "POST",
      unix: config.dockerSocket,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const { Id } = z
    .object({ Id: z.string() })
    .parse(
      await (
        await call(`/containers/${name}/exec`, { Cmd: cmd, AttachStdout: true, Tty: true })
      ).json(),
    );
  return (await call(`/exec/${Id}/start`, { Detach: false, Tty: true })).text();
};

/** `applyChanges` on resource a, with the kinds a test leaves out empty as the API's defaults make them. */
const apply = (target: TableRef, changes: Partial<RowChanges>) =>
  driver.applyChanges(a, target, { updates: [], deletes: [], inserts: [], ...changes });

const names = (rows: { rows: unknown[][] }) => rows.rows.map((row) => row[1]);

/** Restarts a container the way a Docker restart would; a published port 0 comes back as another. */
const restart = async (name: string) => {
  const response = await fetch(
    `http://docker/v${context.docker.apiVersion}/containers/${name}/restart`,
    {
      method: "POST",
      unix: config.dockerSocket,
    },
  );
  expect(response.ok).toBe(true);
};

beforeAll(async () => {
  const test = await createTestContext("mysql", PORT);
  context = test.context;
  cleanup = test.cleanup;
  driver = createMysqlDriver(context);
  await driver.start([]);
  // One at a time, as the live store runs them.
  const first = await driver.provision({
    id: "aaaa",
    name: "shop",
    version: "9.7",
    extensions: [],
    password: "pwA1",
  });
  const second = await driver.provision({
    id: "bbbb",
    name: "blog",
    version: "8.4",
    extensions: [],
    password: "pwB2",
  });
  a = resource("aaaa", "shop", "9.7", first.connectionUrl);
  b = resource("bbbb", "blog", "8.4", second.connectionUrl);
  context.metadata.putResource(a);
  context.metadata.putResource(b);
});

afterAll(async () => {
  await driver?.close();
  await cleanup?.();
});

describe("entry", () => {
  it("hands out one host and port, with the resource's own user and database", () => {
    expect(a.connectionUrl).toBe(`mysql://evertap_aaaa:pwA1@127.0.0.1:${PORT}/evertap_aaaa`);
    expect(b.connectionUrl).toBe(`mysql://evertap_bbbb:pwB2@127.0.0.1:${PORT}/evertap_bbbb`);
  });

  it("routes each user to its own instance", async () => {
    const sqlA = open(a.connectionUrl);
    const sqlB = open(b.connectionUrl);
    try {
      const [rowA] = await sqlA`SELECT VERSION() AS v, DATABASE() AS db`;
      const [rowB] = await sqlB`SELECT VERSION() AS v, DATABASE() AS db`;
      expect(String(rowA.v)).toStartWith("9.7");
      expect(rowA.db).toBe("evertap_aaaa");
      expect(String(rowB.v)).toStartWith("8.4");
      expect(rowB.db).toBe("evertap_bbbb");
    } finally {
      await sqlA.close();
      await sqlB.close();
    }
  });

  it("lets an app create a database of any name and use triggers and functions in it", async () => {
    const sql = open(a.connectionUrl);
    try {
      await sql.unsafe("CREATE DATABASE prisma_migrate_shadow_db_0b1c");
    } finally {
      await sql.close();
    }
    // Only the database in the URL changes, as Prisma reaches its shadow database.
    const shadow = open(withDatabase(a.connectionUrl, "prisma_migrate_shadow_db_0b1c"));
    try {
      await shadow.unsafe("CREATE TABLE t (id INT PRIMARY KEY, doubled INT)");
      await shadow.unsafe("CREATE FUNCTION twice (x INT) RETURNS INT DETERMINISTIC RETURN x * 2");
      await shadow.unsafe(
        "CREATE TRIGGER t_doubled BEFORE INSERT ON t FOR EACH ROW SET NEW.doubled = twice(NEW.id)",
      );
      await shadow.unsafe("INSERT INTO t (id) VALUES (21)");
      const [row] = await shadow`SELECT DATABASE() AS db, doubled FROM t`;
      expect(row).toEqual({ db: "prisma_migrate_shadow_db_0b1c", doubled: 42 });
      await shadow.unsafe("DROP DATABASE prisma_migrate_shadow_db_0b1c");
    } finally {
      await shadow.close();
    }
  });

  it("takes a login without a database, even after the app dropped its own", async () => {
    // As Rails' db:drop and then db:create do.
    const dropping = await rawSession(b.connectionUrl);
    try {
      expect(await dropping.query("DROP DATABASE evertap_bbbb")).toBeNull();
    } finally {
      dropping.close();
    }
    for (const read of [() => driver.listTables(b), () => driver.runQuery(b, "SELECT 1")]) {
      const error = await failure(read());
      expect(error).toBeInstanceOf(DataError);
      expect(String(error)).toContain("Create database evertap_bbbb again");
    }
    const creating = await rawSession(b.connectionUrl);
    try {
      expect(await creating.query("CREATE DATABASE evertap_bbbb")).toBeNull();
    } finally {
      creating.close();
    }
    const sql = open(b.connectionUrl);
    try {
      const [row] = await sql`SELECT DATABASE() AS db`;
      expect(row.db).toBe("evertap_bbbb");
    } finally {
      await sql.close();
    }
  });

  it("keeps each resource to its own instance", async () => {
    const sqlA = open(a.connectionUrl);
    const sqlB = open(b.connectionUrl);
    try {
      // The same name on two resources makes two databases, one on each instance.
      for (const [sql, owner] of [
        [sqlA, "a"],
        [sqlB, "b"],
      ] as const) {
        await sql.unsafe("CREATE DATABASE app_test");
        await sql.unsafe("CREATE TABLE app_test.owner (name VARCHAR(10))");
        await sql.unsafe(`INSERT INTO app_test.owner VALUES ('${owner}')`);
      }
      const [rowA] = await sqlA`SELECT name FROM app_test.owner`;
      const [rowB] = await sqlB`SELECT name FROM app_test.owner`;
      expect([rowA.name, rowB.name]).toEqual(["a", "b"]);
      const databases = [...(await sqlA.unsafe("SHOW DATABASES"))].map(
        (row) => Object.values(row)[0],
      );
      expect(databases).toContain("evertap_aaaa");
      expect(databases).not.toContain("evertap_bbbb");
    } finally {
      await sqlA.close();
      await sqlB.close();
    }
    const crossed = open(withDatabase(a.connectionUrl, "evertap_bbbb"));
    try {
      expect(await failure(crossed`SELECT 1`)).toBeInstanceOf(Error);
    } finally {
      await crossed.close();
    }
    const borrowed = open(b.connectionUrl.replace("pwB2", "pwA1"));
    try {
      expect(await failure(borrowed`SELECT 1`)).toBeInstanceOf(Error);
    } finally {
      await borrowed.close();
    }
  });

  it("keeps a session's state from one statement to the next", async () => {
    const sql = open(a.connectionUrl);
    try {
      await sql.unsafe("SET @x = 5");
      await sql.unsafe("CREATE TEMPORARY TABLE scratch (n INT)");
      await sql.unsafe("INSERT INTO scratch VALUES (1), (2)");
      await sql.unsafe("PREPARE plus_one FROM 'SELECT ? + 1 AS r'");
      await sql.unsafe("SET @n = 41");
      const [lock] = await sql`SELECT GET_LOCK('migrate', 0) AS got`;
      expect(lock.got).toBe(1);
      const [state] =
        await sql`SELECT @x AS x, (SELECT COUNT(*) FROM scratch) AS n, IS_USED_LOCK('migrate') = CONNECTION_ID() AS mine`;
      expect(state).toEqual({ x: 5, n: 2, mine: 1 });
      const [executed] = await sql.unsafe("EXECUTE plus_one USING @n");
      expect(Number(executed.r)).toBe(42);
    } finally {
      await sql.close();
    }
  });

  it("frees a session's locks when its client leaves, and closes it", async () => {
    const other = open(a.connectionUrl);
    try {
      await other`SELECT 1`;
      const holder = open(a.connectionUrl);
      const [held] = await holder`SELECT GET_LOCK('migrate', 0) AS got`;
      expect(held.got).toBe(1);
      await holder.close();
      // Prisma, Rails and sqlx wait on such a lock before they migrate.
      const [lock] = await other`SELECT GET_LOCK('migrate', 5) AS got`;
      expect(lock.got).toBe(1);
      await eventually(async () => {
        const [row] =
          await other`SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE USER = 'evertap_aaaa' AND ID <> CONNECTION_ID()`;
        expect(Number(row.n)).toBe(0);
      });
    } finally {
      await other.close();
    }
  });

  it("stops a query by the id the entry greeted its client with, for that user only", async () => {
    // Connector/J and the mysql client cancel this way, from a session of their own.
    const sleeper = await rawSession(a.connectionUrl);
    try {
      const answered = sleeper.query("SELECT SLEEP(20)").then(() => "answered");
      await Bun.sleep(300);
      const stranger = open(b.connectionUrl);
      try {
        await stranger.unsafe(`KILL QUERY ${sleeper.threadId}`);
      } finally {
        await stranger.close();
      }
      expect(await Promise.race([answered, Bun.sleep(1000).then(() => "running")])).toBe("running");
      const started = performance.now();
      const owner = open(a.connectionUrl);
      try {
        await owner.unsafe(`KILL QUERY ${sleeper.threadId}`);
      } finally {
        await owner.close();
      }
      expect(await answered).toBe("answered");
      expect(performance.now() - started).toBeLessThan(5000);
    } finally {
      sleeper.close();
    }
  });

  it("loads a dump whose views and routines name other definers", async () => {
    for (const row of [a, b]) {
      const setup = open(row.connectionUrl);
      try {
        await setup.unsafe("CREATE DATABASE restored");
      } finally {
        await setup.close();
      }
      const sql = open(withDatabase(row.connectionUrl, "restored"));
      try {
        // As mysqldump writes them, with the accounts of the server they came from.
        await sql.unsafe("CREATE TABLE orders (id INT PRIMARY KEY, total INT)");
        await sql.unsafe(
          "/*!50001 CREATE ALGORITHM=UNDEFINED */ /*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */ /*!50001 VIEW `big_orders` AS select `id` from `orders` where `total` > 100 */",
        );
        await sql.unsafe(
          "CREATE DEFINER=`root`@`localhost` PROCEDURE `add_order`(IN n INT) INSERT INTO orders VALUES (n, n * 100)",
        );
        await sql.unsafe(
          "CREATE DEFINER=`deploy`@`%` FUNCTION `tax`(n INT) RETURNS INT DETERMINISTIC RETURN n DIV 10",
        );
        await sql.unsafe("CALL add_order(2)");
        const [count] = await sql`SELECT COUNT(*) AS n FROM big_orders`;
        expect(Number(count.n)).toBe(1);
      } finally {
        await sql.close();
      }
    }
  });

  it("keeps evertap's own login failures as faults", async () => {
    const wrong = resource("aaaa", "shop", "9.7", a.connectionUrl.replace("pwA1", "nope"));
    const error = await failure(driver.listTables(wrong));
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DataError);
  });

  it("rejects a wrong password", async () => {
    const sql = open(`mysql://evertap_aaaa:wrong@127.0.0.1:${PORT}/evertap_aaaa`);
    try {
      expect(await failure(sql`SELECT 1`)).toBeInstanceOf(Error);
    } finally {
      await sql.close();
    }
  });

  it("listens on no TCP port, only on sockets in a directory of evertap's alone", async () => {
    expect((await stat(join(context.dir, "sockets"))).mode & 0o777).toBe(0o700);
    // The sockets every ProxySQL process holds, and what listens for TCP on this machine; ProxySQL
    // shares the machine's network, so its tables are the machine's.
    const output = await exec(`${context.prefix}-proxysql`, [
      "sh",
      "-c",
      "ls -l /proc/[0-9]*/fd 2>/dev/null; echo TCP-TABLES; cat /proc/net/tcp /proc/net/tcp6",
    ]);
    const [fds = "", tables = ""] = output.split("TCP-TABLES");
    const held = new Set([...fds.matchAll(/socket:\[(\d+)\]/g)].map((match) => match[1]));
    expect(held.size).toBeGreaterThan(0);
    const listening = tables
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter((fields) => fields[3] === "0A" && held.has(fields[9]));
    expect(listening).toEqual([]);
  });

  it("lets a comment naming another hostgroup reach no other resource's data", async () => {
    // ProxySQL routes by such a comment; the other instance then refuses this user's login.
    const sql = open(a.connectionUrl);
    try {
      for (const hostgroup of [1, 2]) {
        const reached = await sql
          .unsafe(`SELECT /* ;hostgroup=${hostgroup} */ VERSION() AS v`)
          .then(
            ([row]) => String(row.v),
            (error: unknown) => String(error),
          );
        // Its own instance answers, or b's (8.4) refuses the login.
        expect(reached).toMatch(/^9\.7|Access denied/);
      }
      const [row] = await sql`SELECT DATABASE() AS db`;
      expect(row.db).toBe("evertap_aaaa");
    } finally {
      await sql.close();
    }
  });

  it("starts each instance from a copy, with a server UUID and root password of its own", async () => {
    const created = await driver.provision({
      id: "dddd",
      name: "copy",
      version: "9.7",
      extensions: [],
      password: "pwD4",
    });
    const copy = resource("dddd", "copy", "9.7", created.connectionUrl);
    context.metadata.putResource(copy);
    try {
      const uuid = async (row: Database) => {
        const sql = open(row.connectionUrl);
        try {
          const [result] = await sql`SELECT @@server_uuid AS id`;
          return String(result.id);
        } finally {
          await sql.close();
        }
      };
      expect(await uuid(copy)).not.toBe(await uuid(a));
      /** evertap's own session: root on the instance's published port, over TLS. */
      const root = async (instance: string, login: string) =>
        new SQL({
          adapter: "mysql",
          hostname: "127.0.0.1",
          port: (await context.docker.inspect(`${context.prefix}-mysql-${instance}`))?.ports[
            "3306/tcp"
          ],
          username: "root",
          password: createHmac("sha256", context.metadata.secret("mysql-root"))
            .update(login)
            .digest("hex"),
          tls: "require",
          max: 1,
        });
      for (const [login, works] of [
        ["dddd", true],
        ["aaaa", false],
        ["template", false],
      ] as const) {
        const sql = await root("dddd", login);
        try {
          const result = await sql`SELECT 1 AS one`.then(
            () => true,
            () => false,
          );
          expect([login, result]).toEqual([login, works]);
        } finally {
          await sql.close();
        }
      }
      // Copies of one template, each with RSA keys and TLS certificates of its own.
      const rsaKey = async (instance: string) => {
        const sql = await root(instance, instance);
        try {
          const [row] = await sql.unsafe("SHOW STATUS LIKE 'Caching_sha2_password_rsa_public_key'");
          return String(row.Value);
        } finally {
          await sql.close();
        }
      };
      const key = await rsaKey("dddd");
      expect(key).toContain("BEGIN PUBLIC KEY");
      expect(key).not.toBe(await rsaKey("aaaa"));
    } finally {
      await driver.drop(copy);
      context.metadata.deleteResource(copy.id);
    }
  });

  it("leaves nothing behind when a provision fails", async () => {
    // A password the entry cannot take fails after the instance has started.
    const error = await failure(
      driver.provision({ id: "cccc", name: "x", version: "9.7", extensions: [], password: "a'b" }),
    );
    expect(error).toBeInstanceOf(Error);
    const left = await context.docker.listByPrefix(context.prefix);
    expect(left.containers).not.toContain(`${context.prefix}-mysql-cccc`);
    expect(left.volumes).not.toContain(`${context.prefix}-mysql-cccc`);
  });
});

describe("data", () => {
  beforeAll(async () => {
    const sql = open(a.connectionUrl);
    try {
      await sql.unsafe(`CREATE TABLE items (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(40) NOT NULL,
        price DECIMAL(10,2) DEFAULT 0,
        meta JSON,
        made DATETIME,
        raw VARBINARY(8),
        flag BIT(1)
      )`);
      await sql.unsafe(
        `INSERT INTO items (id, name, price, meta, made, raw, flag) VALUES
          (1, 'apple', 1.50, '{"a": 1}', '2024-01-02 03:04:05', X'CAFE', b'1'),
          (2, 'banana_50%', 0.25, NULL, NULL, NULL, b'0'),
          (9007199254740993, 'huge', 3, NULL, NULL, NULL, NULL)`,
      );
      await sql.unsafe("CREATE TABLE logs (line TEXT)");
      await sql.unsafe("INSERT INTO logs VALUES ('one'), ('two')");
      await sql.unsafe("CREATE VIEW cheap AS SELECT id, name FROM items WHERE price < 1");
    } finally {
      await sql.close();
    }
  });

  it("lists only the resource's own tables and views", async () => {
    const tables = await driver.listTables(a);
    expect(tables.map((t) => [t.schema, t.name, t.kind])).toEqual([
      ["evertap_aaaa", "cheap", "view"],
      ["evertap_aaaa", "items", "table"],
      ["evertap_aaaa", "logs", "table"],
    ]);
    expect(tables.find((t) => t.name === "items")?.rowEstimate).toBeNumber();
    expect(await driver.listTables(b)).toEqual([]);
  });

  it("reads columns and normalized cells", async () => {
    const result = await driver.readRows(a, {
      id: a.id,
      table: table("items"),
      offset: 0,
      limit: 100,
      filters: [],
    });
    expect(result.total).toBe(3);
    expect(result.columns.map((c) => [c.name, c.type, c.nullable, c.primaryKey])).toEqual([
      ["id", "bigint", false, true],
      ["name", "varchar(40)", false, false],
      ["price", "decimal(10,2)", true, false],
      ["meta", "json", true, false],
      ["made", "datetime", true, false],
      ["raw", "varbinary(8)", true, false],
      ["flag", "bit(1)", true, false],
    ]);
    expect(result.columns[0]?.default).toBe("auto_increment");
    expect(result.columns[2]?.default).toBe("0.00");
    expect(result.rows[0]).toEqual([
      1,
      "apple",
      "1.50",
      '{"a": 1}',
      "2024-01-02 03:04:05",
      "0xcafe",
      1,
    ]);
    expect(result.rows[2]?.[0]).toBe("9007199254740993");
  });

  it("filters, sorts and pages", async () => {
    const read = (input: Partial<Parameters<SqlDriver["readRows"]>[1]>) =>
      driver.readRows(a, {
        id: a.id,
        table: table("items"),
        offset: 0,
        limit: 100,
        filters: [],
        ...input,
      });

    expect(
      names(await read({ filters: [{ column: "name", op: "contains", value: "_50%" }] })),
    ).toEqual(["banana_50%"]);
    expect(
      names(await read({ filters: [{ column: "name", op: "contains", value: "a_" }] })),
    ).toEqual(["banana_50%"]);
    expect(names(await read({ filters: [{ column: "meta", op: "null", value: "" }] }))).toEqual([
      "banana_50%",
      "huge",
    ]);
    expect(names(await read({ filters: [{ column: "made", op: "not-null", value: "" }] }))).toEqual(
      ["apple"],
    );
    expect(
      names(await read({ filters: [{ column: "id", op: "eq", value: "9007199254740993" }] })),
    ).toEqual(["huge"]);
    expect(
      names(await read({ filters: [{ column: "id", op: "eq", value: "9007199254740992" }] })),
    ).toEqual([]);
    expect(names(await read({ filters: [{ column: "price", op: "gt", value: "1" }] }))).toEqual([
      "apple",
      "huge",
    ]);
    expect(names(await read({ filters: [{ column: "raw", op: "eq", value: "0xCAFE" }] }))).toEqual([
      "apple",
    ]);
    const sorted = await read({
      sort: { column: "price", direction: "desc" },
      limit: 2,
      offset: 1,
    });
    expect(names(sorted)).toEqual(["apple", "banana_50%"]);
    expect(sorted.total).toBe(3);
    // Equal values (two NULLs) fall back to the primary key, so pages neither repeat nor skip rows.
    const byMeta = await read({ sort: { column: "meta", direction: "desc" } });
    expect(byMeta.rows.map((row) => row[0])).toEqual([1, 2, "9007199254740993"]);

    expect(
      await failure(read({ filters: [{ column: "nope", op: "eq", value: "1" }] })),
    ).toBeInstanceOf(DataError);
    expect(await failure(read({ sort: { column: "nope", direction: "asc" } }))).toBeInstanceOf(
      DataError,
    );
    expect(await failure(read({ table: { schema: "app_test", name: "owner" } }))).toBeInstanceOf(
      DataError,
    );
    expect(await failure(read({ table: table("missing") }))).toBeInstanceOf(DataError);
  });

  it("applies updates, deletes and inserts by primary key", async () => {
    expect(
      await apply(table("items"), {
        inserts: [
          { name: "cherry", raw: "0x0102", made: null },
          { id: "10", name: "date", price: "4.5" },
        ],
      }),
    ).toEqual({ updated: 0, deleted: 0, inserted: 2 });
    let rows = await driver.readRows(a, {
      id: a.id,
      table: table("items"),
      offset: 0,
      limit: 100,
      filters: [{ column: "name", op: "eq", value: "cherry" }],
    });
    expect(rows.rows[0]?.[2]).toBe("0.00");
    expect(rows.rows[0]?.[5]).toBe("0x0102");

    expect(
      await apply(table("items"), {
        updates: [
          { key: { id: 10 }, values: { name: "dates", flag: "1" } },
          { key: { id: "9007199254740993" }, values: { price: "7" } },
          // Unchanged values still count as the one matched row.
          { key: { id: 10 }, values: { name: "dates" } },
        ],
      }),
    ).toEqual({ updated: 3, deleted: 0, inserted: 0 });
    rows = await driver.readRows(a, {
      id: a.id,
      table: table("items"),
      offset: 0,
      limit: 100,
      filters: [{ column: "id", op: "gt", value: "9" }],
    });
    expect(rows.rows.map((row) => [row[0], row[1], row[2], row[6]])).toEqual([
      [10, "dates", "4.50", 1],
      ["9007199254740993", "huge", "7.00", null],
      // Auto-increment continues after the largest id.
      ["9007199254740994", "cherry", "0.00", null],
    ]);

    const missing = await failure(
      apply(table("items"), { updates: [{ key: { id: 404 }, values: { name: "x" } }] }),
    );
    expect(missing).toBeInstanceOf(DataError);
    expect(String(missing)).toContain("Update of id=404: That row no longer exists");
    expect(
      await failure(
        apply(table("items"), { updates: [{ key: { name: "dates" }, values: { name: "x" } }] }),
      ),
    ).toBeInstanceOf(DataError);
    expect(
      String(await failure(apply(table("items"), { inserts: [{ id: "10", name: "duplicate" }] }))),
    ).toMatch(/New row 1: Duplicate entry/);
    expect(await failure(apply(table("items"), { inserts: [{ name: null }] }))).toBeInstanceOf(
      DataError,
    );

    expect(await apply(table("items"), { deletes: [{ id: 10 }, { id: 404 }, { id: 1 }] })).toEqual({
      updated: 0,
      deleted: 2,
      inserted: 0,
    });
    rows = await driver.readRows(a, {
      id: a.id,
      table: table("items"),
      offset: 0,
      limit: 100,
      filters: [],
    });
    expect(rows.total).toBe(3);
  });

  it("applies a batch as a whole or not at all", async () => {
    const sql = open(a.connectionUrl);
    try {
      await sql.unsafe("CREATE TABLE batch (id INT PRIMARY KEY, label VARCHAR(10) NOT NULL)");
      await sql.unsafe("INSERT INTO batch VALUES (1, 'one'), (2, 'two'), (3, 'three')");
      await sql.unsafe(
        "CREATE TABLE batch_refs (id INT PRIMARY KEY, batch_id INT REFERENCES batch (id))",
      );
    } finally {
      await sql.close();
    }
    const contents = async () =>
      (await driver.runQuery(a, "SELECT id, label FROM batch ORDER BY id")).rows;

    // The insert reuses the id the delete frees, so the order updates → deletes → inserts matters.
    expect(
      await apply(table("batch"), {
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
    const error = await failure(
      apply(table("batch"), {
        updates: [{ key: { id: 3 }, values: { label: "tres" } }],
        deletes: [{ id: 4 }],
        inserts: [
          { id: "5", label: "five" },
          { id: "6", label: "x".repeat(11) },
        ],
      }),
    );
    expect(error).toBeInstanceOf(DataError);
    expect(String(error)).toContain("New row 2: Data too long for column 'label'");
    expect(await contents()).toEqual(before);

    await driver.runQuery(a, "INSERT INTO batch_refs VALUES (1, 4)");
    const deleteFailed = await failure(
      apply(table("batch"), {
        updates: [{ key: { id: 1 }, values: { label: "ein" } }],
        deletes: [{ id: 3 }, { id: 4 }],
      }),
    );
    expect(String(deleteFailed)).toContain("Delete of id=4: Cannot delete or update a parent row");
    expect(await contents()).toEqual(before);
    await driver.runQuery(a, "DROP TABLE batch_refs, batch");
  });

  it("keeps tables without a primary key read-only", async () => {
    const rows = await driver.readRows(a, {
      id: a.id,
      table: table("logs"),
      offset: 0,
      limit: 100,
      filters: [],
    });
    expect(rows.rows).toEqual([["one"], ["two"]]);
    const noKey = "This table has no primary key. Add one to edit rows here, or change it with SQL";
    for (const changes of [
      { inserts: [{ line: "three" }] },
      { updates: [{ key: { line: "one" }, values: { line: "1" } }] },
      { deletes: [{ line: "one" }] },
    ]) {
      expect(String(await failure(apply(table("logs"), changes)))).toContain(noKey);
    }
  });

  it("runs SQL as the resource's user, who holds every privilege", async () => {
    const select = await driver.runQuery(a, "SELECT id, name FROM items ORDER BY id");
    expect(select.columns).toEqual(["id", "name"]);
    expect(select.rows).toEqual([
      [2, "banana_50%"],
      ["9007199254740993", "huge"],
      ["9007199254740994", "cherry"],
    ]);
    expect(select.rowCount).toBe(3);
    expect(select.truncated).toBe(false);

    const update = await driver.runQuery(a, "UPDATE items SET price = price + 1 WHERE id < 100");
    expect(update.columns).toEqual([]);
    expect(update.rowCount).toBe(1);

    const several = await driver.runQuery(
      a,
      "CREATE TABLE numbers (n INT PRIMARY KEY); INSERT INTO numbers VALUES (1), (2); SELECT SUM(n) AS total FROM numbers",
    );
    expect(several.rows).toEqual([["3"]]);

    const many = await driver.runQuery(
      a,
      "SET SESSION cte_max_recursion_depth = 2000; WITH RECURSIVE s (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < 1500) SELECT n FROM s",
    );
    expect(many.rows).toHaveLength(1000);
    expect(many.truncated).toBe(true);

    // Session settings from one run do not reach the next.
    await driver.runQuery(a, "SET @x = 5");
    expect((await driver.runQuery(a, "SELECT @x AS x")).rows).toEqual([[null]]);

    expect(await failure(driver.runQuery(a, "SELEC 1"))).toBeInstanceOf(DataError);
    expect(await failure(driver.runQuery(a, "SELECT * FROM blog.posts"))).toBeInstanceOf(DataError);
    expect(
      (await driver.runQuery(a, "SELECT COUNT(*) AS n FROM mysql.user")).rows[0]?.[0],
    ).toBeGreaterThan(0);
  });

  it("refuses every change when read-only", async () => {
    const readOnly = { readOnly: true };
    expect((await driver.runQuery(a, "SELECT COUNT(*) AS n FROM numbers", readOnly)).rows).toEqual([
      [2],
    ]);
    for (const text of [
      "INSERT INTO numbers VALUES (3)",
      "DELETE FROM numbers",
      "DROP TABLE numbers",
      "CREATE TABLE other (n INT)",
      "SELECT 1; UPDATE numbers SET n = n + 10",
    ]) {
      expect(String(await failure(driver.runQuery(a, text, readOnly)))).toMatch(/read-only/);
    }
    expect((await driver.runQuery(a, "SELECT SUM(n) AS total FROM numbers")).rows).toEqual([["3"]]);
  });
});

describe("usage", () => {
  it("leaves no session of evertap's own on the instance", async () => {
    await driver.listTables(a);
    await driver.readRows(a, {
      id: a.id,
      table: table("items"),
      offset: 0,
      limit: 10,
      filters: [],
    });
    await driver.applyChanges(a, table("items"), { updates: [], deletes: [], inserts: [] });
    await driver.runQuery(a, "SELECT 1");
    await driver.usage([a, b]);
    const sql = open(a.connectionUrl);
    try {
      // Nothing but this session, once the entry has closed the ones earlier tests left it.
      await eventually(async () => {
        const [row] =
          await sql`SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE ID <> CONNECTION_ID() AND COMMAND <> 'Daemon'`;
        expect(Number(row.n)).toBe(0);
      });
    } finally {
      await sql.close();
    }
  });

  it("counts a session that opened and closed since the last look", async () => {
    // The tests above sent statements through the entry.
    expect((await driver.usage([a, b])).get(a.id)?.connected).toBe(true);
    // evertap's own reads go straight to the instance.
    await driver.listTables(a);
    await driver.runQuery(a, "SELECT 1");
    const idle = await driver.usage([a, b]);
    expect(idle.get(a.id)?.connected).toBe(false);
    expect(idle.get(a.id)?.sizeBytes).toBeGreaterThan(0);
    // Its own database is empty; the size counts every database on the instance.
    expect(idle.get(b.id)?.connected).toBe(false);
    expect(idle.get(b.id)?.sizeBytes).toBeGreaterThan(0);

    // A CI run between two looks.
    const sql = open(a.connectionUrl);
    await sql`SELECT 1`;
    await sql.close();
    const after = await driver.usage([a, b]);
    expect(after.get(a.id)?.connected).toBe(true);
    expect(after.get(b.id)?.connected).toBe(false);
    expect((await driver.usage([a, b])).get(a.id)?.connected).toBe(false);
  });

  it("counts a session that stays open without sending anything", async () => {
    const sql = open(a.connectionUrl);
    try {
      await sql`SELECT 1`;
      await driver.usage([a, b]);
      const busy = await driver.usage([a, b]);
      expect(busy.get(a.id)?.connected).toBe(true);
      expect(busy.get(b.id)?.connected).toBe(false);
    } finally {
      await sql.close();
    }
  });

  it("does not count what was sent before evertap started", async () => {
    const sql = open(a.connectionUrl);
    await sql`SELECT 1`;
    await sql.close();
    await driver.close();
    driver = createMysqlDriver(context);
    await driver.start([a, b]);
    expect((await driver.usage([a, b])).get(a.id)?.connected).toBe(false);
  });
});

describe("lifecycle", () => {
  it("resyncs the entry from metadata after a restart", async () => {
    await driver.close();
    // A fresh entry has nothing until the new driver writes the users back.
    await context.docker.remove(`${context.prefix}-proxysql`);
    driver = createMysqlDriver(context);
    await driver.start([a, b]);
    for (const row of [a, b]) {
      const sql = open(row.connectionUrl);
      try {
        const [result] = await sql`SELECT DATABASE() AS db`;
        expect(result.db).toBe(`evertap_${row.id}`);
      } finally {
        await sql.close();
      }
    }
    expect((await driver.listTables(a)).length).toBeGreaterThan(0);
  });

  it("routes to an instance's new port after Docker restarts it", async () => {
    const instance = `${context.prefix}-mysql-aaaa`;
    const before = await context.docker.inspect(instance);
    await restart(instance);
    await restart(`${context.prefix}-proxysql`);
    const after = await context.docker.inspect(instance);
    expect(after?.ports["3306/tcp"]).not.toBe(before?.ports["3306/tcp"]);

    // The instance needs a moment to accept logins again; evertap's next look moves the route.
    let tables;
    for (let attempt = 0; ; attempt++) {
      try {
        tables = await driver.listTables(a);
        break;
      } catch (error) {
        if (attempt > 60) {
          throw error;
        }
        await Bun.sleep(1000);
      }
    }
    expect(tables.length).toBeGreaterThan(0);
    // The entry takes a moment to come back too.
    await eventually(async () => {
      const sql = open(a.connectionUrl);
      try {
        const [row] = await sql`SELECT DATABASE() AS db`;
        expect(row.db).toBe("evertap_aaaa");
      } finally {
        await sql.close();
      }
    });
    expect((await driver.runQuery(a, "SELECT 1 AS one")).rows).toEqual([[1]]);
    await eventually(async () => {
      expect((await driver.usage([a])).has(a.id)).toBe(true);
    });
  });

  it("moves the entry to another public port", async () => {
    await driver.close();
    const moved = {
      ...context,
      publicPort: PORT + 1,
      entry: () => ({ hostname: "127.0.0.1", port: PORT + 1 }),
    };
    driver = createMysqlDriver(moved);
    await driver.start([a, b]);
    const movedSql = open(a.connectionUrl.replace(`:${PORT}/`, `:${PORT + 1}/`));
    try {
      const [row] = await movedSql`SELECT DATABASE() AS db`;
      expect(row.db).toBe("evertap_aaaa");
    } finally {
      await movedSql.close();
    }
    await driver.close();
    driver = createMysqlDriver(context);
    await driver.start([a, b]);
    const sql = open(a.connectionUrl);
    try {
      const [row] = await sql`SELECT DATABASE() AS db`;
      expect(row.db).toBe("evertap_aaaa");
    } finally {
      await sql.close();
    }
  });

  it("removes templates of images it no longer runs", async () => {
    const stale = `${context.prefix}-mysql-template-000000000000`;
    await context.docker.run(
      `${context.prefix}-mysql-stale`,
      DATABASE_IMAGES.mysql["9.7"] ?? "",
      ["true"],
      {
        [stale]: "/data",
      },
    );
    expect((await context.docker.listByPrefix(context.prefix)).volumes).toContain(stale);
    await driver.close();
    driver = createMysqlDriver(context);
    await driver.start([a, b]);
    const { volumes } = await context.docker.listByPrefix(context.prefix);
    expect(volumes).not.toContain(stale);
    expect(
      volumes.filter((name) => name.startsWith(`${context.prefix}-mysql-template-`)),
    ).toHaveLength(2);
  });

  it("keeps the data when a later release replaces the entry and the instances", async () => {
    const containers = ["proxysql", "mysql-aaaa", "mysql-bbbb"].map(
      (name) => `${context.prefix}-${name}`,
    );
    const before = await Promise.all(containers.map(containerId));
    await driver.close();
    driver = createMysqlDriver(laterRelease(context));
    await driver.start([a, b]);
    const after = await Promise.all(containers.map(containerId));
    after.forEach((id, index) => {
      expect(id).not.toBe(before[index]);
    });
    // The new entry starts empty; the users come back from metadata.
    for (const row of [a, b]) {
      const sql = open(row.connectionUrl);
      try {
        const [result] = await sql`SELECT DATABASE() AS db`;
        expect(result.db).toBe(`evertap_${row.id}`);
      } finally {
        await sql.close();
      }
    }
    expect((await driver.listTables(a)).length).toBeGreaterThan(0);
  });

  it("drops the instance, its data and the route", async () => {
    await driver.drop(b);
    context.metadata.deleteResource(b.id);
    const left = await context.docker.listByPrefix(context.prefix);
    expect(left.containers).not.toContain(`${context.prefix}-mysql-bbbb`);
    expect(left.volumes).not.toContain(`${context.prefix}-mysql-bbbb`);
    const sql = open(b.connectionUrl);
    try {
      expect(await failure(sql`SELECT 1`)).toBeInstanceOf(Error);
    } finally {
      await sql.close();
    }
    const sqlA = open(a.connectionUrl);
    try {
      const [row] = await sqlA`SELECT COUNT(*) AS n FROM items`;
      expect(Number(row.n)).toBe(3);
    } finally {
      await sqlA.close();
    }
    const usage = await driver.usage([a]);
    expect(usage.has(a.id)).toBe(true);
  });
});
