import { ORPCError } from "@orpc/server";
import { deleteCookie, getCookie, setCookie } from "@orpc/server/helpers";
import { z } from "zod";

import type { Context } from "../context.ts";
import { localProcedure, publicProcedure, signedInProcedure } from "../procedures.ts";
import { PAIRING_WINDOW_MS, SESSION_COOKIE, browserName, cookieName } from "../rules.ts";
import { claimStatusSchema } from "../schemas.ts";
import { approverOf, startRequest } from "./clients.ts";

/** The secret of a browser's open sign-in request, out of reach of the page's scripts. */
const REQUEST_COOKIE = "evertap_request";
const COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

const cookieOptions = (context: Context, maxAge: number) => ({
  httpOnly: true,
  sameSite: "strict" as const,
  secure: context.https ?? false,
  path: "/",
  maxAge,
});

const readCookie = (context: Context, name: string) =>
  getCookie(context.reqHeaders, cookieName(name, context.https));

const writeCookie = (context: Context, name: string, value: string, maxAge: number) => {
  setCookie(
    context.resHeaders,
    cookieName(name, context.https),
    value,
    cookieOptions(context, maxAge),
  );
};

// A browser ignores a deletion of a `__Host-` cookie that leaves out Secure.
const dropCookie = (context: Context, name: string) => {
  deleteCookie(context.resHeaders, cookieName(name, context.https), cookieOptions(context, 0));
};

const signIn = (context: Context, token: string) => {
  writeCookie(context, SESSION_COOKIE, token, COOKIE_MAX_AGE_S);
};

/** A browser signs in the way a CLI pairs: it shows a code that a signed-in browser approves. */
export const sessionRouter = {
  /** `clientId` is this browser's own row in Clients, so the page can mark it. */
  get: publicProcedure
    .output(z.object({ signedIn: z.boolean(), clientId: z.string().nullable() }))
    .handler(({ context }) => ({
      signedIn: context.caller.kind !== "anonymous",
      clientId: context.caller.kind === "person" ? (context.caller.client?.id ?? null) : null,
    })),

  start: publicProcedure
    .output(z.object({ code: z.string(), expiresAt: z.iso.datetime() }))
    .handler(async ({ context }) => {
      // A reload shows the same code instead of opening another request.
      const open = readCookie(context, REQUEST_COOKIE);
      const resumed = open ? await context.store.resumePairing(open) : null;
      if (resumed) {
        return resumed;
      }
      const started = await startRequest(context, {
        kind: "browser",
        name: browserName(context.reqHeaders?.get("user-agent")),
      });
      writeCookie(context, REQUEST_COOKIE, started.requestId, PAIRING_WINDOW_MS / 1000);
      return { code: started.code, expiresAt: started.expiresAt };
    }),

  claim: publicProcedure
    .output(z.object({ status: claimStatusSchema }))
    .handler(async ({ context }) => {
      const requestId = readCookie(context, REQUEST_COOKIE);
      if (!requestId) {
        return { status: "expired" as const };
      }
      const claimed = await context.store.claimPairing(requestId);
      if (claimed.status === "pending") {
        return { status: "pending" as const };
      }
      dropCookie(context, REQUEST_COOKIE);
      if (claimed.status === "approved") {
        signIn(context, claimed.token);
      }
      return { status: claimed.status };
    }),

  /** Opens a sign-in link printed on the machine running evertap. */
  redeem: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .output(z.object({ status: z.literal("approved") }))
    .handler(async ({ input, context }) => {
      const claimed = await context.store.claimPairing(
        input.token,
        browserName(context.reqHeaders?.get("user-agent")),
      );
      if (claimed.status !== "approved") {
        throw new ORPCError("NOT_FOUND", {
          message:
            "This sign-in link has expired or was already used. Run evertap signin-link again on the machine running evertap",
        });
      }
      signIn(context, claimed.token);
      return { status: claimed.status };
    }),

  /** A one-time link that signs in the browser that opens it, for the first browser and recovery. */
  link: localProcedure
    .output(z.object({ url: z.string(), expiresAt: z.iso.datetime() }))
    .handler(async ({ context }) => {
      if (!context.origin) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Set EVERTAP_PUBLIC_URL to the address browsers open evertap at",
        });
      }
      const started = await startRequest(context, { kind: "browser", name: "Browser" });
      await context.store.approvePairing(started.code, approverOf(context));
      // In the fragment, so the secret never reaches a request log.
      return { url: `${context.origin}/signin#${started.requestId}`, expiresAt: started.expiresAt };
    }),

  /** Signs out: a browser drops its session, a CLI its token (`evertap logout`). */
  end: signedInProcedure.output(z.object({ ok: z.boolean() })).handler(async ({ context }) => {
    const { caller } = context;
    const own = caller.kind === "person" || caller.kind === "client" ? caller.client : null;
    if (own) {
      await context.store.revokeClient(own.id);
    }
    dropCookie(context, SESSION_COOKIE);
    return { ok: true };
  }),
};
