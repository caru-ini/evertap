/**
 * The Cloudflare API calls that make, move, and remove the tunnel evertap runs, with what the person
 * gives for one change: an API token pasted into setup, or access they approved in Cloudflare.
 * Whichever process makes the change, setup's or the server's, holds it, and keeps and logs none of
 * it; the settings keep only what runs the tunnel and the ids to remove it with.
 */

import { DataError } from "@evertap/api/context";
import { TUNNEL_NAME, zoneOf } from "@evertap/api/rules";
import type { Tunnel, TunnelNames, TunnelOrigins } from "@evertap/api/schemas";
import { z } from "zod";

/** Where setup takes a token from without asking, as Cloudflare's own tools do. */
export const TOKEN_VARIABLE = "CLOUDFLARE_API_TOKEN";

// Annotated so TypeScript knows code after a call is unreachable.
const fail: (message: string) => never = (message) => {
  throw new DataError(message);
};
/** On the DNS records evertap makes, so a look at the zone says where they came from. */
const COMMENT = "evertap";
/** Names evertap's Cache Rule within the zone's cache rules. */
const RULE_REF = "evertap_s3_bypass";

/**
 * What the token must allow, with the keys that fill them in on Cloudflare's token page. The
 * tunnel's and the Cache Rule's keys are the dashboard's own, missing from Cloudflare's list.
 */
export const PERMISSIONS = {
  tunnel: { key: "argotunnel", type: "edit", label: "Account · Cloudflare Tunnel · Edit" },
  dns: { key: "dns", type: "edit", label: "Zone · DNS · Edit" },
  zone: { key: "zone", type: "read", label: "Zone · Zone · Read" },
  cache: { key: "cache_settings", type: "edit", label: "Zone · Cache Rules · Edit" },
} as const;

type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * Cloudflare's page for a new token, with the permissions filled in. The page takes `zoneId` only
 * as `all` (its documentation lists the parameter as required), and the domain is unknown until the
 * token exists, so setup asks the person to narrow Zone Resources to it there.
 */
export const tokenLink = () => {
  const keys = Object.values(PERMISSIONS).map(({ key, type }) => ({ key, type }));
  return `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${encodeURIComponent(JSON.stringify(keys))}&accountId=*&zoneId=all&name=evertap`;
};

export type Zone = { id: string; name: string; accountId: string };

class CloudflareError extends Error {
  readonly status: number;
  readonly codes: number[];
  constructor(status: number, errors: { code: number; message: string }[]) {
    super(errors.map((error) => error.message).join("; ") || `status ${status}`);
    this.status = status;
    this.codes = errors.map((error) => error.code);
  }
}

const envelopeSchema = z.object({
  success: z.boolean(),
  errors: z.array(z.object({ code: z.number(), message: z.string() })).nullish(),
  result: z.unknown(),
  result_info: z.object({ total_pages: z.number().optional() }).nullish(),
});

const verifySchema = z.object({ status: z.string() });
const zoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  account: z.object({ id: z.string() }),
});
const tunnelSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string().nullish(),
  deleted_at: z.string().nullish(),
});
const recordSchema = z.object({
  id: z.string(),
  type: z.string(),
  content: z.string(),
  proxied: z.boolean().nullish(),
  comment: z.string().nullish(),
});
const ingressSchema = z.looseObject({
  hostname: z.string().nullish(),
  path: z.string().nullish(),
  service: z.string(),
});
const configurationSchema = z.object({
  config: z.looseObject({ ingress: z.array(ingressSchema).nullish() }).nullish(),
});
const rulesetSchema = z.object({
  id: z.string(),
  rules: z
    .array(z.object({ id: z.string(), ref: z.string().nullish(), expression: z.string() }))
    .nullish(),
});

const missing = (error: unknown) => error instanceof CloudflareError && error.status === 404;

// A tunnel that just lost its connector can still count it for a moment.
const ACTIVE_CONNECTIONS = 1022;

/**
 * A client for the API with one token; every refusal becomes a line on what to do. `approved` is
 * for access the person approved in Cloudflare, which their own role there bounds, rather than an
 * API token they made.
 */
export const connectCloudflare = (
  token: string,
  { approved = false } = {},
  // A stand-in for Cloudflare, in tests.
  api = process.env.EVERTAP_CLOUDFLARE_API ?? "https://api.cloudflare.com/client/v4",
) => {
  const call = async (method: string, path: string, body?: unknown) => {
    let response: Response;
    try {
      response = await fetch(`${api}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      return fail("Cannot reach Cloudflare. Check that this machine is online, then try again");
    }
    const parsed = envelopeSchema.safeParse(await response.json().catch(() => null));
    if (!response.ok || !parsed.success || !parsed.data.success) {
      throw new CloudflareError(response.status, parsed.data?.errors ?? []);
    }
    return parsed.data;
  };
  const get = async <T>(path: string, schema: z.ZodType<T>) =>
    schema.parse((await call("GET", path)).result);
  const send = async <T>(method: string, path: string, body: unknown, schema: z.ZodType<T>) =>
    schema.parse((await call(method, path, body)).result);
  /** Deletes, where something already gone is fine. */
  const remove = async (path: string) => {
    await call("DELETE", path).catch((error: unknown) => {
      if (!missing(error)) {
        throw error;
      }
    });
  };

  /** Runs `step`, turning Cloudflare's refusal into what to change about the token. */
  const as = async <T>(permission: Permission, what: string, step: () => Promise<T>) => {
    try {
      return await step();
    } catch (error) {
      if (!(error instanceof CloudflareError)) {
        throw error;
      }
      if (error.status !== 401 && error.status !== 403) {
        return fail(`Cloudflare could not ${what}: ${error.message}. Try again in a minute`);
      }
      return fail(
        approved
          ? `Cloudflare did not let evertap ${what}. Approve evertap again as a member of the account with ${permission.label}`
          : `The token can't ${what}. Give it ${permission.label} in Cloudflare, or make a new one with the link setup shows`,
      );
    }
  };

  const listZones = async () => {
    const found: Zone[] = [];
    for (let page = 1; ; page++) {
      const response = await call("GET", `/zones?status=active&per_page=50&page=${page}`);
      for (const zone of z.array(zoneSchema).parse(response.result)) {
        found.push({ id: zone.id, name: zone.name, accountId: zone.account.id });
      }
      if (page >= (response.result_info?.total_pages ?? 1)) {
        return found;
      }
    }
  };

  /** The active domains the token reaches, with the account each is in. */
  const zones = () => as(PERMISSIONS.zone, "list your domains", listZones);

  /** Throws a line saying what to do when the token cannot be used at all. */
  const verify = async () => {
    const invalid = "That token isn't valid. Copy it again from Cloudflare, or make a new one";
    // Cloudflare answers a token it does not know with a 4xx, whichever call it is.
    const unknown = (error: unknown) => {
      if (!(error instanceof CloudflareError)) {
        throw error;
      }
      return error.status < 500
        ? null
        : fail("Cloudflare could not check the token. Try again in a minute");
    };
    let status: string | null = null;
    // A token from before 2026 has no prefix to tell a user's from an account's.
    if (!token.startsWith("cfat_")) {
      status = await get("/user/tokens/verify", verifySchema).then(
        (result) => result.status,
        unknown,
      );
      if (status === null && token.startsWith("cfut_")) {
        fail(invalid);
      }
    }
    if (status === null) {
      // An account's token is checked within its account, which its domains name.
      const [zone] = (await listZones().catch(unknown)) ?? fail(invalid);
      if (!zone) {
        fail(
          "The token reaches no domain. Make a new one that includes the domain for evertap under Zone Resources",
        );
      }
      const account = await get(`/accounts/${zone.accountId}/tokens/verify`, verifySchema).catch(
        unknown,
      );
      status = account?.status ?? fail(invalid);
    }
    if (status !== "active") {
      fail(`That token is ${status}. Make a new one with the link setup shows`);
    }
  };

  const findTunnel = async (
    accountId: string,
    previous: Pick<Tunnel, "id" | "accountId"> | null,
  ) => {
    if (previous?.accountId === accountId) {
      const kept = await get(
        `/accounts/${accountId}/cfd_tunnel/${previous.id}`,
        tunnelSchema,
      ).catch((error: unknown) => {
        if (missing(error)) {
          return null;
        }
        throw error;
      });
      if (kept && !kept.deleted_at) {
        return kept;
      }
    }
    const named = (
      await get(
        `/accounts/${accountId}/cfd_tunnel?name=${TUNNEL_NAME}&is_deleted=false`,
        z.array(tunnelSchema),
      )
    ).find((tunnel) => tunnel.name === TUNNEL_NAME && !tunnel.deleted_at);
    // Serving it from here as well would split browsers between two evertaps.
    if (named && (named.status === "healthy" || named.status === "degraded")) {
      fail(
        `A tunnel named ${TUNNEL_NAME} already runs in this Cloudflare account, likely for another evertap. Delete it in Cloudflare under Networking → Tunnels, or use another account`,
      );
    }
    return named ?? null;
  };

  const records = (zoneId: string, name: string) =>
    get(
      `/zones/${zoneId}/dns_records?name.exact=${encodeURIComponent(name)}`,
      z.array(recordSchema),
    );

  /** Points `name` at the tunnel with one proxied CNAME, reusing the one there. */
  const pointAt = async (
    zoneId: string,
    name: string,
    target: string,
    found: z.infer<typeof recordSchema>[],
  ) => {
    const record = {
      type: "CNAME",
      name,
      content: target,
      proxied: true,
      ttl: 1,
      comment: COMMENT,
    };
    const [existing] = found;
    if (!existing) {
      return (await send("POST", `/zones/${zoneId}/dns_records`, record, recordSchema)).id;
    }
    if (existing.content !== target || !existing.proxied) {
      await send("PATCH", `/zones/${zoneId}/dns_records/${existing.id}`, record, recordSchema);
    }
    return existing.id;
  };

  /**
   * Puts `routes` in the tunnel in place of its routes for the names in `replaces`, keeping routes
   * the person added in Cloudflare and the one that catches the rest. A tunnel just made has none.
   */
  const route = async (
    accountId: string,
    tunnelId: string,
    routes: { hostname: string; service: string }[],
    replaces: string[],
    fresh: boolean,
  ) => {
    const path = `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`;
    const config = fresh ? null : (await get(path, configurationSchema)).config;
    const rules = config?.ingress ?? [];
    const last = rules.at(-1);
    const fallback = last && !last.hostname && !last.path ? last : { service: "http_status:404" };
    const ours = new Set([...routes.map(({ hostname }) => hostname), ...replaces]);
    const theirs = rules.filter(
      (rule) => rule !== fallback && !(rule.hostname && ours.has(rule.hostname)),
    );
    await send(
      "PUT",
      path,
      { config: { ...config, ingress: [...routes, ...theirs, fallback] } },
      z.unknown(),
    );
  };

  /** Keeps Cloudflare from caching what the public S3 entry answers, beside the zone's other rules. */
  const bypassCache = async (zoneId: string, hostname: string) => {
    const rule = {
      ref: RULE_REF,
      description: `evertap: no caching for ${hostname}, where buckets answer`,
      expression: `(http.host eq "${hostname}")`,
      action: "set_cache_settings",
      action_parameters: { cache: false },
      enabled: true,
    };
    const phase = `/zones/${zoneId}/rulesets/phases/http_request_cache_settings/entrypoint`;
    const entrypoint = await get(phase, rulesetSchema).catch((error: unknown) => {
      if (missing(error)) {
        return null;
      }
      throw error;
    });
    const ours = (ruleset: z.infer<typeof rulesetSchema>) => {
      const found = ruleset.rules?.find((each) => each.ref === RULE_REF);
      return found ? { rulesetId: ruleset.id, ruleId: found.id } : null;
    };
    if (!entrypoint) {
      return ours(await send("PUT", phase, { rules: [rule] }, rulesetSchema));
    }
    const existing = entrypoint.rules?.find((each) => each.ref === RULE_REF);
    if (!existing) {
      return ours(
        await send("POST", `/zones/${zoneId}/rulesets/${entrypoint.id}/rules`, rule, rulesetSchema),
      );
    }
    if (existing.expression !== rule.expression) {
      await send(
        "PATCH",
        `/zones/${zoneId}/rulesets/${entrypoint.id}/rules/${existing.id}`,
        rule,
        rulesetSchema,
      );
    }
    return { rulesetId: entrypoint.id, ruleId: existing.id };
  };

  return {
    verify,
    zones,

    /** The domain `names` sit in, among the active ones the access reaches, or why it is not. */
    zoneFor: async (names: TunnelNames) => {
      const reached = await zones();
      const domain = zoneOf(names.ui);
      const found = reached.find((zone) => zone.name === domain);
      if (found) {
        return found;
      }
      const above = reached.find(
        (zone) => names.ui === zone.name || names.ui.endsWith(`.${zone.name}`),
      );
      if (above) {
        return fail(
          `Choose a name one level under ${above.name}, such as evertap.${above.name}: Cloudflare's free certificate covers no deeper`,
        );
      }
      return fail(
        approved
          ? `${domain} is not in the Cloudflare account you approved. Approve evertap for the account that has it, or check the name`
          : `The token does not reach ${domain}. Make one that includes it under Zone Resources, or check the name`,
      );
    },

    /**
     * Makes the tunnel for `names` in `zone` and routes them to `origins`, reusing what evertap
     * made before. One of the person's own DNS records under those names stops it first.
     */
    setUp: async (
      zone: Zone,
      names: TunnelNames,
      origins: TunnelOrigins,
      previous: Omit<Tunnel, "token"> | null,
    ): Promise<Tunnel> => {
      const found = await as(PERMISSIONS.dns, `read the DNS records of ${zone.name}`, () =>
        Promise.all([names.ui, names.storage].map((name) => records(zone.id, name))),
      );
      // Only what an earlier setup made moves to this tunnel. A CNAME to a tunnel of the person's
      // own, such as theirs at s3.<zone>, stays theirs.
      const setUpBefore = (record: z.infer<typeof recordSchema>) =>
        record.type === "CNAME" &&
        (record.comment === COMMENT || (previous?.dnsRecordIds.includes(record.id) ?? false));
      for (const [index, name] of [names.ui, names.storage].entries()) {
        if (found[index]?.some((record) => !setUpBefore(record))) {
          fail(
            `${name} already has a DNS record of yours. Remove it in Cloudflare, or choose another name`,
          );
        }
      }
      const { tunnel, token: runToken } = await as(
        PERMISSIONS.tunnel,
        "create a tunnel",
        async () => {
          const reused = await findTunnel(zone.accountId, previous);
          const made =
            reused ??
            (await send(
              "POST",
              `/accounts/${zone.accountId}/cfd_tunnel`,
              // The API's default keeps the ingress in a local file instead.
              { name: TUNNEL_NAME, config_src: "cloudflare" },
              tunnelSchema,
            ));
          // The names it served before stay until evertap has switched, as a browser may be on
          // one; tearDown removes them.
          await route(
            zone.accountId,
            made.id,
            [
              { hostname: names.ui, service: origins.ui },
              { hostname: names.storage, service: origins.storage },
            ],
            [],
            !reused,
          );
          const runs = await get(
            `/accounts/${zone.accountId}/cfd_tunnel/${made.id}/token`,
            z.string(),
          );
          return { tunnel: made, token: runs };
        },
      );
      const target = `${tunnel.id}.cfargotunnel.com`;
      const dnsRecordIds = await as(
        PERMISSIONS.dns,
        `add DNS records to ${zone.name}`,
        async () => [
          await pointAt(zone.id, names.ui, target, found[0] ?? []),
          await pointAt(zone.id, names.storage, target, found[1] ?? []),
        ],
      );
      const cacheRule = await as(PERMISSIONS.cache, `add a Cache Rule to ${zone.name}`, () =>
        bypassCache(zone.id, names.storage),
      );
      if (!cacheRule) {
        return fail(
          `Cloudflare did not keep the Cache Rule for ${names.storage}. Try again in a minute`,
        );
      }
      return {
        id: tunnel.id,
        accountId: zone.accountId,
        zoneId: zone.id,
        zone: zone.name,
        hostnames: { ui: names.ui, storage: names.storage },
        dnsRecordIds,
        cacheRule,
        token: runToken,
      };
    },

    /**
     * Removes what evertap made for `previous` that `kept` no longer uses: its DNS records, its
     * Cache Rule, then its names' routes in the same tunnel, or the tunnel itself once cloudflared
     * has stopped.
     */
    tearDown: async (previous: Omit<Tunnel, "token">, kept: Omit<Tunnel, "token"> | null) => {
      await as(PERMISSIONS.dns, `remove DNS records from ${previous.zone}`, async () => {
        for (const id of previous.dnsRecordIds) {
          if (!kept?.dnsRecordIds.includes(id)) {
            await remove(`/zones/${previous.zoneId}/dns_records/${id}`);
          }
        }
      });
      const { rulesetId, ruleId } = previous.cacheRule;
      if (kept?.cacheRule.ruleId !== ruleId) {
        await as(PERMISSIONS.cache, `remove the Cache Rule from ${previous.zone}`, () =>
          remove(`/zones/${previous.zoneId}/rulesets/${rulesetId}/rules/${ruleId}`),
        );
      }
      if (kept?.id === previous.id) {
        const names = [kept.hostnames.ui, kept.hostnames.storage];
        const gone = [previous.hostnames.ui, previous.hostnames.storage].filter(
          (name) => !names.includes(name),
        );
        if (gone.length > 0) {
          await as(PERMISSIONS.tunnel, "update the tunnel's routes", () =>
            route(previous.accountId, previous.id, [], gone, false),
          );
        }
        return;
      }
      const tunnel = `/accounts/${previous.accountId}/cfd_tunnel/${previous.id}`;
      await as(PERMISSIONS.tunnel, "delete the tunnel", async () => {
        for (let attempt = 0; ; attempt++) {
          await remove(`${tunnel}/connections`);
          try {
            await remove(tunnel);
            return;
          } catch (error) {
            if (
              !(error instanceof CloudflareError && error.codes.includes(ACTIVE_CONNECTIONS)) ||
              attempt >= 10
            ) {
              throw error;
            }
            await Bun.sleep(1000);
          }
        }
      });
    },
  };
};

export type Cloudflare = ReturnType<typeof connectCloudflare>;
