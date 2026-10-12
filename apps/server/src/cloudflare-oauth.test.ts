import { createHash } from "node:crypto";

import { DataError } from "@evertap/api/context";
import { describe, expect, it } from "vitest";

import {
  CLIENT_ID,
  SCOPES,
  challenged,
  missingScopes,
  readPasted,
  startApproval,
} from "./cloudflare-oauth.ts";

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof DataError ? error.message : `not a DataError: ${String(error)}`;
  }
  return "accepted";
};

describe("an approval", () => {
  it("holds a 96-byte verifier and a 32-byte state, and sends only the verifier's hash", () => {
    const { verifier, state, url } = startApproval();
    expect(verifier).toMatch(/^[\w-]{128}$/);
    expect(state).toMatch(/^[\w-]{43}$/);
    const query = new URL(url).searchParams;
    expect(query.get("client_id")).toBe(CLIENT_ID);
    expect(query.get("state")).toBe(state);
    expect(query.get("code_challenge")).toBe(
      createHash("sha256").update(verifier).digest("base64url"),
    );
    expect(query.get("code_challenge_method")).toBe("S256");
    expect(query.get("scope")?.split(" ")).toEqual(SCOPES);
    // No refresh token: the access lasts one change.
    expect(url).not.toContain("offline_access");
    expect(url).not.toContain(verifier);
  });

  it("is new each time", () => {
    const first = startApproval();
    const second = startApproval();
    expect(second.verifier).not.toBe(first.verifier);
    expect(second.state).not.toBe(first.state);
  });
});

describe("what the person pastes", () => {
  const STATE = "s".repeat(43);

  it("takes evertap.dev's code#state, splitting at the last #", () => {
    expect(readPasted(`  ory_ac_abc#def#${STATE}\n`, STATE)).toBe("ory_ac_abc#def");
  });

  it("takes the address Cloudflare sent the browser to", () => {
    expect(
      readPasted(
        `https://evertap.dev/auth/cloudflare?code=ory_ac_abc&scope=zone.read&state=${STATE}`,
        STATE,
      ),
    ).toBe("ory_ac_abc");
  });

  it("refuses a code alone, another approval's, or a refusal", () => {
    expect(refusal(() => readPasted("ory_ac_abc", STATE))).toBe(
      "Paste all of what evertap.dev shows, with the part after #",
    );
    expect(refusal(() => readPasted("https://evertap.dev/auth/cloudflare?code=abc", STATE))).toBe(
      "Paste all of what evertap.dev shows, with the part after #",
    );
    expect(refusal(() => readPasted(`ory_ac_abc#${"t".repeat(43)}`, STATE))).toBe(
      "That code is from another approval. Approve evertap again from here, then paste the code it gives",
    );
    expect(refusal(() => readPasted(`#${STATE}`, STATE))).toBe(
      "Paste the code evertap.dev shows once you approve evertap in Cloudflare",
    );
    expect(
      refusal(() =>
        readPasted(`https://evertap.dev/auth/cloudflare?error=access_denied&state=${STATE}`, STATE),
      ),
    ).toBe("Cloudflare did not approve evertap. Approve it again, or use an API token instead");
  });
});

describe("the access Cloudflare gives", () => {
  it("names the scopes the person left out", () => {
    expect(missingScopes(SCOPES.join(" "))).toEqual([]);
    expect(missingScopes("zone.read dns.read argotunnel.write")).toEqual([
      "dns.write",
      "cache-settings.read",
      "cache-settings.write",
    ]);
    // Cloudflare may leave the scope out when it gave all that was asked for.
    expect(missingScopes(undefined)).toEqual([]);
  });

  it("tells a challenge for a browser from Cloudflare's answer", () => {
    const html = { "content-type": "text/html; charset=UTF-8" };
    expect(
      challenged(new Response("", { status: 403, headers: { "cf-mitigated": "challenge" } })),
    ).toBe(true);
    expect(challenged(new Response("<!DOCTYPE html>", { status: 403, headers: html }))).toBe(true);
    expect(challenged(Response.json({ error: "invalid_grant" }, { status: 400 }))).toBe(false);
    expect(challenged(Response.json({ access_token: "x" }))).toBe(false);
  });
});
