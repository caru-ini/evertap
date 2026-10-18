/** `evertap setup`: how other machines reach evertap, chosen by answering questions or by flags. */

import { DataError } from "@evertap/api/context";
import type { AppRouterClient } from "@evertap/api/router";
import {
  ACCESS_CHOICE_NAMES,
  ACCESS_MODES,
  ACCESS_QUESTION,
  type AccessChoice,
  type AccessMode,
  CLOUDFLARE_CONNECTED_APPS,
  DATABASE_ADDRESS,
  DATABASE_HOST,
  PROXY_PLACES,
  RESOURCE_ENGINES,
  RESOURCE_PORTS,
  SETTING_VARIABLES,
  accessChoice,
  defaultTunnelNames,
  exposedWarning,
  networkChoice,
  offeredChoices,
  tunnelLeftovers,
  zoneOf,
} from "@evertap/api/rules";
import {
  type NetworkGuide,
  type SavedSettings,
  type Settings,
  type TunnelNames,
  listenHostSchema,
  publicUrlSchema,
  storageUrlSchema,
  tunnelNamesSchema,
} from "@evertap/api/schemas";
import { plannedTunnel } from "@evertap/api/settings";
import { renderUnicodeCompact } from "uqr";

import { redeem, startApproval } from "../cloudflare-oauth.ts";
import {
  type Cloudflare,
  PERMISSIONS,
  TOKEN_VARIABLE,
  type Zone,
  connectCloudflare,
  tokenLink,
} from "../cloudflare.ts";
import { config } from "../config.ts";
import { conflictsWith } from "../doctor.ts";
import { createDocker } from "../live/docker.ts";
import {
  loopbackRemoval,
  loopbackSetup,
  readLoopback,
  runAsRoot,
  sharingAdvice,
} from "../loopback.ts";
import { normalizeUrl } from "./settings.ts";
import { UsageError, ask, askSecret, choose, fail, openBrowser, print, warn } from "./terminal.ts";

export type SetupFlags = {
  mode?: string;
  url?: string;
  listen?: string;
  zone?: string;
  s3Url?: string;
};

/** What each step of setup goes by. */
type Step = {
  client: AppRouterClient;
  /** The settings in force before setup, each with where it came from. */
  current: Settings;
  /** Where browsers open evertap from before setup; null until it is set up. */
  was: AccessChoice | null;
  /** What choosing needs to know about this machine. */
  guide: NetworkGuide;
  flags: SetupFlags;
  /** False when flags answer instead, and nothing is asked. */
  interactive: boolean;
  /** Access to Cloudflare and the names chosen with it, from `ask` on; it stays in this process. */
  cloudflare?: { api: Cloudflare; zone: Zone; names: TunnelNames };
  /** Gives back access approved in Cloudflare, until setup has. */
  revoke?: () => Promise<boolean>;
};

/** One choice's part of setup; what a choice needs beyond its settings slots in here. */
type ChoiceSetup = {
  /** What to save, asked or taken from the flags; null keeps the settings in force. */
  ask: (step: Step) => Promise<SavedSettings | null>;
  /** Runs before saving, and gives what to save; throwing stops setup with nothing saved. */
  before?: (step: Step, saved: SavedSettings) => Promise<SavedSettings>;
  /** Runs once the settings are in force, before signing in. */
  after?: (step: Step, settings: Settings) => Promise<void>;
  /** Runs once `saved` is in force over this choice, to undo what it set up that `saved` does not keep. */
  leave?: (step: Step, saved: SavedSettings) => Promise<void>;
  /** Opens a signed-in browser on this machine, instead of a link and QR code for another one. */
  opensBrowser: boolean;
};

const isMode = (value: string): value is AccessMode => ACCESS_MODES.some((mode) => mode === value);

/** A typed address as evertap keeps it, or the reason it is not one. */
const parseUrl = (typed: string) => publicUrlSchema.safeParse(normalizeUrl(typed));

const flagUrl = (typed: string | undefined) => {
  if (typed === undefined) {
    return undefined;
  }
  const parsed = parseUrl(typed);
  return parsed.success ? parsed.data : fail(`--url: ${parsed.error.issues[0]?.message}`);
};

/** The address for buckets reached from anywhere, or else the one saved for `mode`. */
const storageUrl = ({ current, flags }: Step, mode: AccessMode) => {
  if (flags.s3Url === undefined) {
    return current.mode.value === mode ? current.storageUrl.value : null;
  }
  const parsed = storageUrlSchema.safeParse(normalizeUrl(flags.s3Url));
  return parsed.success ? parsed.data : fail(`--s3-url: ${parsed.error.issues[0]?.message}`);
};

const flagListen = (typed: string | undefined) => {
  if (typed === undefined) {
    return undefined;
  }
  const parsed = listenHostSchema.safeParse(typed);
  return parsed.success ? parsed.data : fail(`--listen: ${parsed.error.issues[0]?.message}`);
};

/**
 * Asks until it gets an address. Enter keeps `kept`, or without it gives null, which `otherwise`
 * names; with neither, an address is needed.
 */
const askUrl = async (question: string, kept: string | null, otherwise: string | null) => {
  const enter = kept ? ` (Enter keeps ${kept})` : otherwise ? ` (Enter for ${otherwise})` : "";
  for (;;) {
    const typed = await ask(`? ${question}${enter}: `);
    if (typed === "" && (kept !== null || otherwise !== null)) {
      return kept;
    }
    const parsed = parseUrl(typed);
    if (parsed.success) {
      return parsed.data;
    }
    print(`  ${parsed.error.issues[0]?.message}`);
  }
};

/** A value an environment variable fixes is shown, not asked. */
const showFixed = (step: Step, name: string, value: string, variable: string) => {
  if (step.interactive) {
    print(`  ${name}: ${value}, set by ${variable}`);
  }
};

/** The saved address, while setup stays in the mode it was saved for. */
const savedUrl = ({ current }: Step, mode: AccessMode) =>
  current.mode.value === mode && current.publicUrl.source === "saved"
    ? current.publicUrl.value
    : null;

const dockerOf = ({ listenChoices }: NetworkGuide) =>
  listenChoices.find(({ use }) => use === "docker")?.address ?? null;

/**
 * Where network mode listens without a question: a flag, what is in force while setup stays with
 * it or an environment variable sets it, else what `choice` needs.
 */
const listenFor = ({ current, was, flags }: Step, choice: "network" | "proxy") =>
  flagListen(flags.listen) ??
  (current.listenHost.source === "env" || was === choice
    ? current.listenHost.value
    : choice === "network"
      ? "0.0.0.0"
      : "127.0.0.1");

/**
 * Devices on the network open evertap where it listens on every interface, or on one address of
 * this machine such as its Tailscale address. Questions ask for an address only when evertap
 * cannot tell its own; `--url` gives one, such as its name on the network.
 */
const askNetwork = async (step: Step): Promise<SavedSettings> => {
  const { current, flags, interactive, guide } = step;
  if (flags.zone !== undefined) {
    fail("Drop --zone: it names the domain for a Cloudflare Tunnel evertap creates");
  }
  const listenHost = listenFor(step, "network");
  if (current.listenHost.source === "env") {
    showFixed(step, "Listens on", listenHost, SETTING_VARIABLES.listenHost);
  }
  const chosen = guide.listenChoices.find(({ address }) => address === listenHost);
  if (chosen?.exposes) {
    warn(`Warning: ${exposedWarning(chosen.exposes)}`);
  }
  // A flag that an environment variable overrides still goes along, for evertap to refuse.
  let publicUrl =
    flagUrl(flags.url) ??
    (interactive && step.was !== "network" ? null : savedUrl(step, "network"));
  if (current.publicUrl.source === "env" && current.publicUrl.value !== null) {
    showFixed(step, "Address", current.publicUrl.value, SETTING_VARIABLES.publicUrl);
  } else if (interactive && publicUrl === null && chosen?.use === "lan" && !chosen.defaultUrl) {
    publicUrl = await askUrl(
      "evertap can't tell this machine's address on your network. Address browsers open it at",
      null,
      null,
    );
  }
  return { mode: "network", listenHost, publicUrl, storageUrl: storageUrl(step, "network") };
};

/** A proxy or tunnel the person runs, on this machine or in Docker, and the address it serves. */
const askProxy = async (step: Step): Promise<SavedSettings> => {
  const { current, flags, interactive, guide } = step;
  if (flags.zone !== undefined) {
    fail("Drop --zone: it names the domain for a Cloudflare Tunnel evertap creates");
  }
  let listenHost = listenFor(step, "proxy");
  const docker = dockerOf(guide);
  if (current.listenHost.source === "env") {
    showFixed(step, "Listens on", listenHost, SETTING_VARIABLES.listenHost);
  } else if (interactive && flags.listen === undefined && docker !== null) {
    listenHost = await choose(
      "Where does it run?",
      [
        { value: "127.0.0.1", tag: null, ...PROXY_PLACES.proxy },
        { value: docker, tag: null, ...PROXY_PLACES.docker },
      ],
      listenHost === docker ? docker : "127.0.0.1",
    );
  }
  let publicUrl = flagUrl(flags.url) ?? savedUrl(step, "network");
  if (current.publicUrl.source === "env" && current.publicUrl.value !== null) {
    showFixed(step, "Address", current.publicUrl.value, SETTING_VARIABLES.publicUrl);
  } else if (interactive) {
    publicUrl = await askUrl(
      "Address your proxy or tunnel serves evertap at, such as https://evertap.example.com",
      step.was === "proxy" ? publicUrl : null,
      null,
    );
  } else if (publicUrl === null) {
    fail(
      "Add --url with the address your proxy or tunnel serves evertap at, or --listen 0.0.0.0 for devices on your network",
    );
  }
  return { mode: "network", listenHost, publicUrl, storageUrl: storageUrl(step, "network") };
};

/** Whether the address reaches this evertap. Asks to check again until it does, or the person moves on. */
const checkAddress = async ({ client, interactive }: Step) => {
  // Without a terminal the outcome goes with the errors, as nobody is there to fix it now.
  const tell = interactive ? print : warn;
  for (;;) {
    const { url, result, problems } = await client.system.settings.check();
    if (problems.length === 0) {
      print(`Checked: ${url} reaches this evertap`);
      return;
    }
    tell(
      result === "reached"
        ? `${url} reaches this evertap, but:`
        : `${url} does not reach this evertap yet:`,
    );
    for (const problem of problems) {
      tell(`  ${problem}`);
    }
    if (!interactive || /^s/i.test(await ask("? Enter checks again, s skips: "))) {
      return;
    }
  }
};

/**
 * What to paste into the proxy, when one stands in front, for evertap and for buckets reached from
 * anywhere, and whether the address then reaches this evertap.
 */
const afterNetwork = async (step: Step, settings: Settings) => {
  const { proxy, buckets } = await step.client.system.settings.network();
  if (proxy) {
    print();
    print(`Have your proxy pass requests on to ${proxy.upstream}. For Caddy, in its Caddyfile:`);
    print();
    print(proxy.caddy);
    print("For nginx:");
    print();
    print(proxy.nginx);
  }
  const bucketsAt = settings.storageUrl.value;
  const forBuckets = bucketsAt === null ? null : (buckets?.proxy ?? null);
  if (forBuckets) {
    print();
    print(
      `For buckets reached from anywhere, have it serve ${bucketsAt} from ${buckets?.upstream}. For Caddy:`,
    );
    print();
    print(forBuckets.caddy);
    print("For nginx:");
    print();
    print(forBuckets.nginx);
  }
  if (step.interactive && (proxy || forBuckets)) {
    await ask("? Press Enter once your proxy uses it, to check the address: ");
  }
  await checkAddress(step);
};

const showTokenLink = () => {
  const link = tokenLink();
  print();
  print("evertap creates the tunnel with a Cloudflare API token. It uses the token for this setup");
  print("only and does not keep it. Make one with these permissions; the link fills them in:");
  print();
  for (const { label } of Object.values(PERMISSIONS)) {
    print(`  ${label}`);
  }
  print();
  print("If one is missing on the page, add it by hand. Under Zone Resources, change All zones to");
  print("the domain for evertap, so the token reaches nothing else.");
  print();
  print(renderUnicodeCompact(link, { border: 1 }));
  print(link);
  print();
};

/**
 * A token Cloudflare takes: from CLOUDFLARE_API_TOKEN, or pasted until one works. Null when
 * nothing is pasted and `skippable`, or without a terminal or the variable.
 */
const readToken = async (step: Step, question: string, skippable: boolean) => {
  const given = process.env[TOKEN_VARIABLE];
  if (given) {
    const api = connectCloudflare(given);
    await api.verify().catch((error: unknown) => {
      throw error instanceof DataError
        ? new UsageError(`${TOKEN_VARIABLE}: ${error.message}`)
        : error;
    });
    return api;
  }
  if (!step.interactive) {
    return null;
  }
  for (;;) {
    const token = await askSecret(question);
    if (token === "") {
      if (skippable) {
        return null;
      }
      continue;
    }
    const api = connectCloudflare(token);
    try {
      await api.verify();
      return api;
    } catch (error) {
      if (!(error instanceof DataError)) {
        throw error;
      }
      print(`  ${error.message}`);
    }
  }
};

/** The domain `--zone` names, or the only one the token reaches, for setup without questions. */
const pickZone = async ({ flags }: Step, api: Cloudflare) => {
  const zones = await api.zones();
  const names = zones.map((zone) => zone.name).join(", ");
  if (flags.zone !== undefined) {
    const wanted = flags.zone.toLowerCase();
    return (
      zones.find((zone) => zone.name === wanted) ??
      fail(`--zone: the token reaches no domain named ${flags.zone}. It reaches ${names || "none"}`)
    );
  }
  const [only] = zones;
  if (!only) {
    return fail(
      "The token reaches no active domain. Make a new one that includes the domain for evertap under Zone Resources",
    );
  }
  return zones.length === 1 ? only : fail(`Add --zone with the domain for evertap: ${names}`);
};

/** What evertap made in Cloudflare, as lines that say where to remove each in the dashboard. */
export const leftBehind = (tunnel: NonNullable<Settings["tunnel"]>) =>
  tunnelLeftovers(tunnel).map(({ what, where, url }) => `${what}, under ${where}: ${url}`);

/** The names the tunnel serves, asked until they follow the rules; Enter takes `suggested`. */
const askNames = async (suggested: TunnelNames | null): Promise<TunnelNames> => {
  for (;;) {
    const enter = suggested ? ` (Enter for ${suggested.ui})` : "";
    const typed = await ask(`? Name for evertap, such as evertap.example.com${enter}: `);
    const ui = tunnelNamesSchema.safeParse({ ui: typed || (suggested?.ui ?? "") });
    if (!ui.success) {
      print(`  ${ui.error.issues[0]?.message}`);
      continue;
    }
    // The name buckets had stays while it fits beside evertap's.
    const kept =
      suggested &&
      zoneOf(suggested.storage) === zoneOf(ui.data.ui) &&
      suggested.storage !== ui.data.ui
        ? suggested.storage
        : ui.data.storage;
    for (;;) {
      const storage = await ask(`? Name for buckets reached from anywhere (Enter for ${kept}): `);
      const names = tunnelNamesSchema.safeParse({ ui: ui.data.ui, storage: storage || kept });
      if (names.success) {
        return names.data;
      }
      print(`  ${names.error.issues[0]?.message}`);
    }
  }
};

/**
 * Access the person approves on Cloudflare's page, from the code evertap.dev then shows; null when
 * they paste nothing. The verifier that turns the code into access never leaves this process.
 */
const approveInCloudflare = async () => {
  const approval = startApproval();
  const opened = await openBrowser(approval.url);
  print();
  print(
    opened
      ? "Approve evertap in Cloudflare. If your browser does not open, open this link:"
      : "No browser opened on this machine. To approve evertap in Cloudflare, open this link:",
  );
  print();
  print(approval.url);
  print();
  print("Cloudflare then sends you to evertap.dev, which shows a code to paste here. evertap uses");
  print("the access for this setup only and gives it back.");
  for (;;) {
    const pasted = await ask("? Paste the code, or press Enter to stop: ");
    if (pasted === "") {
      return null;
    }
    try {
      return await redeem(approval, pasted);
    } catch (error) {
      if (!(error instanceof DataError)) {
        throw error;
      }
      print(`  ${error.message}`);
    }
  }
};

/** Gives back access approved in Cloudflare, and says when Cloudflare did not confirm it. */
const giveBack = async (revoke: () => Promise<boolean>) => {
  if (await revoke()) {
    print("evertap gave back the access you approved in Cloudflare, and kept none of it.");
  } else {
    warn(
      `Cloudflare did not confirm it took back evertap's access. Remove evertap under Connected applications in Cloudflare: ${CLOUDFLARE_CONNECTED_APPS}`,
    );
  }
};

/** How evertap gets into the person's Cloudflare account this time, or another answer. */
type Way = "approve" | "token" | "keep";

const chooseWay = (kept: Settings["tunnel"]): Promise<Way> => {
  if (kept) {
    print(`  evertap runs a tunnel to https://${kept.hostnames.ui}.`);
    return choose<Way>(
      "What should setup do with it?",
      [
        { value: "keep", label: "Keep it as it is", tag: null },
        {
          value: "approve",
          label: "Set it up again",
          tag: null,
          hint: "With other names, or to repair it, once you approve evertap in Cloudflare",
        },
        {
          value: "token",
          label: "Set it up again with an API token",
          tag: null,
          hint: "The same, with a Cloudflare API token you create and paste here",
        },
      ],
      "keep",
    );
  }
  return choose<Way>(
    "How does evertap get into your Cloudflare account?",
    [
      {
        value: "approve",
        label: "Approve evertap in Cloudflare",
        tag: null,
        hint: "Allow it on Cloudflare's page, then paste the code evertap.dev shows",
      },
      {
        value: "token",
        label: "With an API token",
        tag: null,
        hint: "Create a Cloudflare API token and paste it here, as on a VPS where Cloudflare stops the approval",
      },
    ],
    "approve",
  );
};

/**
 * A tunnel evertap creates with access the person approves in Cloudflare or an API token. A tunnel
 * already in force stays as it is unless the person sets it up again.
 */
const askCloudflare = async (step: Step): Promise<SavedSettings | null> => {
  const { current, flags, interactive } = step;
  if (flags.listen !== undefined) {
    fail("Drop --listen: a Cloudflare Tunnel reaches evertap on this machine");
  }
  if (flags.url !== undefined) {
    fail(
      "Drop --url: the tunnel evertap runs opens evertap at the name you give it. For a tunnel you run yourself, use --mode network --url <address>",
    );
  }
  const kept = current.mode.value === "cloudflare" ? current.tunnel : null;
  let way: Way = "token";
  if (!process.env[TOKEN_VARIABLE]) {
    if (!interactive) {
      if (kept) {
        return flags.zone === undefined
          ? null
          : fail(
              `Set ${TOKEN_VARIABLE} to a Cloudflare API token to set the tunnel up again, or run evertap setup in a terminal to approve evertap in Cloudflare`,
            );
      }
      return fail(
        `Run evertap setup in a terminal to approve evertap in Cloudflare, or set ${TOKEN_VARIABLE} to a Cloudflare API token for evertap to create the tunnel with`,
      );
    }
    way = await chooseWay(kept);
  }
  if (way === "keep") {
    return null;
  }
  if (flags.s3Url !== undefined) {
    fail("Drop --s3-url: the tunnel evertap creates serves buckets at a name of its own");
  }
  if (way === "approve") {
    const names = await askNames(kept?.hostnames ?? null);
    const access = (await approveInCloudflare()) ?? fail("Nothing was changed");
    step.revoke = access.revoke;
    step.cloudflare = { api: access.api, zone: await access.api.zoneFor(names), names };
  } else {
    if (interactive && !process.env[TOKEN_VARIABLE]) {
      showTokenLink();
    }
    const api = await readToken(
      step,
      kept
        ? "? Paste a token to set the tunnel up again, or press Enter to keep it: "
        : "? Paste the token: ",
      kept !== null,
    );
    if (!api) {
      return null;
    }
    if (interactive) {
      const [only, ...others] = await api.zones();
      const names = await askNames(
        kept?.hostnames ?? (only && others.length === 0 ? defaultTunnelNames(only.name) : null),
      );
      step.cloudflare = { api, zone: await api.zoneFor(names), names };
    } else {
      const zone = await pickZone(step, api);
      // Without questions, a tunnel set up again in its domain keeps the names it has.
      const names = kept?.zone === zone.name ? kept.hostnames : defaultTunnelNames(zone.name);
      step.cloudflare = { api, zone, names };
    }
  }
  const { names } = step.cloudflare;
  if (interactive) {
    print(
      `  In Cloudflare, evertap makes the tunnel evertap, DNS records for ${names.ui} and ${names.storage}, and a Cache Rule that keeps ${names.storage} uncached.`,
    );
    if (kept && kept.hostnames.storage !== names.storage) {
      print(
        `  Buckets reached from anywhere move to https://${names.storage}. Change S3_PUBLIC_ENDPOINT in each .env you copied for one.`,
      );
    }
  }
  // Cloudflare gives the tunnel's ids once it makes it, after the person agrees.
  return plannedTunnel(names, kept);
};

/**
 * Makes the tunnel in Cloudflare once the person agreed and evertap would take the settings. Buckets
 * are served at the tunnel's own name for them, whatever was saved.
 */
const beforeCloudflare = async (step: Step, saved: SavedSettings): Promise<SavedSettings> => {
  const chosen = step.cloudflare;
  if (!chosen || saved.mode !== "cloudflare") {
    return saved;
  }
  // A refusal, such as from an environment variable, comes before anything is made.
  await step.client.system.settings.preview(saved);
  const origins = await step.client.system.settings.origins();
  print(`Setting up the tunnel in ${chosen.zone.name}…`);
  const tunnel = await chosen.api.setUp(chosen.zone, chosen.names, origins, step.current.tunnel);
  print(
    "Starting cloudflared, and waiting up to a minute for it to connect. Its first download can take a minute more.",
  );
  return { ...saved, tunnel };
};

/** Gives the access back, then checks the address; evertap saved the tunnel only once it connected. */
const afterCloudflare = async (step: Step, settings: Settings) => {
  const chosen = step.cloudflare;
  if (chosen && settings.tunnel) {
    print("The tunnel is connected to Cloudflare.");
  }
  if (step.revoke) {
    const revoke = step.revoke;
    step.revoke = undefined;
    await giveBack(revoke);
  } else if (chosen) {
    print(
      "evertap is done with the token and did not keep it, so you can delete it in Cloudflare. Changing or removing the tunnel later takes approving evertap in Cloudflare again, or a new token.",
    );
  }
  await checkAddress(step);
};

/** Whether to remove the tunnel evertap no longer runs, and how evertap gets in to do it. */
const chooseRemoval = (previous: NonNullable<Settings["tunnel"]>) => {
  print(`evertap no longer runs its tunnel to ${previous.zone}.`);
  return choose<Way>(
    "Remove it from Cloudflare?",
    [
      {
        value: "approve",
        label: "Remove it",
        tag: null,
        hint: "Once you approve evertap in Cloudflare",
      },
      {
        value: "token",
        label: "Remove it with an API token",
        tag: null,
        hint: "A Cloudflare API token you create and paste here",
      },
      {
        value: "keep",
        label: "Leave it in Cloudflare",
        tag: null,
        hint: "Setup lists what to remove there yourself",
      },
    ],
    "approve",
  );
};

/** Removes from Cloudflare what an earlier setup made there and the settings in force no longer use. */
const leaveCloudflare = async (step: Step, saved: SavedSettings) => {
  const previous = step.current.tunnel;
  const next = saved.mode === "cloudflare" ? saved.tunnel : null;
  const unused =
    previous &&
    (!next ||
      next.id !== previous.id ||
      next.cacheRule.ruleId !== previous.cacheRule.ruleId ||
      previous.dnsRecordIds.some((id) => !next.dnsRecordIds.includes(id)));
  if (!unused) {
    return;
  }
  const byHand = () => {
    warn("Remove what evertap made in Cloudflare yourself:");
    for (const line of leftBehind(previous)) {
      warn(`  ${line}`);
    }
  };
  let api = step.cloudflare?.api ?? null;
  // Access approved here goes back here; should anything throw first, runSetup's finally sends it.
  let approvedHere = false;
  // The new settings are in force already, so a failure here leaves the rest to the person.
  try {
    if (!api) {
      const way =
        step.interactive && !process.env[TOKEN_VARIABLE] ? await chooseRemoval(previous) : "token";
      if (way === "approve") {
        const access = await approveInCloudflare();
        api = access?.api ?? null;
        step.revoke = access?.revoke;
        approvedHere = access !== null;
      } else if (way === "token") {
        if (step.interactive && !process.env[TOKEN_VARIABLE]) {
          showTokenLink();
        }
        api = await readToken(
          step,
          "? Paste the token, or press Enter to remove it yourself: ",
          true,
        );
      }
    }
    if (api) {
      await api.tearDown(previous, next);
    }
  } catch (error) {
    if (!(error instanceof DataError)) {
      throw error;
    }
    warn(error.message);
    api = null;
  }
  if (approvedHere && step.revoke) {
    const revoke = step.revoke;
    step.revoke = undefined;
    await giveBack(revoke);
  }
  if (!api) {
    byHand();
    return;
  }
  print(
    next
      ? `Removed from Cloudflare what evertap made for ${previous.zone} and no longer uses.`
      : "Removed the tunnel, its DNS records, and its Cache Rule from Cloudflare.",
  );
};

/** Changes as indented lines, to make with sudo or by hand. */
const byHand = (changes: string[]) => changes.map((change) => `  ${change}`).join("\n");

/** Names what in Docker wants the standard ports on the address local mode listens on. */
const warnConflicts = async () => {
  const docker = await createDocker({ socket: config.dockerSocket, network: config.prefix }).catch(
    () => null,
  );
  const published = (await docker?.published().catch(() => null)) ?? [];
  const listeners = RESOURCE_ENGINES.map((engine) => ({
    address: { hostname: DATABASE_ADDRESS, port: RESOURCE_PORTS[engine] },
    portVariable: null,
  }));
  const conflicts = conflictsWith(published, listeners);
  for (const conflict of conflicts) {
    warn(`${conflict.name} (Docker): ${conflict.message}`);
  }
  if (conflicts.length > 0) {
    warn("To see these again, run evertap doctor");
  }
};

/** Points `ev.internal` at evertap's own address, and adds the address to a Mac before evertap listens there. */
const pointHere = async ({ current }: Step, saved: SavedSettings) => {
  // An environment variable keeps another mode, which evertap refuses to leave.
  if (current.mode.source === "env" && current.mode.value !== "local") {
    return saved;
  }
  await warnConflicts();
  const setup = loopbackSetup(await readLoopback());
  if ("refused" in setup) {
    fail(`${setup.refused}. Nothing was changed`);
  }
  if (setup.changes.length > 0) {
    print(
      `So ${DATABASE_HOST} reaches evertap, setup makes these changes with sudo:\n${byHand(setup.changes)}`,
    );
    if (!(await runAsRoot(setup))) {
      fail(
        `Could not finish with sudo, so nothing was saved. Make these changes as administrator, then run evertap setup again:\n${byHand(setup.changes)}`,
      );
    }
    print(`${DATABASE_HOST} now leads to evertap.`);
  }
  return saved;
};

const undoPointHere = async (_: Step, saved: SavedSettings) => {
  if (saved.mode === "local") {
    return;
  }
  const removal = loopbackRemoval(await readLoopback());
  if (removal.changes.length === 0) {
    return;
  }
  print(
    `${DATABASE_HOST} no longer needs to lead here, so setup makes these changes with sudo:\n${byHand(removal.changes)}`,
  );
  if (!(await runAsRoot(removal))) {
    warn(`Could not finish with sudo. To finish, as administrator:\n${byHand(removal.changes)}`);
    return;
  }
  print(`${DATABASE_HOST} no longer leads here.`);
};

const CHOICES: Record<AccessChoice, ChoiceSetup> = {
  local: {
    ask: async ({ flags }) => {
      if (
        flags.url !== undefined ||
        flags.listen !== undefined ||
        flags.zone !== undefined ||
        flags.s3Url !== undefined
      ) {
        fail("Drop --url, --listen, --zone, and --s3-url: --mode local takes none of them");
      }
      return { mode: "local" };
    },
    before: pointHere,
    after: async (_, settings) => {
      const url = settings.publicUrl.value;
      const ui = url === null ? [] : [Number(new URL(url).port || 80)];
      print(`While evertap runs, ${sharingAdvice([...Object.values(RESOURCE_PORTS), ...ui])}`);
    },
    leave: undoPointHere,
    opensBrowser: true,
  },
  network: {
    ask: askNetwork,
    after: afterNetwork,
    opensBrowser: false,
  },
  cloudflare: {
    ask: askCloudflare,
    before: beforeCloudflare,
    after: afterCloudflare,
    leave: leaveCloudflare,
    opensBrowser: false,
  },
  proxy: {
    ask: askProxy,
    after: afterNetwork,
    opensBrowser: false,
  },
};

const MODE_FLAG = `--mode ${new Intl.ListFormat("en", { type: "disjunction" }).format(["local", "network", "cloudflare"])}`;

/** The address each choice opens evertap at, where setup can tell before it is made. */
const addressOf = ({ current, was, guide }: Step, choice: AccessChoice) => {
  if (choice === was && current.publicUrl.value !== null) {
    return current.publicUrl.value;
  }
  if (choice === "local") {
    return guide.localUrl;
  }
  return choice === "network"
    ? (guide.listenChoices.find(({ use }) => use === "lan")?.defaultUrl ?? null)
    : null;
};

/**
 * Where browsers will open evertap from: asked, as `--mode` and where it listens say, or as
 * environment variables leave it.
 */
const pickChoice = async (step: Step): Promise<AccessChoice> => {
  const { current, flags, interactive, guide } = step;
  const docker = dockerOf(guide);
  const fixedMode = current.mode.source === "env" ? current.mode.value : null;
  const mode = flags.mode ?? (interactive ? undefined : fixedMode);
  if (mode !== undefined && mode !== null) {
    if (!isMode(mode)) {
      return fail(`Choose ${MODE_FLAG}`);
    }
    // Flags speak in modes: in network mode, where it listens tells the two choices apart.
    return mode === "network"
      ? networkChoice(
          flagListen(flags.listen) ??
            (current.mode.value === "network" || current.listenHost.source === "env"
              ? current.listenHost.value
              : "127.0.0.1"),
          docker,
        )
      : mode;
  }
  if (!interactive) {
    return fail(`Add ${MODE_FLAG}, or run evertap setup in a terminal to be asked`);
  }
  const offered = offeredChoices(
    {
      mode: fixedMode,
      listenHost: current.listenHost.source === "env" ? current.listenHost.value : null,
    },
    docker,
  );
  const [only] = offered;
  if (only !== undefined && offered.length === 1) {
    const fixedBy = fixedMode === null ? SETTING_VARIABLES.listenHost : SETTING_VARIABLES.mode;
    showFixed(step, "Opened from", ACCESS_CHOICE_NAMES[only].label, fixedBy);
    return only;
  }
  return choose(
    ACCESS_QUESTION,
    offered.map((choice) => ({
      value: choice,
      ...ACCESS_CHOICE_NAMES[choice],
      tag: addressOf(step, choice),
    })),
    step.was !== null && offered.includes(step.was) ? step.was : (offered[0] ?? "local"),
  );
};

/**
 * Chooses the access settings, by asking or from the flags, and puts them in force. Resolves to
 * how the first browser should sign in.
 */
export const runSetup = async (client: AppRouterClient, flags: SetupFlags) => {
  const given = Object.values(flags).some((value) => value !== undefined);
  const current = await client.system.settings.get();
  const guide = await client.system.settings.network();
  const step: Step = {
    client,
    current,
    was: accessChoice(current.mode.value, current.listenHost.value, dockerOf(guide)),
    guide,
    flags,
    interactive: !given && process.stdin.isTTY && process.stdout.isTTY,
  };
  try {
    return await setUp(step);
  } finally {
    // However setup ends, it keeps no access to the person's Cloudflare account.
    await step.revoke?.();
  }
};

const setUp = async (step: Step) => {
  const { client } = step;
  const choice = CHOICES[await pickChoice(step)];
  const asked = await choice.ask(step);
  let settings = step.current;
  if (asked) {
    if (step.interactive && !/^(y|yes)?$/i.test(await ask("? Save and apply now? (Y/n) "))) {
      fail("Nothing was changed");
    }
    const saved = (await choice.before?.(step, asked)) ?? asked;
    ({ settings } = await client.system.settings.update(saved));
    if (step.was !== null) {
      await CHOICES[step.was].leave?.(step, saved);
    }
  }
  const url = settings.publicUrl.value;
  if (url === null) {
    fail(
      "Saved, but evertap cannot tell this machine's address on your network. Run evertap setup again and give the address browsers open it at",
    );
  }
  print(`${asked ? "Saved" : "Kept as it is"}. Browsers open evertap at ${url}`);
  const before = step.current.publicUrl.value;
  // CLIs elsewhere use evertap only while it is set up for other machines.
  if (
    step.was !== null &&
    step.was !== "local" &&
    settings.mode.value !== "local" &&
    before !== null &&
    before !== url
  ) {
    // Each CLI keeps the address `evertap login` or `EVERTAP_URL` gave it, which follows no move.
    print(`Every CLI that uses ${before} can no longer reach evertap there. On each laptop, run:`);
    print(`  evertap login ${url}`);
    print(`With an API key, as in CI, set EVERTAP_URL=${url}`);
  }
  await choice.after?.(step, settings);
  return { opensBrowser: choice.opensBrowser };
};
