import { lookup } from "node:dns/promises";
import { existsSync } from "node:fs";
import { connect, isIP } from "node:net";
import { homedir, userInfo } from "node:os";
import { relative } from "node:path";

import {
  type AccessChoice,
  DATABASE_ADDRESS,
  DATABASE_HOST,
  RESOURCE_ENGINES,
  type ResourceEngine,
} from "@evertap/api/rules";
import type { DoctorReport } from "@evertap/api/schemas";

import {
  type Docker,
  type DockerInfo,
  type PortBinding,
  type Published,
  compareVersions,
} from "./live/docker.ts";
import { type Address, formatAddress } from "./live/listener.ts";

const TIMEOUT_MS = 2000;

const withTimeout = <T>(promise: Promise<T>, fallback: T) =>
  Promise.race([
    promise,
    new Promise<T>((resolve) => {
      setTimeout(() => {
        resolve(fallback);
      }, TIMEOUT_MS);
    }),
  ]);

const answers = ({ hostname, port }: Address) =>
  withTimeout(
    new Promise<boolean>((resolve) => {
      const socket = connect({ host: hostname, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        resolve(false);
      });
    }),
    false,
  );

// A missing mDNS responder can leave a `.local` lookup hanging, hence the timeout.
export const resolve = (host: string): Promise<string[]> =>
  withTimeout(
    lookup(host, { all: true }).then(
      (found) => found.map((entry) => entry.address),
      () => [],
    ),
    [],
  );

type DockerWarning = NonNullable<DoctorReport["docker"]>["warnings"][number];

/** What about the Docker install puts evertap at risk, each with what to do. */
export const dockerWarnings = (
  info: DockerInfo,
  place: {
    dataDir: string;
    home: string;
    lingering: () => boolean;
    platform: NodeJS.Platform;
  },
) => {
  const warnings: DockerWarning[] = [];
  const rootless = info.SecurityOptions?.includes("name=rootless") ?? false;
  // Docker Desktop, and every Docker on macOS (OrbStack, Colima), runs in a VM of its own.
  const vm = info.OperatingSystem === "Docker Desktop" || place.platform === "darwin";
  const firewalld = info.FirewallBackend?.Driver.endsWith("+firewalld") ?? false;
  const before = (version: string) => compareVersions(info.ServerVersion, version) < 0;
  // Before 28.0, and from 28.2 to 28.3.2 once firewalld reloads, other machines on the network can
  // reach what Docker publishes on 127.0.0.1 (moby#45610, CVE-2025-54388). Rootless Docker and
  // Docker in a VM never could.
  if (
    !rootless &&
    !vm &&
    (before("28.0.0") || (firewalld && !before("28.2.0") && before("28.3.3")))
  ) {
    warnings.push({
      kind: "outdated",
      message: `This Docker lets other machines on your network reach the databases and buckets past evertap. Update Docker to ${firewalld ? "28.3.3" : "28"} or later`,
    });
  }
  // Snap's Docker sees only the folders of the home that are not hidden; a path out of the home
  // starts with `..`.
  const snap =
    info.DockerRootDir.startsWith("/var/snap/docker/") ||
    info.OperatingSystem.startsWith("Ubuntu Core");
  if (snap && relative(place.home, place.dataDir).startsWith(".")) {
    warnings.push({
      kind: "snap",
      message:
        "Docker from Snap can't read evertap's files in hidden folders or outside your home. Install Docker from docker.com, or move evertap's folder to one such as ~/evertap and set EVERTAP_DATA_DIR to it",
    });
  }
  if (rootless && !place.lingering()) {
    warnings.push({
      kind: "rootless",
      message:
        "Rootless Docker stops when you log out, and the databases with it. Run sudo loginctl enable-linger $USER and systemctl --user enable docker",
    });
  }
  return warnings;
};

/** Whether this user's services outlive a logout; unknown counts as no. */
const lingering = () => {
  try {
    // `userInfo` throws for a uid with no passwd entry, as inside some containers.
    return existsSync(`/var/lib/systemd/linger/${userInfo().username}`);
  } catch {
    return false;
  }
};

/** One of evertap's listeners, and the variable that moves it where its port is free to choose. */
export type Listener = { address: Address; portVariable: string | null };

/**
 * Whether a container publishing at `published` and evertap listening at `at` on the same port
 * shut each other out. Docker binds `::` apart from IPv4; evertap's `::` takes IPv4 too.
 */
const overlaps = (published: string, at: string) =>
  published === at ||
  at === "::" ||
  (at === "0.0.0.0" && isIP(published) === 4) ||
  (published === "0.0.0.0" && isIP(at) === 4);

const conflictMessage = (
  running: boolean,
  { hostIp, hostPort }: PortBinding,
  { address, portVariable }: Listener,
) => {
  const where = hostIp === "0.0.0.0" ? "every address" : hostIp;
  // evertap's own loopback address leaves 127.0.0.1 free for the same port.
  const fix =
    address.hostname === DATABASE_ADDRESS
      ? `Publish it on 127.0.0.1 only, as "127.0.0.1:${hostPort}:${hostPort}" in Compose`
      : `Change it in its Compose file${portVariable ? `, or set ${portVariable} to a free one` : ""}`;
  return running
    ? `Holds ${hostPort} on ${where}, so evertap can't listen at ${formatAddress(address)}. ${fix}`
    : `Can't start while evertap listens at ${formatAddress(address)}, as it asks for ${hostPort} on ${where}. ${fix}`;
};

/**
 * The person's own containers that want a port one of evertap's listeners has: a running one kept
 * evertap from listening, and a stopped one fails when it starts again.
 */
export const conflictsWith = (
  published: Published[],
  listeners: Listener[],
): DoctorReport["conflicts"] =>
  listeners.flatMap((listener) =>
    published.flatMap(({ name, running, bindings }) => {
      const clash = bindings.find(
        ({ hostIp, hostPort }) =>
          hostPort === listener.address.port && overlaps(hostIp, listener.address.hostname),
      );
      return clash
        ? [
            {
              name,
              address: formatAddress(listener.address),
              running,
              message: conflictMessage(running, clash, listener),
            },
          ]
        : [];
    }),
  );

/**
 * The name the doctor resolves: in local mode the one connection details use. Nothing evertap runs
 * announces the LAN name, so other modes check it only when it was set or evertap is opened at it.
 */
export const checkedName = (
  access: AccessChoice | null,
  lan: { host: string; chosen: boolean },
  publicUrl: string | null,
) => {
  if (access === "local") {
    return DATABASE_HOST;
  }
  const opened = publicUrl === null ? null : new URL(publicUrl).hostname;
  return lan.chosen || opened === lan.host.toLowerCase() ? lan.host : null;
};

/** The doctor's checks the live store cannot make itself. */
export const createChecks =
  (options: {
    docker: Docker;
    socket: string;
    dataDir: string;
    host: string;
    /** Whether `EVERTAP_HOST` set the host rather than the default. */
    hostChosen: boolean;
    access: () => AccessChoice | null;
    /** Where browsers open evertap now. */
    publicUrl: () => string | null;
    /** Where each entry listens now. */
    entry: (engine: ResourceEngine) => Address;
    portVariable: (engine: ResourceEngine) => string | null;
    /** Where the UI listens now. */
    ui: () => Address;
    /** How the tunnel evertap runs is doing. */
    tunnel: () => Promise<DoctorReport["tunnel"]>;
  }) =>
  async (): Promise<
    Pick<DoctorReport, "docker" | "access" | "tunnel" | "dataDir" | "lan" | "entries" | "conflicts">
  > => {
    const access = options.access();
    const name = checkedName(
      access,
      { host: options.host, chosen: options.hostChosen },
      options.publicUrl(),
    );
    const listening = RESOURCE_ENGINES.map((engine) => ({ engine, at: options.entry(engine) }));
    const listeners: Listener[] = [
      ...listening.map(({ engine, at }) => ({
        address: at,
        portVariable: options.portVariable(engine),
      })),
      { address: options.ui(), portVariable: "EVERTAP_PORT" },
    ];
    const [version, info, addresses, entries, published, tunnel] = await Promise.all([
      withTimeout(
        options.docker.version().catch(() => undefined),
        undefined,
      ),
      // Only for the warnings: a slow or unexpected answer leaves them out.
      withTimeout(
        options.docker.info().catch(() => undefined),
        undefined,
      ),
      name === null || isIP(name) ? null : resolve(name),
      Promise.all(listening.map(({ at }) => answers(at))),
      withTimeout(
        options.docker.published().catch(() => []),
        [],
      ),
      options.tunnel(),
    ]);
    return {
      docker: {
        reachable: version !== undefined,
        version,
        apiVersion: options.docker.apiVersion,
        socket: options.socket,
        warnings: info
          ? dockerWarnings(info, {
              dataDir: options.dataDir,
              home: homedir(),
              lingering,
              platform: process.platform,
            })
          : [],
      },
      access,
      tunnel,
      dataDir: options.dataDir,
      // An address needs no resolving, so there is nothing to check.
      lan: name !== null && addresses ? { host: name, addresses } : null,
      entries: listening.map(({ engine, at }, index) => ({
        engine,
        address: formatAddress(at),
        reachable: entries[index] ?? false,
      })),
      conflicts: conflictsWith(published, listeners),
    };
  };
