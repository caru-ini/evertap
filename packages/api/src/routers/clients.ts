import { ORPCError } from "@orpc/server";
import { z } from "zod";

import type { Context, Store } from "../context.ts";
import { personProcedure, publicProcedure } from "../procedures.ts";
import { normalizePairingCode } from "../rules.ts";
import {
  claimStatusSchema,
  clientNameSchema,
  clientSchema,
  createdApiKeySchema,
  type Pairing,
  pairingSchema,
  startedPairingSchema,
} from "../schemas.ts";

const codeInput = z.object({ code: z.string() });

const loadPairing = async (store: Store, typed: string) => {
  const code = normalizePairingCode(typed);
  const pairing = code === null ? null : await store.getPairing(code);
  if (!pairing) {
    throw new ORPCError("NOT_FOUND", {
      message: "That code is not valid or has expired. Ask for a new code and enter it again",
    });
  }
  return pairing;
};

/** Starts a request that needs no sign-in, within the caps on open requests. */
export const startRequest = async (context: Context, input: Pick<Pairing, "kind" | "name">) => {
  const source = context.caller.kind === "local" ? null : (context.ip ?? "unknown");
  const started = await context.store.startPairing({ ...input, source });
  if (!started) {
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message:
        "Too many sign-in requests are waiting. Use the codes already shown, or try again in 10 minutes",
    });
  }
  return started;
};

/** The browser session that approves, recorded on what it lets in. */
export const approverOf = (context: Context) =>
  context.caller.kind === "person" ? (context.caller.client?.id ?? null) : null;

/**
 * Who may call evertap besides the browser. `pairing.start` and `pairing.claim` are for the CLI;
 * the rest is for a person and must stay out of MCP and the CLI, or a client could admit others.
 */
export const clientsRouter = {
  list: personProcedure
    .output(z.array(clientSchema))
    .handler(({ context }) => context.store.listClients()),

  revoke: personProcedure
    .input(z.object({ id: z.string().min(1) }))
    .output(z.object({ id: z.string() }))
    .handler(async ({ input, context }) => {
      const clients = await context.store.listClients();
      if (!clients.some((client) => client.id === input.id)) {
        throw new ORPCError("NOT_FOUND", {
          message: "That client is already revoked. Reload the list",
        });
      }
      await context.store.revokeClient(input.id);
      return { id: input.id };
    }),

  createApiKey: personProcedure
    .input(z.object({ name: clientNameSchema }))
    .output(createdApiKeySchema)
    .handler(async ({ input, context }) => {
      const clients = await context.store.listClients();
      if (clients.some((client) => client.kind === "api-key" && client.name === input.name)) {
        throw new ORPCError("CONFLICT", {
          message: "An API key with that name already exists. Choose another name",
        });
      }
      return context.store.createApiKey(input.name);
    }),

  pairing: {
    start: publicProcedure
      .input(z.object({ name: clientNameSchema }))
      .output(startedPairingSchema)
      .handler(({ input, context }) => startRequest(context, { kind: "cli", name: input.name })),

    /** The CLI polls with its secret; the token comes back once, on the first poll after approval. */
    claim: publicProcedure
      .input(z.object({ requestId: z.string().min(1) }))
      .output(z.object({ status: claimStatusSchema, token: z.string().optional() }))
      .handler(({ input, context }) => context.store.claimPairing(input.requestId)),

    get: personProcedure
      .input(codeInput)
      .output(pairingSchema)
      .handler(({ input, context }) => loadPairing(context.store, input.code)),

    approve: personProcedure
      .input(codeInput)
      .output(clientSchema)
      .handler(async ({ input, context }) => {
        const pairing = await loadPairing(context.store, input.code);
        return context.store.approvePairing(pairing.code, approverOf(context));
      }),

    deny: personProcedure
      .input(codeInput)
      .output(z.object({ code: z.string() }))
      .handler(async ({ input, context }) => {
        const pairing = await loadPairing(context.store, input.code);
        await context.store.denyPairing(pairing.code);
        return { code: pairing.code };
      }),
  },
};
