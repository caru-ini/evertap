/** cloudflared, which serves the Cloudflare Tunnel evertap made, while the settings hold one. */

import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DoctorReport, Tunnel } from "@evertap/api/schemas";
import { z } from "zod";

import type { Docker } from "./docker.ts";

// Its entrypoint turns off its own updates, so evertap moves it with a new pin. 2025.4.0 or later
// reads the token from a file.
const IMAGE =
  "cloudflare/cloudflared:2026.9.3@sha256:072c067d25ccbe61d46e18f0d0723255f2bb5304f7317caa95b27031520ff92c";
const TOKEN_FILE = "/etc/cloudflared/token";

/** What cloudflared says it serves: its tunnel, and its links to Cloudflare that are up. */
const tunnelStateSchema = z.object({
  tunnelID: z.string(),
  // Left out while none is up.
  connections: z.array(z.unknown()).default([]),
});

/** What the cloudflared answering at `port` on loopback says it serves; null when none answers. */
const askTunnel = (port: number) =>
  fetch(`http://127.0.0.1:${port}/diag/tunnel`, { signal: AbortSignal.timeout(2000) })
    .then(async (response) => tunnelStateSchema.parse(await response.json()))
    .catch(() => null);

const listenOnLoopback = (port: number) =>
  Bun.listen({ hostname: "127.0.0.1", port, socket: { data: () => {} } });

const isFree = (port: number) => {
  try {
    listenOnLoopback(port).stop(true);
    return true;
  } catch {
    return false;
  }
};

/** `dir` holds the tunnel's token while cloudflared runs, and nothing once it stops. */
export const createCloudflared = ({
  docker,
  prefix,
  dir,
}: {
  docker: Docker;
  prefix: string;
  dir: string;
}) => {
  const name = `${prefix}-cloudflared`;
  const tokenPath = join(dir, "token");
  const portPath = join(dir, "metrics-port");
  let failure: string | null = null;
  let queue = Promise.resolve();

  const savedPort = async () => Number(await readFile(portPath, "utf8").catch(() => ""));

  /**
   * The loopback port cloudflared answers about itself on, kept while it is free or still its own.
   * Not 20241, its default, which a cloudflared the person runs takes first.
   */
  const metricsPort = async (tunnel: Tunnel) => {
    const saved = await savedPort();
    if (saved > 0 && (isFree(saved) || (await askTunnel(saved))?.tunnelID === tunnel.id)) {
      return saved;
    }
    const probe = listenOnLoopback(0);
    const { port } = probe;
    probe.stop(true);
    await writeFile(portPath, String(port));
    return port;
  };

  const start = async (tunnel: Tunnel) => {
    const previous = await readFile(tokenPath, "utf8").catch(() => null);
    await mkdir(dir, { recursive: true });
    // cloudflared runs as its image's own user, so the token must be readable by others; the data
    // directory keeps everyone else out.
    await chmod(dir, 0o755);
    await writeFile(tokenPath, tunnel.token);
    await chmod(tokenPath, 0o644);
    // It reads the token only as it starts.
    if (previous !== null && previous !== tunnel.token) {
      await docker.remove(name);
    }
    // In a container cloudflared answers on every interface by default, which on the host's network
    // would show the ingress rules and a profiler to the LAN.
    const metrics = `127.0.0.1:${await metricsPort(tunnel)}`;
    await docker.ensureContainer({
      name,
      image: IMAGE,
      // The UI and the public S3 entry listen on this machine's 127.0.0.1.
      network: "host",
      // HTTP/2 over TCP: over QUIC, an upload without a Content-Length loses its body.
      cmd: [
        "tunnel",
        "--metrics",
        metrics,
        "--protocol",
        "http2",
        "run",
        "--token-file",
        TOKEN_FILE,
      ],
      binds: { [dir]: "/etc/cloudflared" },
      // The image has no shell or curl; `ready` exits 0 while a link to Cloudflare is up.
      healthcheck: ["/usr/local/bin/cloudflared", "tunnel", "--metrics", metrics, "ready"],
    });
  };

  const stop = async () => {
    await docker.remove(name);
    await rm(dir, { recursive: true, force: true });
  };

  return {
    /**
     * Runs cloudflared for `tunnel`, or removes it and its token for null. Calls run one at a time,
     * in order.
     */
    sync: (tunnel: Tunnel | null) => {
      const run = async () => {
        try {
          await (tunnel ? start(tunnel) : stop());
          failure = null;
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error);
          throw error;
        }
      };
      const next = queue.then(run);
      queue = next.catch(() => {});
      return next;
    },
    /** Whether cloudflared has a link to Cloudflare up for `tunnel` within `waitMs`. */
    connects: async (tunnel: Tunnel, waitMs: number) => {
      const deadline = Date.now() + waitMs;
      for (;;) {
        const state = await askTunnel(await savedPort());
        if (state?.tunnelID === tunnel.id && state.connections.length > 0) {
          return true;
        }
        if (Date.now() >= deadline) {
          return false;
        }
        await Bun.sleep(1000);
      }
    },
    /** How the tunnel runs, for the doctor; null without one. */
    report: async (tunnel: Tunnel | null): Promise<DoctorReport["tunnel"]> => {
      if (!tunnel) {
        return null;
      }
      const hostname = tunnel.hostnames.ui;
      const info = await docker.inspect(name).catch(() => null);
      const state = info?.running ? await askTunnel(await savedPort()) : null;
      // Docker counts a container that keeps restarting as running: a program on its port, such as
      // a cloudflared serving another tunnel, keeps it restarting and answers in its place.
      if (!info?.running || (state && state.tunnelID !== tunnel.id)) {
        return { hostname, state: "stopped", connections: 0, ...(failure && { error: failure }) };
      }
      const connections = state?.connections.length ?? 0;
      return { hostname, state: connections > 0 ? "connected" : "connecting", connections };
    },
  };
};

export type Cloudflared = ReturnType<typeof createCloudflared>;
