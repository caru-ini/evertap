import { ORPCError } from "@orpc/server";
import { z } from "zod";

import type { Store } from "../context.ts";
import { signObjectLink } from "../object-links.ts";
import { signedInProcedure } from "../procedures.ts";
import {
  OBJECT_PART_SIZE,
  OBJECT_PARTS_MAX,
  bucketNameSchema,
  completedPartSchema,
  listObjectsInputSchema,
  objectKeySchema,
  objectListSchema,
  partNumberSchema,
  queryResultSchema,
  readRowsInputSchema,
  redisKeySchema,
  appliedChangesSchema,
  rowChangesSchema,
  rowsSchema,
  scanKeysInputSchema,
  scanKeysResultSchema,
  tableRefSchema,
  tableSchema,
  writeKeyInputSchema,
  expireKeyInputSchema,
} from "../schemas.ts";

const SQL_MAX = 100_000;

const idInput = z.object({ id: z.string().min(1) });

const objectInput = idInput.extend({ bucket: bucketNameSchema.optional() });

const uploadInput = objectInput.extend({
  key: objectKeySchema,
  type: z.string().max(255).default(""),
});

// Each request carries at most one part, so it stays within what a proxy in front of evertap takes.
const partBody = z
  .instanceof(Blob)
  .refine(
    (body) => body.size <= OBJECT_PART_SIZE,
    `Send the file in parts of ${OBJECT_PART_SIZE / 1024 / 1024} MiB or less`,
  );

const loadResource = async (store: Store, id: string) => {
  const row = await store.getResource(id);
  if (!row) {
    throw new ORPCError("NOT_FOUND", {
      message: "That resource no longer exists. Reload the list",
    });
  }
  return row;
};

const loadDatabase = async (store: Store, id: string, family: "sql" | "redis") => {
  const row = await loadResource(store, id);
  const sql = row.kind === "database" && row.engine !== "redis";
  const redis = row.kind === "database" && row.engine === "redis";
  if (row.kind !== "database" || (family === "sql" ? !sql : !redis)) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        family === "sql"
          ? "Tables and SQL are for PostgreSQL and MySQL. Open one of those databases"
          : "Keys are for Redis. Open a Redis database",
    });
  }
  return row;
};

/**
 * The resource as it reaches `bucket`, its first bucket when omitted. Any other is one the key
 * made, and the key reaches no one else's.
 */
const loadBucket = async (store: Store, { id, bucket }: { id: string; bucket?: string }) => {
  const row = await loadResource(store, id);
  if (row.kind !== "object-storage") {
    throw new ORPCError("BAD_REQUEST", {
      message: "Objects are for buckets. Open a bucket",
    });
  }
  return bucket === undefined ? row : { ...row, name: bucket };
};

/** Browsing and editing what is inside a resource. `protected` does not stop edits. */
export const dataRouter = {
  tables: signedInProcedure
    .input(idInput)
    .output(z.array(tableSchema))
    .handler(async ({ input, context }) => {
      const db = await loadDatabase(context.store, input.id, "sql");
      return context.store.listTables(db);
    }),

  rows: signedInProcedure
    .input(readRowsInputSchema)
    .output(rowsSchema)
    .handler(async ({ input, context }) => {
      const db = await loadDatabase(context.store, input.id, "sql");
      return context.store.readRows(db, input);
    }),

  applyChanges: signedInProcedure
    .input(z.object({ id: z.string().min(1), table: tableRefSchema, changes: rowChangesSchema }))
    .output(appliedChangesSchema)
    .handler(async ({ input, context }) => {
      const db = await loadDatabase(context.store, input.id, "sql");
      return context.store.applyChanges(db, input.table, input.changes);
    }),

  query: signedInProcedure
    .input(
      idInput.extend({
        sql: z.string().trim().min(1, "Enter a statement").max(SQL_MAX),
        // Read-only unless asked: a stray UPDATE or DROP from a person or an agent changes nothing.
        write: z.boolean().default(false),
      }),
    )
    .output(queryResultSchema)
    .handler(async ({ input, context }) => {
      const db = await loadDatabase(context.store, input.id, "sql");
      return context.store.runQuery(db, input.sql, { readOnly: !input.write });
    }),

  keys: signedInProcedure
    .input(scanKeysInputSchema)
    .output(scanKeysResultSchema)
    .handler(async ({ input, context }) => {
      const db = await loadDatabase(context.store, input.id, "redis");
      return context.store.scanKeys(db, input);
    }),

  key: signedInProcedure
    .input(idInput.extend({ key: z.string().min(1) }))
    .output(redisKeySchema)
    .handler(async ({ input, context }) => {
      const db = await loadDatabase(context.store, input.id, "redis");
      const key = await context.store.readKey(db, input.key);
      if (!key) {
        throw new ORPCError("NOT_FOUND", {
          message: "That key no longer exists. Search the keys again",
        });
      }
      return key;
    }),

  writeKey: signedInProcedure
    .input(writeKeyInputSchema)
    .output(z.object({ ok: z.literal(true) }))
    .handler(async ({ input, context }) => {
      const db = await loadDatabase(context.store, input.id, "redis");
      await context.store.writeKey(db, input);
      return { ok: true as const };
    }),

  expireKey: signedInProcedure
    .input(expireKeyInputSchema)
    .output(z.object({ ok: z.literal(true) }))
    .handler(async ({ input, context }) => {
      const db = await loadDatabase(context.store, input.id, "redis");
      await context.store.expireKey(db, input);
      return { ok: true as const };
    }),

  deleteKey: signedInProcedure
    .input(idInput.extend({ key: z.string().min(1) }))
    .output(z.object({ ok: z.literal(true) }))
    .handler(async ({ input, context }) => {
      const db = await loadDatabase(context.store, input.id, "redis");
      await context.store.deleteKey(db, input.key);
      return { ok: true as const };
    }),

  buckets: signedInProcedure
    .input(idInput)
    .output(z.array(z.string()))
    .handler(async ({ input, context }) => {
      const bucket = await loadBucket(context.store, input);
      return context.store.listBuckets(bucket);
    }),

  objects: signedInProcedure
    .input(listObjectsInputSchema)
    .output(objectListSchema)
    .handler(async ({ input, context }) => {
      const bucket = await loadBucket(context.store, input);
      return context.store.listObjects(bucket, input);
    }),

  // Files up to OBJECT_PART_SIZE: the whole file in one call, stored with `type` as its Content-Type.
  putObject: signedInProcedure
    .input(uploadInput.extend({ body: partBody }))
    .output(z.object({ ok: z.literal(true) }))
    .handler(async ({ input, context }) => {
      const bucket = await loadBucket(context.store, input);
      await context.store.putObject(bucket, input);
      return { ok: true as const };
    }),

  // Larger files: start, one call per OBJECT_PART_SIZE part, then complete.
  startUpload: signedInProcedure
    .input(uploadInput)
    .output(z.object({ uploadId: z.string() }))
    .handler(async ({ input, context }) => {
      const bucket = await loadBucket(context.store, input);
      return context.store.startUpload(bucket, input);
    }),

  uploadPart: signedInProcedure
    .input(
      objectInput.extend({
        key: objectKeySchema,
        uploadId: z.string().min(1),
        partNumber: partNumberSchema,
        body: partBody,
      }),
    )
    .output(z.object({ etag: z.string() }))
    .handler(async ({ input, context }) => {
      const bucket = await loadBucket(context.store, input);
      return context.store.uploadPart(bucket, input);
    }),

  completeUpload: signedInProcedure
    .input(
      objectInput.extend({
        key: objectKeySchema,
        uploadId: z.string().min(1),
        parts: z.array(completedPartSchema).min(1).max(OBJECT_PARTS_MAX),
      }),
    )
    .output(z.object({ ok: z.literal(true) }))
    .handler(async ({ input, context }) => {
      const bucket = await loadBucket(context.store, input);
      await context.store.completeUpload(bucket, input);
      return { ok: true as const };
    }),

  abortUpload: signedInProcedure
    .input(objectInput.extend({ key: objectKeySchema, uploadId: z.string().min(1) }))
    .output(z.object({ ok: z.literal(true) }))
    .handler(async ({ input, context }) => {
      const bucket = await loadBucket(context.store, input);
      await context.store.abortUpload(bucket, input);
      return { ok: true as const };
    }),

  // A link on evertap's own origin that a signed-in browser opens to download the object.
  objectUrl: signedInProcedure
    .input(objectInput.extend({ key: objectKeySchema }))
    .output(z.object({ url: z.string() }))
    .handler(async ({ input, context }) => {
      // The link opens only with a browser's session cookie, so no one else could use it.
      if (context.caller.kind !== "person") {
        throw new ORPCError("FORBIDDEN", {
          message: "Download files from evertap in a browser",
        });
      }
      const bucket = await loadBucket(context.store, input);
      return { url: signObjectLink(bucket.id, bucket.name, input.key) };
    }),

  deleteObject: signedInProcedure
    .input(objectInput.extend({ key: objectKeySchema }))
    .output(z.object({ ok: z.literal(true) }))
    .handler(async ({ input, context }) => {
      const bucket = await loadBucket(context.store, input);
      await context.store.deleteObject(bucket, input.key);
      return { ok: true as const };
    }),
};
