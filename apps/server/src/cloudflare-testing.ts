import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

/** The API token the stand-in takes. */
export const TOKEN = "cfut_good";

/** Cloudflare's answer, as its API wraps every result. */
const result = (value: unknown, status = 200) =>
  Response.json(
    { success: true, errors: [], result: value, result_info: { total_pages: 1 } },
    { status },
  );

const refusal = (status: number, code: number, message: string) =>
  Response.json({ success: false, errors: [{ code, message }], result: null }, { status });

const bodySchema = z.object({
  name: z.string().default(""),
  type: z.string().default(""),
  content: z.string().default(""),
  proxied: z.boolean().default(false),
  comment: z.string().nullish(),
  config: z.unknown().optional(),
  ref: z.string().default(""),
  expression: z.string().default(""),
  rules: z.array(z.object({ ref: z.string(), expression: z.string() })).default([]),
});

type Rule = { id: string; ref: string; expression: string };

type FakeState = {
  calls: string[];
  zones: { id: string; name: string; account: { id: string } }[];
  tunnels: Map<string, { id: string; name: string; status: string; config?: unknown }>;
  records: Map<
    string,
    {
      id: string;
      zone: string;
      name: string;
      type: string;
      content: string;
      proxied: boolean;
      comment?: string | null;
    }
  >;
  rulesets: Map<string, { id: string; rules: Rule[] }>;
  /** Paths that fail instead: 403 for what the access may not do, 500 for Cloudflare's own trouble. */
  failing: { path: RegExp; status: 403 | 500 } | null;
  /** What approving evertap grants, when not all it asked for. */
  granted: string[] | null;
  /** Whether the token endpoint challenges the request as from a bot. */
  challenge: boolean;
  /** Whether revoking fails. */
  revokeFails: boolean;
  /** Approvals by code: the challenge they must match, the scopes asked for, and where they go. */
  codes: Map<string, { challenge: string; scope: string; redirectUri: string }>;
  /** Access tokens handed out, and whether each still works. */
  access: Map<string, { revoked: boolean }>;
  next: number;
};

/**
 * A stand-in for Cloudflare in tests: its API as evertap uses it, for the API token `TOKEN` and
 * for access approved on its OAuth pages, on two domains in one account. Point evertap at it with
 * `env`.
 */
export const startFakeCloudflare = () => {
  const state: FakeState = {
    calls: [],
    zones: [
      { id: "zone-1", name: "example.com", account: { id: "account-1" } },
      { id: "zone-2", name: "example.net", account: { id: "account-1" } },
    ],
    tunnels: new Map(),
    records: new Map(),
    rulesets: new Map(),
    failing: null,
    granted: null,
    challenge: false,
    revokeFails: false,
    codes: new Map(),
    access: new Map(),
    next: 0,
  };
  const id = (kind: string) => `${kind}-${++state.next}`;
  const authorized = (header: string | null) => {
    const token = header?.replace(/^Bearer /, "") ?? "";
    return token === TOKEN || state.access.get(token)?.revoked === false;
  };

  const oauth = async (request: Request, url: URL) => {
    if (url.pathname === "/oauth2/auth") {
      const query = url.searchParams;
      const code = `ory_ac_${randomBytes(12).toString("base64url")}`;
      state.codes.set(code, {
        challenge: query.get("code_challenge") ?? "",
        scope: query.get("scope") ?? "",
        redirectUri: query.get("redirect_uri") ?? "",
      });
      const back = new URL(query.get("redirect_uri") ?? "");
      back.search = new URLSearchParams({
        code,
        scope: query.get("scope") ?? "",
        state: query.get("state") ?? "",
      }).toString();
      return Response.redirect(back.href, 302);
    }
    const form = new URLSearchParams(await request.text());
    if (url.pathname === "/oauth2/revoke") {
      const access = state.access.get(form.get("token") ?? "");
      if (state.revokeFails || !form.get("client_id")) {
        return Response.json({ error: "server_error" }, { status: 500 });
      }
      if (access) {
        access.revoked = true;
      }
      return new Response(null, { status: 200 });
    }
    if (state.challenge) {
      return new Response("<!DOCTYPE html><title>Just a moment...</title>", {
        status: 403,
        headers: { "content-type": "text/html; charset=UTF-8", "cf-mitigated": "challenge" },
      });
    }
    const approval = state.codes.get(form.get("code") ?? "");
    const verifier = form.get("code_verifier") ?? "";
    if (
      !approval ||
      form.get("grant_type") !== "authorization_code" ||
      form.get("redirect_uri") !== approval.redirectUri ||
      createHash("sha256").update(verifier).digest("base64url") !== approval.challenge
    ) {
      return Response.json(
        {
          error: "invalid_grant",
          error_description: "The provided authorization grant is invalid",
        },
        { status: 400 },
      );
    }
    state.codes.delete(form.get("code") ?? "");
    const token = `ory_at_${randomBytes(12).toString("base64url")}`;
    state.access.set(token, { revoked: false });
    return Response.json({
      access_token: token,
      token_type: "bearer",
      expires_in: 3599,
      scope: (state.granted ?? approval.scope.split(" ")).join(" "),
    });
  };

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/oauth2/")) {
        state.calls.push(`${request.method} ${url.pathname}`);
        return oauth(request, url);
      }
      const path = url.pathname.replace("/client/v4", "");
      state.calls.push(`${request.method} ${path}`);
      if (!authorized(request.headers.get("authorization"))) {
        return refusal(401, 1000, "Invalid API Token");
      }
      if (state.failing?.path.test(path)) {
        return state.failing.status === 403
          ? refusal(403, 10000, "Authentication error")
          : refusal(500, 10002, "An unknown error has occurred");
      }
      const body = bodySchema.parse(
        request.method === "GET" || request.method === "DELETE" ? {} : await request.json(),
      );
      const parts = path.split("/").slice(1);
      if (path === "/user/tokens/verify") {
        return result({ id: "token-1", status: "active" });
      }
      if (path === "/zones") {
        return result(state.zones);
      }
      if (parts[0] === "accounts" && parts[2] === "cfd_tunnel") {
        const tunnel = parts[3] ? state.tunnels.get(parts[3]) : undefined;
        if (parts.length === 3 && request.method === "GET") {
          return result(
            [...state.tunnels.values()].filter(
              (each) => each.name === url.searchParams.get("name"),
            ),
          );
        }
        if (parts.length === 3 && request.method === "POST") {
          const made = { id: id("tunnel"), name: body.name, status: "inactive" };
          state.tunnels.set(made.id, made);
          return result(made);
        }
        if (!tunnel) {
          return refusal(404, 1003, "Tunnel not found");
        }
        if (parts[4] === "configurations") {
          if (request.method === "GET") {
            return result({ tunnel_id: tunnel.id, config: tunnel.config ?? null });
          }
          tunnel.config = body.config;
          // cloudflared connects as soon as evertap starts it.
          tunnel.status = "healthy";
          return result({ config: body.config });
        }
        if (parts[4] === "token") {
          return result(`run-${tunnel.id}`);
        }
        if (parts[4] === "connections") {
          tunnel.status = "inactive";
          return result({});
        }
        if (request.method === "DELETE") {
          if (tunnel.status !== "inactive") {
            return refusal(400, 1022, "Cannot delete tunnel because it has active connections");
          }
          state.tunnels.delete(tunnel.id);
          return result({ id: tunnel.id });
        }
        return result(tunnel);
      }
      const zone = parts[1] ?? "";
      if (parts[2] === "dns_records") {
        if (request.method === "GET") {
          const name = url.searchParams.get("name.exact");
          return result(
            [...state.records.values()].filter((each) => each.zone === zone && each.name === name),
          );
        }
        if (request.method === "POST") {
          const made = {
            id: id("record"),
            zone,
            name: body.name,
            type: body.type,
            content: body.content,
            proxied: body.proxied,
            comment: body.comment,
          };
          state.records.set(made.id, made);
          return result(made);
        }
        const record = state.records.get(parts[3] ?? "");
        if (!record) {
          return refusal(404, 81044, "Record does not exist");
        }
        if (request.method === "DELETE") {
          state.records.delete(record.id);
          return result({ id: record.id });
        }
        Object.assign(record, {
          type: body.type,
          content: body.content,
          proxied: body.proxied,
          comment: body.comment,
        });
        return result(record);
      }
      if (parts[2] === "rulesets") {
        if (parts[3] === "phases") {
          const ruleset = state.rulesets.get(zone);
          if (request.method === "GET") {
            return ruleset ? result(ruleset) : refusal(404, 10003, "Not found");
          }
          const made = {
            id: id("ruleset"),
            rules: body.rules.map((rule) => ({ ...rule, id: id("rule") })),
          };
          state.rulesets.set(zone, made);
          return result(made);
        }
        const ruleset = state.rulesets.get(zone);
        if (!ruleset || ruleset.id !== parts[3]) {
          return refusal(404, 10003, "Not found");
        }
        if (request.method === "POST") {
          ruleset.rules.push({ id: id("rule"), ref: body.ref, expression: body.expression });
        } else if (request.method === "DELETE") {
          ruleset.rules = ruleset.rules.filter((rule) => rule.id !== parts[5]);
        } else {
          ruleset.rules = ruleset.rules.map((rule) =>
            rule.id === parts[5]
              ? { id: rule.id, ref: body.ref, expression: body.expression }
              : rule,
          );
        }
        return result(ruleset);
      }
      return refusal(404, 7003, "No route for that URI");
    },
  });

  return {
    state,
    /** Points evertap's calls to Cloudflare here. */
    env: {
      EVERTAP_CLOUDFLARE_API: `http://127.0.0.1:${server.port}/client/v4`,
      EVERTAP_CLOUDFLARE_DASH: `http://127.0.0.1:${server.port}`,
    },
    /** Starts over with nothing made and nothing failing. */
    reset: () => {
      state.calls = [];
      state.tunnels.clear();
      state.records.clear();
      state.rulesets.clear();
      state.failing = null;
      state.granted = null;
      state.challenge = false;
      state.revokeFails = false;
      state.codes.clear();
      state.access.clear();
    },
    /** What evertap made, without ids. */
    made: () => ({
      tunnels: [...state.tunnels.values()].map(({ name, config }) => ({ name, config })),
      records: [...state.records.values()].map(({ zone, name, type, content, proxied }) => ({
        zone,
        name,
        type,
        content,
        proxied,
      })),
      rules: [...state.rulesets.entries()].flatMap(([zone, { rules }]) =>
        rules.map(({ ref, expression }) => ({ zone, ref, expression })),
      ),
    }),
    /**
     * Approves on Cloudflare's consent page at `url`, as a person does in a browser, and gives
     * what evertap.dev shows to paste: `code#state`.
     */
    approve: async (url: string) => {
      const response = await fetch(url, { redirect: "manual" });
      const back = new URL(response.headers.get("location") ?? "");
      return `${back.searchParams.get("code")}#${back.searchParams.get("state")}`;
    },
    stop: () => server.stop(true),
  };
};
