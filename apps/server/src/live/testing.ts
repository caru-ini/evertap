import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { config } from "../config.ts";
import { createDocker } from "./docker.ts";
import type { DriverContext } from "./driver.ts";
import { openMetadata } from "./metadata.ts";

/**
 * A driver context for the Docker-backed tests: its own name prefix, port and temp directory, so
 * a run never touches real evertap containers. `cleanup` removes everything it created.
 */
export const createTestContext = async (engine: string, publicPort: number) => {
  const prefix = `evertap-test-${engine}`;
  const dir = await mkdtemp(join(tmpdir(), `${prefix}-`));
  const docker = await createDocker({ socket: config.dockerSocket, network: prefix });
  await docker.removeByPrefix(prefix);
  const metadata = openMetadata(join(dir, "evertap.db"));
  const context: DriverContext = {
    docker,
    metadata,
    prefix,
    publicPort,
    // The tests connect to the entry itself, not through the CLI's relay.
    urlHost: "127.0.0.1",
    urlPort: publicPort,
    entry: () => ({ hostname: "127.0.0.1", port: publicPort }),
    dir,
  };
  const cleanup = async () => {
    metadata.close();
    await docker.removeByPrefix(prefix);
    await rm(dir, { recursive: true, force: true });
  };
  return { context, cleanup };
};

/** A port nothing listens on, for code that takes a port instead of picking its own. */
export const freePort = () => {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: () => {} } });
  const { port } = probe;
  probe.stop(true);
  return port;
};

/**
 * The context as a later evertap release builds it: every container's spec differs, so a driver
 * replaces each container it brings up, as after an upgrade.
 */
export const laterRelease = (context: DriverContext): DriverContext => ({
  ...context,
  docker: {
    ...context.docker,
    ensureContainer: (spec) =>
      context.docker.ensureContainer({ ...spec, env: { ...spec.env, EVERTAP_TEST_RELEASE: "2" } }),
  },
});

/** Changes when a container is replaced, not when it restarts. */
export const containerId = async (name: string) => {
  const response = await fetch(`http://docker/containers/${encodeURIComponent(name)}/json`, {
    unix: config.dockerSocket,
  });
  return z.object({ Id: z.string() }).parse(await response.json()).Id;
};
