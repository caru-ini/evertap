import { ORPCError } from "@orpc/server";
import { z } from "zod";

import type { Context } from "../context.ts";
import { personProcedure, signedInProcedure } from "../procedures.ts";
import { bucketsGuide, explainProbe, proxyConfigs, tunnelOrigins } from "../proxy.ts";
import { STORAGE_URL_EXAMPLE, browserName } from "../rules.ts";
import {
  type DoctorReport,
  type SavedSettings,
  type Settings,
  type TunnelChange,
  doctorReportSchema,
  networkGuideSchema,
  reachSchema,
  savedSettingsSchema,
  settingsSchema,
  settingsPreviewSchema,
  settingsUpdateSchema,
  systemStatusSchema,
  tunnelChangeSchema,
  tunnelOriginsSchema,
  tunnelOutcomeSchema,
  tunnelProgressSchema,
} from "../schemas.ts";
import {
  cameThroughTunnel,
  choiceOf,
  cutsOff,
  exposedAt,
  listenChoices,
  localUrl,
  lockedBy,
  plannedTunnel,
  resolveSettings,
  type SettingsEnvironment,
} from "../settings.ts";
import { approverOf, startRequest } from "./clients.ts";

// Paths, the Docker socket, and raw start errors describe the machine; the network sees the verdicts.
// Listed field by field, so a local-only field added later stays hidden until chosen here.
const forNetwork = (report: DoctorReport): DoctorReport => ({
  version: report.version,
  update: report.update,
  docker: report.docker && {
    reachable: report.docker.reachable,
    version: report.docker.version,
    apiVersion: report.docker.apiVersion,
    warnings: report.docker.warnings,
  },
  engines: report.engines.map(({ engine, state }) => ({ engine, state })),
  machine: report.machine,
  access: report.access,
  tunnel: report.tunnel && {
    hostname: report.tunnel.hostname,
    state: report.tunnel.state,
    connections: report.tunnel.connections,
  },
  lan: report.lan,
  entries: report.entries,
  conflicts: report.conflicts,
});

const tunnelOf = (settings: SavedSettings | null) =>
  settings?.mode === "cloudflare" ? JSON.stringify(settings.tunnel) : "null";

/**
 * The settings `input` would put in force, or why evertap refuses them, and whether they leave this
 * browser without its way in. That goes ahead: the browser signs in at the new address instead.
 */
const check = async (input: SavedSettings, context: Context) => {
  const { saved, environment } = await context.store.settings();
  const current = resolveSettings(saved, environment);
  const variable = lockedBy(current, input);
  if (variable) {
    throw new ORPCError("BAD_REQUEST", {
      message: `${variable} sets this where evertap runs. Change it there`,
    });
  }
  const next = resolveSettings(input, environment);
  const { publicUrl, storageUrl } = next;
  // A proxy or tunnel tells the two apart by address alone: a path would break signatures.
  if (storageUrl.value !== null && storageUrl.value === publicUrl.value) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Give buckets an address of their own, such as ${STORAGE_URL_EXAMPLE}`,
    });
  }
  // The machine's own CLI reaches evertap over its socket, which no setting moves.
  const cutOff =
    context.caller.kind !== "local" &&
    cutsOff(current, next, environment, context.reqHeaders?.get("host"));
  return { next, cutOff, environment };
};

/** The settings `input` would put in force, or the refusal `update` would give. */
const settingsAfter = async (input: SavedSettings, context: Context) => {
  const { saved } = await context.store.settings();
  // A tunnel comes from evertap's own change in Cloudflare, or from setup on this machine. Other
  // callers keep the one in force or drop it, which leaves it in Cloudflare for the person.
  if (
    context.caller.kind !== "local" &&
    input.mode === "cloudflare" &&
    tunnelOf(saved) !== tunnelOf(input)
  ) {
    throw new ORPCError("FORBIDDEN", {
      message:
        "Set up the tunnel evertap runs in Settings by approving evertap in Cloudflare, or with evertap setup",
    });
  }
  return check(input, context);
};

/**
 * Whether evertap would make `change`, checked before the person approves it in Cloudflare and
 * again before it starts.
 */
const checkChange = async (change: TunnelChange, context: Context) => {
  const { saved } = await context.store.settings();
  if (change.action === "set-up") {
    const kept = saved?.mode === "cloudflare" ? saved.tunnel : null;
    return check(plannedTunnel(change.names, kept), context);
  }
  if (saved?.mode !== "cloudflare") {
    throw new ORPCError("BAD_REQUEST", {
      message: "evertap runs no tunnel to remove. Reload Settings",
    });
  }
  if (change.next.mode === "cloudflare") {
    throw new ORPCError("BAD_REQUEST", {
      message: "Choose settings without the tunnel to remove it",
    });
  }
  return check(change.next, context);
};

/** Who started an approval in Cloudflare, so only they can finish it. */
const sessionOf = ({ caller }: Context) =>
  caller.kind === "person" ? (caller.client?.id ?? "demo") : caller.kind;

/** A one-time link that signs this browser in at `origin`, as a person here may let a browser in. */
const signInAt = async (context: Context, origin: string) => {
  const started = await startRequest(context, {
    kind: "browser",
    name: browserName(context.reqHeaders?.get("user-agent")),
  });
  await context.store.approvePairing(started.code, approverOf(context));
  // In the fragment, so the secret never reaches a request log.
  return `${origin}/signin#${started.requestId}`;
};

/**
 * A one-time sign-in link at the address `next` opens evertap at, for a browser a change leaves
 * without its way in. None where only the machine running evertap opens it, or none is known.
 */
const handOver = (context: Context, next: Settings, environment: SettingsEnvironment) => {
  const url = next.publicUrl.value;
  return url === null || choiceOf(next, environment) === "local" ? null : signInAt(context, url);
};

export const systemRouter = {
  status: signedInProcedure
    .output(systemStatusSchema)
    .handler(({ context }) => context.store.status()),
  doctor: signedInProcedure.output(doctorReportSchema).handler(async ({ context }) => {
    const report = await context.store.doctor();
    return context.caller.kind === "local" ? report : forNetwork(report);
  }),
  // A client could open evertap to more of the network than the person chose.
  settings: {
    get: personProcedure.output(settingsSchema).handler(async ({ context }) => {
      const { saved, environment } = await context.store.settings();
      return resolveSettings(saved, environment);
    }),
    // Lets the UI show the new URL, or why not, before anything moves.
    preview: personProcedure
      .input(savedSettingsSchema)
      .output(settingsPreviewSchema)
      .handler(async ({ input, context }) => {
        const { next, cutOff } = await settingsAfter(input, context);
        return { settings: next, cutOff };
      }),
    update: personProcedure
      .input(savedSettingsSchema)
      .output(settingsUpdateSchema)
      .handler(async ({ input, context }) => {
        const { next, cutOff, environment } = await settingsAfter(input, context);
        await context.store.saveSettings(input);
        return {
          settings: next,
          signIn: cutOff ? await handOver(context, next, environment) : null,
        };
      }),
    network: personProcedure.output(networkGuideSchema).handler(async ({ context }) => {
      const { saved, environment } = await context.store.settings();
      const settings = resolveSettings(saved, environment);
      return {
        listenChoices: listenChoices(environment),
        exposedAt: exposedAt(settings.listenHost.value, environment),
        localUrl: localUrl(environment),
        proxy: proxyConfigs(settings, environment.port),
        buckets: bucketsGuide(settings, environment),
      };
    }),
    origins: personProcedure
      .output(tunnelOriginsSchema)
      .handler(async ({ context }) => tunnelOrigins((await context.store.settings()).environment)),
    // A person makes, moves, or removes the tunnel evertap runs with access they give it in
    // Cloudflare: `start` sends them to approve it there, and `finish` takes the code they bring back.
    tunnel: {
      start: personProcedure
        .input(tunnelChangeSchema)
        .output(z.object({ url: z.string() }))
        .handler(async ({ input, context }) => {
          await checkChange(input, context);
          return { url: await context.store.approveCloudflare(sessionOf(context)) };
        }),
      // Where the change `finish` waits on is, for the page to show while it does.
      progress: personProcedure.output(tunnelProgressSchema).handler(async ({ context }) => ({
        phase: await context.store.tunnelProgress(sessionOf(context)),
      })),
      finish: personProcedure
        .input(z.object({ change: tunnelChangeSchema, pasted: z.string().trim().min(1) }))
        .output(tunnelOutcomeSchema)
        .handler(async ({ input, context }) => {
          const { cutOff } = await checkChange(input.change, context);
          const before = await context.store.settings();
          const result = await context.store.changeTunnel(
            sessionOf(context),
            input.pasted,
            input.change,
            {
              answerFirst: cameThroughTunnel(
                resolveSettings(before.saved, before.environment),
                context.reqHeaders?.get("host"),
              ),
            },
          );
          const { saved, environment } = await context.store.settings();
          const settings = resolveSettings(saved, environment);
          return {
            ...result,
            settings,
            signIn: cutOff ? await handOver(context, settings, environment) : null,
          };
        }),
    },
    check: personProcedure.output(reachSchema).handler(async ({ context }) => {
      const { saved, environment } = await context.store.settings();
      const settings = resolveSettings(saved, environment);
      const url = settings.publicUrl.value;
      if (url === null) {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "Set the address browsers open evertap at first, with evertap setup on the machine running evertap",
        });
      }
      return explainProbe(settings, environment, url, await context.store.probe(url));
    }),
  },
};
