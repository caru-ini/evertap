/** How browsers and apps reach evertap: the settings in force, and moving listeners to match. */

import { BlockList } from "node:net";
import { type NetworkInterfaceInfo, networkInterfaces } from "node:os";

import { DataError } from "@evertap/api/context";
import {
  ACCESS_MODES,
  type AccessMode,
  DATABASE_ADDRESS,
  RESOURCE_PORTS,
  type ResourceEngine,
  SETTING_VARIABLES,
} from "@evertap/api/rules";
import { type SavedSettings, listenHostSchema, publicUrlSchema } from "@evertap/api/schemas";
import { type SettingsEnvironment, resolveSettings, storageEntry } from "@evertap/api/settings";

import { DOCKER_BRIDGE } from "./address.ts";
import { config } from "./config.ts";
import { ISOLATED_BRIDGE } from "./live/docker.ts";
import { type Address, formatAddress } from "./live/listener.ts";
import { addAliasCommand, aliasNeeded, listenerCommand, loopbackOnly } from "./loopback.ts";

const ENTRY_PORTS: Record<ResourceEngine, number> = {
  postgresql: config.postgresPort,
  mysql: config.mysqlPort,
  redis: config.redisPort,
  garage: config.garagePort,
};

const PORT_VARIABLES: Record<ResourceEngine, string> = {
  postgresql: "EVERTAP_POSTGRES_PORT",
  mysql: "EVERTAP_MYSQL_PORT",
  redis: "EVERTAP_REDIS_PORT",
  garage: "EVERTAP_GARAGE_PORT",
};

// IPv4 ranges the internet does not route to a machine; in IPv6 only 2000::/3 is global.
const UNROUTED = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 3],
] as const) {
  UNROUTED.addSubnet(network, prefix, "ipv4");
}
const GLOBAL_IPV6 = new BlockList();
GLOBAL_IPV6.addSubnet("2000::", 3, "ipv6");

/** This machine's own addresses on its networks, leaving out loopback and Docker's bridges. */
const ownAddresses = (): NetworkInterfaceInfo[] =>
  Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
    DOCKER_BRIDGE.test(name) || ISOLATED_BRIDGE.test(name)
      ? []
      : (addresses ?? []).filter((address) => !address.internal),
  );

const lanAddress = () =>
  ownAddresses().find((address) => address.family === "IPv4")?.address ?? null;

const publicAddresses = () =>
  ownAddresses()
    .filter(({ address, family }) =>
      family === "IPv4" ? !UNROUTED.check(address, "ipv4") : GLOBAL_IPV6.check(address, "ipv6"),
    )
    .map(({ address }) => address);

const isMode = (value: string): value is AccessMode => ACCESS_MODES.some((mode) => mode === value);

/** Settings as environment variables give them, before they are checked. */
export type SettingVariables = { [Key in keyof SettingsEnvironment["env"]]?: string };

/** What the environment variables fix; throws a DataError naming one that is wrong. */
const readEnv = ({ mode, publicUrl, listenHost }: SettingVariables): SettingsEnvironment["env"] => {
  if (mode !== undefined && !isMode(mode)) {
    const modes = new Intl.ListFormat("en", { type: "disjunction" }).format(ACCESS_MODES);
    throw new DataError(`Unset ${SETTING_VARIABLES.mode}, or set it to ${modes}`);
  }
  const url = publicUrlSchema.safeParse(publicUrl);
  if (publicUrl !== undefined && !url.success) {
    throw new DataError(`${SETTING_VARIABLES.publicUrl}: ${url.error.issues[0]?.message}`);
  }
  // The tunnel evertap runs decides its own address; one the person runs is network mode.
  if (mode === "cloudflare" && publicUrl !== undefined) {
    throw new DataError(
      `Unset ${SETTING_VARIABLES.publicUrl}: the tunnel evertap runs has its own address. For a tunnel you run yourself, set ${SETTING_VARIABLES.mode} to network and ${SETTING_VARIABLES.listenHost} to 127.0.0.1`,
    );
  }
  if (listenHost !== undefined && !listenHostSchema.safeParse(listenHost).success) {
    throw new DataError(
      `Set ${SETTING_VARIABLES.listenHost} to an IP address of this machine, such as 127.0.0.1`,
    );
  }
  return { mode, publicUrl: url.data, listenHost };
};

/**
 * Why nothing can listen at `address`, as a DataError that says what to do, or the error itself
 * when it is not that. `portVariable` moves it, where its port is free to choose.
 */
export const listenFailure = (error: unknown, address: Address, portVariable: string | null) => {
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  if (code === "EADDRINUSE") {
    const fix = portVariable
      ? `, or set ${portVariable} to a free one`
      : `, or ${loopbackOnly(address.port)}`;
    return new DataError(
      `${formatAddress(address)} is taken by another program. Stop that program${fix}. To see what it is: ${listenerCommand(address.port)}`,
    );
  }
  if (code === "EADDRNOTAVAIL") {
    const fix =
      address.hostname === DATABASE_ADDRESS && aliasNeeded()
        ? `Add it with sudo ${addAliasCommand(DATABASE_ADDRESS).join(" ")}`
        : "Choose one of its addresses";
    return new DataError(`${address.hostname} is not an address of this machine. ${fix}`);
  }
  return error;
};

/**
 * The settings in force and where each listener belongs under them. `save` moves every listener
 * that `follow` registered, or none.
 */
export const createAccess = (options: {
  saved: SavedSettings | null;
  /** Keeps the settings for the next start. */
  keep: (saved: SavedSettings) => void;
  /** What the environment variables set, unchecked, as `config.settings` reads them. */
  variables: SettingVariables;
  /** Docker's default bridge address (docker0), as Docker gave it when evertap started. */
  dockerAddress?: string | null;
}) => {
  // The LAN address is looked up each time it is needed, as DHCP can move it.
  const environment: SettingsEnvironment = {
    env: readEnv(options.variables),
    port: config.port,
    publicStoragePort: config.publicStoragePort,
    lanAddress,
    lanName: config.host,
    dockerAddress: () => options.dockerAddress ?? null,
    publicAddresses,
  };
  let saved = options.saved;
  const followers: (() => void)[] = [];
  const current = () => resolveSettings(saved, environment);
  /** The tunnel evertap runs under `next`, with what runs it; null when it runs none. */
  const tunnelAfter = (next: SavedSettings | null) =>
    next?.mode === "cloudflare" && resolveSettings(next, environment).tunnel !== null
      ? next.tunnel
      : null;

  return {
    current,
    environment,
    snapshot: () => ({ saved, environment }),
    ui: (): Address => ({ hostname: current().listenHost.value, port: config.port }),
    /** The tunnel evertap runs, with what runs it; null when it runs none. */
    tunnel: () => tunnelAfter(saved),
    tunnelAfter,
    /**
     * Apps reach a local mode's entries directly, where connection details point: `ev.internal`
     * on the standard ports.
     */
    entry: (engine: ResourceEngine): Address =>
      current().mode.value === "local"
        ? { hostname: DATABASE_ADDRESS, port: RESOURCE_PORTS[engine] }
        : { hostname: "127.0.0.1", port: ENTRY_PORTS[engine] },
    /** Where the entry for buckets reached from anywhere belongs; null while nothing leads there. */
    storage: (): Address | null => storageEntry(current(), environment),
    /** The variable that moves the engine's entry; none in local mode, where the port is fixed. */
    portVariable: (engine: ResourceEngine) =>
      current().mode.value === "local" ? null : PORT_VARIABLES[engine],
    /** `rebind` moves a listener to where `current` now puts it, or throws and leaves it unbound. */
    follow: (rebind: () => void) => {
      followers.push(rebind);
    },
    save: (next: SavedSettings) => {
      const previous = saved;
      saved = next;
      try {
        for (const rebind of followers) {
          rebind();
        }
      } catch (error) {
        saved = previous;
        for (const rebind of followers) {
          try {
            rebind();
          } catch (undo) {
            console.error("moving back:", undo);
          }
        }
        throw error;
      }
      options.keep(next);
    },
  };
};

export type Access = ReturnType<typeof createAccess>;
