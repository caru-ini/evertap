import { ORPCError, os } from "@orpc/server";

import { type Context, DataError, UnavailableError } from "./context.ts";

/**
 * Every error leaves with a message the caller can act on. `DataError` and `UnavailableError`
 * carry their own; anything else broke on the machine, so it points to the Doctor.
 */
export const o = os.$context<Context>().use(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof ORPCError) {
      throw error;
    }
    if (error instanceof DataError) {
      throw new ORPCError("BAD_REQUEST", { message: error.message, cause: error });
    }
    if (error instanceof UnavailableError) {
      throw new ORPCError("SERVICE_UNAVAILABLE", { message: error.message, cause: error });
    }
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "evertap couldn't do that. Check Doctor or run evertap doctor, then try again",
      cause: error,
    });
  }
});

/** No sign-in: only what a CLI or a browser needs to ask for one. */
export const publicProcedure = o;

/** Any signed-in caller: a browser, a paired CLI, an API key, or the CLI on this machine. */
export const signedInProcedure = o.use(({ context, next }) => {
  if (context.caller.kind === "anonymous") {
    throw new ORPCError("UNAUTHORIZED", { message: "Sign in to evertap to continue" });
  }
  return next();
});

/**
 * A person: a signed-in browser, or the CLI on the machine running evertap. A client that could
 * approve or revoke clients could let itself back in after being revoked.
 */
export const personProcedure = o.use(({ context, next }) => {
  const { kind } = context.caller;
  if (kind === "anonymous") {
    throw new ORPCError("UNAUTHORIZED", { message: "Sign in to evertap to continue" });
  }
  if (kind === "client") {
    throw new ORPCError("FORBIDDEN", {
      message: "Only a person can do this. Open evertap in a browser",
    });
  }
  return next();
});

/** The CLI on the machine running evertap, over the local Unix socket. */
export const localProcedure = o.use(({ context, next }) => {
  if (context.caller.kind !== "local") {
    throw new ORPCError("FORBIDDEN", {
      message: "Run this on the machine running evertap",
    });
  }
  return next();
});
