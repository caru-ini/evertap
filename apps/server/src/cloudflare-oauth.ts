/**
 * Access to a person's Cloudflare account for one change, approved on Cloudflare's own page: OAuth's
 * authorization code with PKCE, as a public client that holds no secret. evertap.dev shows the code
 * Cloudflare sends back, the person pastes it into the evertap that asked, and only that process
 * holds the verifier that turns it into access. It asks for no refresh token, and gives the access
 * back once the change is done.
 */

import { createHash, randomBytes } from "node:crypto";

import { DataError } from "@evertap/api/context";
import { z } from "zod";

import { type Cloudflare, connectCloudflare, tokenLink } from "./cloudflare.ts";

/** evertap's OAuth client in Cloudflare, registered for evertap.dev. */
export const CLIENT_ID = "04be15f49ca1c6688d501f1d7d72c48f";

/** Matched exactly by Cloudflare; the page shows the code to paste back. */
export const REDIRECT_URI = "https://evertap.dev/auth/cloudflare";

/** What making, moving, and removing the tunnel takes, by Cloudflare's names for it. */
export const SCOPES = [
  "argotunnel.write",
  "zone.read",
  "dns.read",
  "dns.write",
  "cache-settings.read",
  "cache-settings.write",
];

// A stand-in for Cloudflare, in tests.
const dashboard = () => process.env.EVERTAP_CLOUDFLARE_DASH ?? "https://dash.cloudflare.com";

// Annotated so TypeScript knows code after a call is unreachable.
const fail: (message: string) => never = (message) => {
  throw new DataError(message);
};

/**
 * One approval, kept by the process that started it. `verifier` and `state` never leave it: the
 * page gets only the verifier's hash.
 */
export type Approval = { verifier: string; state: string; url: string };

export const startApproval = (): Approval => {
  const verifier = randomBytes(96).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const url = new URL("/oauth2/auth", dashboard());
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(" "),
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { verifier, state, url: url.href };
};

/**
 * The code in what the person pasted: evertap.dev's `code#state`, or the whole address Cloudflare
 * sent them to. A code without its state, or with another approval's, is refused.
 */
export const readPasted = (pasted: string, state: string) => {
  const text = pasted.trim();
  let code: string | null;
  let given: string | null;
  if (/^https?:\/\//i.test(text) && URL.canParse(text)) {
    const query = new URL(text).searchParams;
    if (query.get("error")) {
      fail("Cloudflare did not approve evertap. Approve it again, or use an API token instead");
    }
    code = query.get("code");
    given = query.get("state");
  } else {
    // A state has no `#`, so the last one splits them.
    const at = text.lastIndexOf("#");
    code = at < 0 ? text : text.slice(0, at);
    given = at < 0 ? null : text.slice(at + 1);
  }
  if (!code) {
    return fail("Paste the code evertap.dev shows once you approve evertap in Cloudflare");
  }
  if (given === null) {
    return fail("Paste all of what evertap.dev shows, with the part after #");
  }
  if (given !== state) {
    return fail(
      "That code is from another approval. Approve evertap again from here, then paste the code it gives",
    );
  }
  return code;
};

const form = (fields: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
  body: new URLSearchParams(fields),
  signal: AbortSignal.timeout(30_000),
});

/**
 * Whether Cloudflare answered with a challenge for a browser instead, as it can a request from a
 * data center's address.
 */
export const challenged = (response: Response) =>
  response.headers.get("cf-mitigated") === "challenge" ||
  (response.headers.get("content-type") ?? "").includes("text/html");

/** The scopes evertap asked for that `granted` leaves out, as a person can untick some. */
export const missingScopes = (granted: string | undefined) => {
  // Cloudflare may leave the scope out when it is all that was asked for.
  if (granted === undefined) {
    return [];
  }
  const have = new Set(granted.split(/\s+/));
  return SCOPES.filter((scope) => !have.has(scope));
};

const tokenSchema = z.object({ access_token: z.string().min(1), scope: z.string().optional() });
const refusalSchema = z.object({ error: z.string() });

/** Gives the access back; false when Cloudflare did not confirm it. */
export const revoke = async (token: string) => {
  try {
    const response = await fetch(
      `${dashboard()}/oauth2/revoke`,
      form({ token, token_type_hint: "access_token", client_id: CLIENT_ID }),
    );
    return response.ok;
  } catch {
    return false;
  }
};

/**
 * Turns what the person pasted into access to their account, with the API client that uses it and
 * a way to give it back, which the caller does once its change is done.
 */
export const redeem = async (
  approval: Pick<Approval, "verifier" | "state">,
  pasted: string,
): Promise<{ api: Cloudflare; revoke: () => Promise<boolean> }> => {
  const code = readPasted(pasted, approval.state);
  let response: Response;
  try {
    response = await fetch(
      `${dashboard()}/oauth2/token`,
      form({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: approval.verifier,
      }),
    );
  } catch {
    return fail("Cannot reach Cloudflare. Check that this machine is online, then try again");
  }
  if (challenged(response)) {
    return fail(
      `Cloudflare stopped this machine's request for access, as it does some from data centers. Give evertap setup on this machine an API token instead, made at ${tokenLink()}`,
    );
  }
  const body: unknown = await response.json().catch(() => null);
  const granted = tokenSchema.safeParse(body);
  if (!response.ok || !granted.success) {
    const refusal = refusalSchema.safeParse(body);
    // The code lasts minutes and works once, and only with this approval's verifier.
    return fail(
      refusal.success && refusal.data.error === "invalid_grant"
        ? "That code has expired or was already used. Approve evertap in Cloudflare again, then paste the new code"
        : `Cloudflare did not take the code${refusal.success ? ` (${refusal.data.error})` : ""}. Approve evertap in Cloudflare again`,
    );
  }
  const token = granted.data.access_token;
  const missing = missingScopes(granted.data.scope);
  if (missing.length > 0) {
    await revoke(token);
    return fail(
      `The approval left out what evertap needs: ${missing.join(", ")}. Approve evertap again, leaving every permission it asks for on`,
    );
  }
  return { api: connectCloudflare(token, { approved: true }), revoke: () => revoke(token) };
};
