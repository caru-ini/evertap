import { ORPCError } from "@orpc/server";
import { z } from "zod";

import type { Store } from "../context.ts";
import { signedInProcedure } from "../procedures.ts";
import {
  DATABASE_ENGINES,
  DATABASE_VERSIONS,
  DESCRIPTION_MAX,
  STORAGE_ENGINES,
  isDatabaseEngine,
} from "../rules.ts";
import { createResourceInputSchema, resourceSchema } from "../schemas.ts";
import { resolveSettings } from "../settings.ts";

const idInput = z.object({ id: z.string().min(1) });

const loadResource = async (store: Store, id: string) => {
  const row = await store.getResource(id);
  if (!row) {
    throw new ORPCError("NOT_FOUND", {
      message: "That resource no longer exists. Reload the list",
    });
  }
  return row;
};

export const resourcesRouter = {
  list: signedInProcedure
    .output(z.array(resourceSchema))
    .handler(({ context }) => context.store.listResources()),

  get: signedInProcedure
    .input(idInput)
    .output(resourceSchema)
    .handler(({ input, context }) => loadResource(context.store, input.id)),

  create: signedInProcedure
    .input(createResourceInputSchema)
    .output(resourceSchema)
    .handler(async ({ input, context }) => {
      const { engines } = await context.store.status();
      if (!engines.includes(input.engine)) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "This service is not available yet. Choose another service",
        });
      }
      const existing = await context.store.listResources();
      if (existing.some((row) => row.engine === input.engine && row.name === input.name)) {
        throw new ORPCError("CONFLICT", {
          message: isDatabaseEngine(input.engine)
            ? "A resource with that name already exists for this service. Choose another name"
            : "A bucket with that name already exists. Choose another name",
        });
      }
      if (input.engine === "postgresql") {
        const version = input.version ?? DATABASE_VERSIONS.postgresql[0];
        const available = new Set(
          (await context.store.listExtensions(version)).map((ext) => ext.name),
        );
        const unknown = input.extensions.find((name) => !available.has(name));
        if (unknown !== undefined) {
          throw new ORPCError("BAD_REQUEST", {
            message: `The extension "${unknown}" is not available on PostgreSQL ${version}. Pick one from the list`,
          });
        }
      }
      return context.store.createResource({ ...input, extensions: [...new Set(input.extensions)] });
    }),

  delete: signedInProcedure
    .input(idInput)
    .output(z.object({ id: z.string() }))
    .handler(async ({ input, context }) => {
      const row = await loadResource(context.store, input.id);
      if (row.protected) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "This resource is protected from deletion. Remove the protection first",
        });
      }
      await context.store.deleteResource(row.id);
      return { id: row.id };
    }),

  connectionDetails: signedInProcedure
    .input(idInput)
    .output(
      z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("database"),
          engine: z.enum(DATABASE_ENGINES),
          url: z.string(),
        }),
        z.object({
          kind: z.literal("object-storage"),
          engine: z.enum(STORAGE_ENGINES),
          endpoint: z.string(),
          region: z.string(),
          bucket: z.string(),
          accessKeyId: z.string(),
          secretAccessKey: z.string(),
          publicEndpoint: z.string().nullable(),
        }),
      ]),
    )
    .handler(async ({ input, context }) => {
      const row = await loadResource(context.store, input.id);
      if (row.kind === "database") {
        return { kind: row.kind, engine: row.engine, url: row.connectionUrl };
      }
      return {
        kind: row.kind,
        engine: row.engine,
        endpoint: row.endpoint,
        region: row.region,
        bucket: row.name,
        accessKeyId: row.accessKeyId,
        secretAccessKey: row.secretAccessKey,
        publicEndpoint: row.publicEndpoint,
      };
    }),

  setProtected: signedInProcedure
    .input(idInput.extend({ protected: z.boolean() }))
    .output(resourceSchema)
    .handler(async ({ input, context }) => {
      const row = await loadResource(context.store, input.id);
      // Protecting something you meant to throw away is a contradiction; protecting keeps it.
      if (input.protected && row.expiresAt !== null) {
        await context.store.keepResource(row.id);
      }
      return context.store.setProtected(row.id, input.protected);
    }),

  setReachableAnywhere: signedInProcedure
    .input(idInput.extend({ reachableAnywhere: z.boolean() }))
    .output(resourceSchema)
    .handler(async ({ input, context }) => {
      const row = await loadResource(context.store, input.id);
      if (row.kind !== "object-storage") {
        throw new ORPCError("BAD_REQUEST", {
          message: "Only a bucket can be reached from anywhere. Choose a bucket",
        });
      }
      if (input.reachableAnywhere) {
        const { saved, environment } = await context.store.settings();
        const { mode, storageUrl } = resolveSettings(saved, environment);
        if (mode.value !== "network" && mode.value !== "cloudflare") {
          throw new ORPCError("PRECONDITION_FAILED", {
            message:
              "Buckets can be reached from anywhere only when other machines reach evertap. Run evertap setup on the machine running evertap to choose how",
          });
        }
        if (storageUrl.value === null) {
          throw new ORPCError("PRECONDITION_FAILED", {
            message:
              "Give buckets an address of their own first, in Settings or with evertap setup --s3-url",
          });
        }
      }
      return context.store.setReachableAnywhere(row.id, input.reachableAnywhere);
    }),

  setDescription: signedInProcedure
    .input(idInput.extend({ description: z.string().trim().max(DESCRIPTION_MAX) }))
    .output(resourceSchema)
    .handler(async ({ input, context }) => {
      await loadResource(context.store, input.id);
      return context.store.setDescription(input.id, input.description);
    }),

  keep: signedInProcedure
    .input(idInput)
    .output(resourceSchema)
    .handler(async ({ input, context }) => {
      await loadResource(context.store, input.id);
      return context.store.keepResource(input.id);
    }),
};
