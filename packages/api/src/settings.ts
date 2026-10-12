import { z } from "zod";

import {
  DATABASE_ADDRESS,
  DATABASE_HOST,
  SETTING_VARIABLES,
  WILDCARDS,
  type AccessMode,
  accessChoice,
  zoneOf,
} from "./rules.ts";
import type { NetworkGuide, SavedSettings, Settings, Tunnel, TunnelNames } from "./schemas.ts";

/** What decides the settings besides the saved ones, on the machine running evertap. */
export type SettingsEnvironment = {
  /** What environment variables set; each wins over the saved value. */
  env: { mode?: AccessMode; publicUrl?: string; listenHost?: string };
  /** The UI's port, which settings do not move. */
  port: number;
  /** The port of the entry for buckets reached from anywhere, which settings do not move. */
  publicStoragePort: number;
  /** This machine's LAN address: the URL's host while the UI listens on every interface. */
  lanAddress: () => string | null;
  /** This machine's name on the LAN (`EVERTAP_HOST`), which network mode answers to as well. */
  lanName: string;
  /** Docker's bridge address (docker0), where a proxy in a container reaches this machine. */
  dockerAddress: () => string | null;
  /** This machine's addresses that the internet routes to. */
  publicAddresses: () => string[];
};

const ipSchema = z.union([z.ipv4(), z.ipv6()]);

const isIPv4 = (address: string) => z.ipv4().safeParse(address).success;

/** `address` as a URL writes it: IPv6 in brackets. */
export const urlHost = (address: string) =>
  z.ipv6().safeParse(address).success ? `[${address}]` : address;

/** Where this computer opens evertap in local mode. */
export const localUrl = ({ port }: SettingsEnvironment) => `http://${DATABASE_HOST}:${port}`;

const defaultUrl = (
  mode: AccessMode | null,
  listenHost: string,
  environment: SettingsEnvironment,
) => {
  const { port, lanAddress } = environment;
  if (mode === "local") {
    return localUrl(environment);
  }
  // Known only once the tunnel exists.
  if (mode === "cloudflare") {
    return null;
  }
  const address = WILDCARDS.has(listenHost) ? lanAddress() : listenHost;
  return address === null ? null : `http://${urlHost(address)}:${port}`;
};

/** Each value from its environment variable, else the saved settings, else the mode's default. */
export const resolveSettings = (
  saved: SavedSettings | null,
  environment: SettingsEnvironment,
): Settings => {
  const { env } = environment;
  const mode: Settings["mode"] =
    env.mode === undefined
      ? saved
        ? { value: saved.mode, source: "saved" }
        : { value: null, source: "default" }
      : { value: env.mode, source: "env" };
  // A saved value belongs to the mode it was chosen for.
  const own = saved?.mode === mode.value ? saved : null;
  const listenHost: Settings["listenHost"] =
    env.listenHost === undefined
      ? own?.mode === "network"
        ? { value: own.listenHost, source: "saved" }
        : { value: mode.value === "local" ? DATABASE_ADDRESS : "127.0.0.1", source: "default" }
      : { value: env.listenHost, source: "env" };
  const savedUrl = own?.mode === "network" || own?.mode === "cloudflare" ? own.publicUrl : null;
  const publicUrl: Settings["publicUrl"] =
    env.publicUrl === undefined
      ? savedUrl === null
        ? { value: defaultUrl(mode.value, listenHost.value, environment), source: "default" }
        : { value: savedUrl, source: "saved" }
      : { value: env.publicUrl, source: "env" };
  let tunnel: Settings["tunnel"] = null;
  if (own?.mode === "cloudflare") {
    const { token: _, ...ids } = own.tunnel;
    tunnel = ids;
  }
  const savedStorageUrl = own?.mode === "network" ? own.storageUrl : null;
  const storageUrl: Settings["storageUrl"] =
    tunnel === null
      ? savedStorageUrl === null
        ? { value: null, source: "default" }
        : { value: savedStorageUrl, source: "saved" }
      : { value: `https://${tunnel.hostnames.storage}`, source: "default" };
  return { mode, publicUrl, listenHost, tunnel, storageUrl };
};

/**
 * The settings a tunnel at `names` would put in force, to check before Cloudflare makes it. The
 * tunnel evertap runs (`kept`) keeps its ids when it moves.
 */
export const plannedTunnel = (
  names: TunnelNames,
  kept: Omit<Tunnel, "token"> | null,
): SavedSettings => ({
  mode: "cloudflare",
  publicUrl: `https://${names.ui}`,
  tunnel: {
    ...(kept ?? {
      id: "",
      accountId: "",
      zoneId: "",
      dnsRecordIds: [],
      cacheRule: { rulesetId: "", ruleId: "" },
    }),
    token: "",
    zone: zoneOf(names.ui),
    hostnames: names,
  },
});

/** Which of the choices setup and Settings offer the settings in force are. */
export const choiceOf = (settings: Settings, environment: SettingsEnvironment) =>
  accessChoice(settings.mode.value, settings.listenHost.value, environment.dockerAddress());

/**
 * Where the entry for buckets reached from anywhere listens: beside the UI, or on loopback while
 * the UI takes every interface, as a proxy or tunnel stands in front of it. Null while nothing
 * can lead there.
 */
export const storageEntry = (settings: Settings, environment: SettingsEnvironment) => {
  const { mode, listenHost, storageUrl } = settings;
  if ((mode.value !== "network" && mode.value !== "cloudflare") || storageUrl.value === null) {
    return null;
  }
  const hostname = WILDCARDS.has(listenHost.value) ? "127.0.0.1" : listenHost.value;
  return { hostname, port: environment.publicStoragePort };
};

/** The public address that listening on `listenHost` opens the UI on, or null. */
export const exposedAt = (listenHost: string, environment: SettingsEnvironment) => {
  const addresses = environment.publicAddresses();
  if (listenHost === "0.0.0.0") {
    return addresses.find(isIPv4) ?? null;
  }
  // `::` takes IPv4 as well.
  if (WILDCARDS.has(listenHost)) {
    return addresses[0] ?? null;
  }
  return addresses.includes(listenHost) ? listenHost : null;
};

/** Where network mode can put the UI on this machine. */
export const listenChoices = (environment: SettingsEnvironment): NetworkGuide["listenChoices"] => {
  const docker = environment.dockerAddress();
  const choices: Pick<NetworkGuide["listenChoices"][number], "use" | "address">[] = [
    { use: "lan", address: "0.0.0.0" },
    { use: "proxy", address: "127.0.0.1" },
  ];
  if (docker !== null) {
    choices.push({ use: "docker", address: docker });
  }
  return choices.map((choice) => ({
    ...choice,
    defaultUrl: defaultUrl("network", choice.address, environment),
    exposes: exposedAt(choice.address, environment),
  }));
};

/**
 * Whether a request's Host names this evertap: its URL's host, `localhost`, an address, or in
 * network mode its LAN name. A page that points its own name at this machine (DNS rebinding) still
 * sends that name.
 */
export const allowsHost = (
  settings: Settings,
  environment: SettingsEnvironment,
  host: string | null | undefined,
) => {
  if (!host || !URL.canParse(`http://${host}`)) {
    return false;
  }
  const name = new URL(`http://${host}`).hostname;
  if (name === "localhost" || ipSchema.safeParse(name.replace(/^\[(.*)\]$/, "$1")).success) {
    return true;
  }
  if (settings.mode.value === "network" && name === environment.lanName.toLowerCase()) {
    return true;
  }
  const url = settings.publicUrl.value;
  return url !== null && new URL(url).hostname === name;
};

/** Whether listening on `next` still takes every connection that reached `current`. */
const covers = (next: string, current: string) =>
  next === current || next === "::" || (next === "0.0.0.0" && isIPv4(current));

/**
 * Whether putting `next` in force would cut off a browser that reached evertap as `host` under
 * `current`. When it cannot tell, it would.
 */
export const cutsOff = (
  current: Settings,
  next: Settings,
  environment: SettingsEnvironment,
  host: string | null | undefined,
) =>
  !allowsHost(next, environment, host) ||
  !covers(next.listenHost.value, current.listenHost.value) ||
  leavesTunnel(current, next, host);

/** Whether a browser that opened evertap as `host` came through the tunnel it runs under `current`. */
export const cameThroughTunnel = (current: Settings, host: string | null | undefined) =>
  current.tunnel !== null &&
  URL.canParse(`http://${host}`) &&
  new URL(`http://${host}`).hostname === current.tunnel.hostnames.ui;

/** Whether the browser came through the tunnel evertap runs under `current`, which `next` stops. */
const leavesTunnel = (current: Settings, next: Settings, host: string | null | undefined) =>
  next.tunnel?.id !== current.tunnel?.id && cameThroughTunnel(current, host);

/** The environment variable that fixes a value `saved` would change, or null. */
export const lockedBy = (current: Settings, saved: SavedSettings) => {
  const wanted: { [Key in keyof typeof SETTING_VARIABLES]: string | null | undefined } = {
    mode: saved.mode,
    publicUrl: "publicUrl" in saved ? saved.publicUrl : undefined,
    listenHost: "listenHost" in saved ? saved.listenHost : undefined,
  };
  for (const key of ["mode", "publicUrl", "listenHost"] as const) {
    const value = wanted[key];
    if (
      current[key].source === "env" &&
      value !== undefined &&
      value !== null &&
      value !== current[key].value
    ) {
      return SETTING_VARIABLES[key];
    }
  }
  return null;
};
