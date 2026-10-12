import { access as reach, chmod, constants, mkdir } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";

import { DataError, type Store } from "@evertap/api/context";
import {
  DATABASE_HOST,
  DATABASE_PORTS,
  RESOURCE_ENGINES,
  type ResourceEngine,
  type TunnelPhase,
  isDatabaseEngine,
} from "@evertap/api/rules";
import type { SavedSettings } from "@evertap/api/schemas";
import { choiceOf } from "@evertap/api/settings";

import { type Access, createAccess, listenFailure } from "./access.ts";
import { config } from "./config.ts";
import { createDemoStore } from "./demo.ts";
import { createChecks } from "./doctor.ts";
import { createCloudflared } from "./live/cloudflared.ts";
import { DockerError, createDocker } from "./live/docker.ts";
import type { DriverContext } from "./live/driver.ts";
import { createGarageDriver } from "./live/garage.ts";
import { openMetadata } from "./live/metadata.ts";
import { createMysqlDriver } from "./live/mysql.ts";
import { createPostgresDriver } from "./live/postgres.ts";
import { createRedisDriver } from "./live/redis.ts";
import { startPublicS3 } from "./live/s3-proxy.ts";
import { createLiveStore } from "./live/store.ts";
import { readMachine } from "./machine.ts";
import { probeUrl } from "./reach.ts";
import { ANSWER_MS, TUNNEL_UNCONNECTED, createTunnelChanges } from "./tunnel.ts";
import { createUpdateCheck } from "./update-check.ts";
import { VERSION } from "./version.ts";

/** How long a tunnel new to cloudflared has to connect to Cloudflare before evertap gives up on it. */
const CONNECT_MS = 60_000;

/** Ends `evertap serve` with one line saying what to do; a stack would bury it. */
export const quit = (message: string): never => {
  console.error(message);
  process.exit(1);
};

/** Why Docker did not answer, and what to do about it. */
const dockerTrouble = async (error: unknown) => {
  // Docker answered, so it is reachable; its error says what to do, such as updating Docker.
  if (error instanceof DockerError) {
    return error.message;
  }
  const socket = config.dockerSocket;
  let code: unknown;
  try {
    await reach(socket, constants.R_OK | constants.W_OK);
  } catch (failure) {
    code = failure instanceof Error && "code" in failure ? failure.code : undefined;
  }
  if (code === "EACCES") {
    return `This user cannot use Docker at ${socket}. Add it to the docker group with sudo usermod -aG docker ${userInfo().username}, then log out and back in, and run evertap serve again`;
  }
  if (code === "ENOENT") {
    return `Docker is not running, or its socket is not at ${socket}. Start Docker, or set EVERTAP_DOCKER_SOCKET to its socket`;
  }
  return `Docker is not answering at ${socket}. Start Docker, then run evertap serve again`;
};

const startAccess = (options: Parameters<typeof createAccess>[0]) => {
  try {
    return createAccess(options);
  } catch (error) {
    if (error instanceof DataError) {
      return quit(error.message);
    }
    throw error;
  }
};

const createLive = async () => {
  await mkdir(config.dataDir, { recursive: true });
  // The records and entry config hold every database password.
  await chmod(config.dataDir, 0o700);
  const docker = await createDocker({ socket: config.dockerSocket, network: config.prefix }).catch(
    async (error: unknown) => quit(await dockerTrouble(error)),
  );
  const metadata = openMetadata(join(config.dataDir, "evertap.db"));
  const access = startAccess({
    saved: metadata.settings(),
    keep: metadata.putSettings,
    variables: config.settings,
    // Only to offer it as a place to listen; a Docker that cannot say leaves it out. Docker Desktop,
    // and every Docker off Linux, runs in a VM whose bridge is not an address of this machine.
    dockerAddress:
      process.platform === "linux" &&
      (await docker.info().catch(() => null))?.OperatingSystem !== "Docker Desktop"
        ? await docker.bridgeAddress().catch(() => null)
        : null,
  });
  const context = async (engine: ResourceEngine, publicPort: number): Promise<DriverContext> => {
    const dir = join(config.dataDir, engine);
    await mkdir(dir, { recursive: true });
    return {
      docker,
      metadata,
      prefix: config.prefix,
      publicPort,
      urlHost: DATABASE_HOST,
      urlPort: isDatabaseEngine(engine) ? DATABASE_PORTS[engine] : publicPort,
      entry: () => access.entry(engine),
      dir,
    };
  };
  const drivers = {
    postgresql: createPostgresDriver(await context("postgresql", config.postgresPort)),
    mysql: createMysqlDriver(await context("mysql", config.mysqlPort)),
    redis: createRedisDriver(await context("redis", config.redisPort)),
    garage: createGarageDriver(await context("garage", config.garagePort)),
  };
  const explain = (engine: ResourceEngine, error: unknown) =>
    listenFailure(error, access.entry(engine), access.portVariable(engine));
  // Every engine is tried, so moving back after a failure leaves none behind.
  access.follow(() => {
    let first: unknown;
    for (const engine of RESOURCE_ENGINES) {
      try {
        drivers[engine].rebind();
      } catch (error) {
        const failure = explain(engine, error);
        first ??=
          failure instanceof DataError ? new DataError(`${engine}: ${failure.message}`) : failure;
      }
    }
    if (first !== undefined) {
      throw first;
    }
  });
  const cloudflared = createCloudflared({
    docker,
    prefix: config.prefix,
    dir: join(config.dataDir, "cloudflared"),
  });
  // Like an engine, it starts in the background; the doctor says when it could not.
  cloudflared.sync(access.tunnel()).catch((error: unknown) => {
    console.error("cloudflared:", error);
  });
  const publicStorage = startPublicS3({
    reachable: (accessKeyId) =>
      metadata
        .listResources()
        .some(
          (row) =>
            row.kind === "object-storage" &&
            row.reachableAnywhere &&
            row.accessKeyId === accessKeyId,
        ),
    forward: drivers.garage.forward,
  });
  const movePublicStorage = () => {
    const address = access.storage();
    try {
      publicStorage.move(address);
    } catch (error) {
      const failure =
        address === null ? error : listenFailure(error, address, "EVERTAP_PUBLIC_S3_PORT");
      throw failure instanceof DataError
        ? new DataError(`Buckets reached from anywhere: ${failure.message}`)
        : failure;
    }
  };
  try {
    movePublicStorage();
  } catch (error) {
    // Like an engine that cannot start: the rest runs, and the next settings change tries again.
    console.error(error instanceof DataError ? error.message : error);
  }
  access.follow(movePublicStorage);
  const updates = createUpdateCheck({
    version: VERSION,
    enabled: config.updateCheck,
    image: config.image,
  });
  updates.start();
  const live = createLiveStore({
    version: VERSION,
    host: config.host,
    metadata,
    drivers,
    machine: () => readMachine(config.dataDir),
    pull: docker.pull,
    storageUrl: () => access.current().storageUrl.value,
    update: updates.latest,
    checks: createChecks({
      docker,
      socket: config.dockerSocket,
      dataDir: config.dataDir,
      host: config.host,
      hostChosen: config.hostChosen,
      access: () => choiceOf(access.current(), access.environment),
      publicUrl: () => access.current().publicUrl.value,
      entry: access.entry,
      portVariable: access.portVariable,
      ui: access.ui,
      tunnel: () => cloudflared.report(access.tunnel()),
    }),
    explain,
  });
  const settings = () => Promise.resolve(access.snapshot());
  const putInForce = async (
    saved: SavedSettings,
    report: (phase: TunnelPhase) => void = () => undefined,
  ) => {
    const running = access.tunnel();
    const next = access.tunnelAfter(saved);
    const starts = next !== null && next.token !== running?.token;
    // A tunnel that does not connect would leave browsers nowhere, so the settings stay as they are.
    if (starts) {
      report("connecting");
      await cloudflared.sync(next);
      if (!(await cloudflared.connects(next, CONNECT_MS))) {
        await cloudflared.sync(running).catch(() => undefined);
        throw new DataError(TUNNEL_UNCONNECTED);
      }
    }
    report("switching");
    try {
      access.save(saved);
    } catch (error) {
      if (starts) {
        await cloudflared.sync(running).catch(() => undefined);
      }
      throw error;
    }
    if (running && !next) {
      // The answer to this change may go back through the tunnel it ends.
      setTimeout(() => void cloudflared.sync(access.tunnel()).catch(() => undefined), ANSWER_MS);
      return;
    }
    await cloudflared.sync(next);
  };
  const saveSettings = async (saved: SavedSettings) => {
    await putInForce(saved);
  };
  const tunnelChanges = createTunnelChanges({
    settings,
    save: putInForce,
    run: cloudflared.sync,
  });
  const store: Store = {
    ...live,
    settings,
    saveSettings,
    approveCloudflare: tunnelChanges.approve,
    changeTunnel: tunnelChanges.change,
    tunnelProgress: tunnelChanges.progress,
    probe: probeUrl,
  };
  const close = async () => {
    publicStorage.stop();
    await live.close();
  };
  return { store, access, close };
};

// The demo starts nothing to move: settings saved in it stay in memory with its sample data.
const createDemo = () => {
  const access = startAccess({ saved: null, keep: () => {}, variables: config.settings });
  return {
    // The demo answers its health check too, so the check of its URL is real.
    store: { ...createDemoStore(VERSION, access.environment), probe: probeUrl },
    access,
    close: () => Promise.resolve(),
  };
};

export const {
  store,
  access,
  close,
}: { store: Store; access: Access; close: () => Promise<void> } = config.demo
  ? createDemo()
  : await createLive();
