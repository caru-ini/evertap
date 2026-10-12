import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { SETTING_VARIABLES } from "@evertap/api/rules";

const int = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

// Empty counts as unset, as a blank line in an env file gives.
const text = (value: string | undefined) => (value === "" ? undefined : value);

/**
 * Where Docker answers: `EVERTAP_DOCKER_SOCKET`, else a `unix://` `DOCKER_HOST`, else the first
 * socket that exists of Docker Engine, Docker Desktop, OrbStack, Colima and rootless Docker.
 */
export const findDockerSocket = (
  env: NodeJS.ProcessEnv,
  home: string,
  exists: (path: string) => boolean = existsSync,
) => {
  const chosen = text(env.EVERTAP_DOCKER_SOCKET);
  if (chosen !== undefined) {
    return chosen;
  }
  // evertap speaks to Docker over a socket only; a tcp:// or ssh:// DOCKER_HOST is passed over.
  const fromHost = env.DOCKER_HOST?.match(/^unix:\/\/(\/.+)$/)?.[1];
  if (fromHost !== undefined) {
    return fromHost;
  }
  const engine = "/var/run/docker.sock";
  const usual = [
    engine,
    join(home, ".docker/run/docker.sock"),
    join(home, ".docker/desktop/docker.sock"),
    join(home, ".orbstack/run/docker.sock"),
    join(home, ".colima/default/docker.sock"),
    ...(env.XDG_RUNTIME_DIR ? [join(env.XDG_RUNTIME_DIR, "docker.sock")] : []),
  ];
  return usual.find((path) => exists(path)) ?? engine;
};

export const config = {
  /** UI + API. The only HTTP port exposed on the host. */
  port: int(process.env.EVERTAP_PORT, 8080),
  /**
   * Settings these variables fix, checked when the server starts: the mode, where browsers open
   * evertap, and where the UI listens. Each wins over the saved settings.
   */
  settings: {
    mode: text(process.env[SETTING_VARIABLES.mode]),
    publicUrl: text(process.env[SETTING_VARIABLES.publicUrl]),
    listenHost: text(process.env[SETTING_VARIABLES.listenHost]),
  },
  /** The LAN name, which network mode answers to. */
  host: process.env.EVERTAP_HOST ?? "evertap.local",
  hostChosen: process.env.EVERTAP_HOST !== undefined,
  /**
   * Each entry's port on 127.0.0.1, where the CLI's relay reaches it. Local mode keeps every entry
   * on its standard port instead, as apps reach it there directly.
   */
  postgresPort: int(process.env.EVERTAP_POSTGRES_PORT, 6432),
  mysqlPort: int(process.env.EVERTAP_MYSQL_PORT, 3306),
  redisPort: int(process.env.EVERTAP_REDIS_PORT, 6379),
  garagePort: int(process.env.EVERTAP_GARAGE_PORT, 3900),
  /**
   * The entry for buckets reached from anywhere, where a Cloudflare Tunnel or the person's proxy
   * sends their requests; it listens beside the UI.
   */
  publicStoragePort: int(process.env.EVERTAP_PUBLIC_S3_PORT, 9900),
  /** Where evertap keeps its records and entry config; its filesystem is the one the disk meter reports. */
  dataDir: process.env.EVERTAP_DATA_DIR ?? join(homedir(), ".local/share/evertap"),
  /** Sample rows in memory instead of real services; nothing is started. */
  demo: process.env.EVERTAP_DEMO === "1",
  /** `0` stops the daily check for a newer release. */
  updateCheck: process.env.EVERTAP_UPDATE_CHECK !== "0",
  /** Set by evertap's own Docker image, which upgrades by pulling a new one. */
  image: process.env.EVERTAP_IMAGE === "1",
  dockerSocket: findDockerSocket(process.env, homedir()),
  /** Every container, volume and network evertap creates starts with this; others are never touched. */
  prefix: process.env.EVERTAP_PREFIX ?? "evertap",
};
