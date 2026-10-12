/** The few Docker Engine API calls evertap needs, over the local socket. No compose files. */

import { createHash } from "node:crypto";
import { isIP } from "node:net";

import { DataError, UnavailableError } from "@evertap/api/context";
import { z } from "zod";

// The oldest Engine API version evertap supports (Docker 24) and the newest it has been run
// against. A newer engine is spoken to in the newest, so its later API changes cannot break evertap.
const OLDEST_API = "1.43";
const NEWEST_API = "1.56";

export type PortBinding = {
  /** Where to listen on the host: `127.0.0.1` for evertap's own use, `0.0.0.0` for the LAN. */
  hostIp: string;
  /** 0 lets Docker pick a free one; read it back from `ContainerInfo.ports`. */
  hostPort: number;
};

export type ContainerSpec = {
  name: string;
  image: string;
  cmd?: string[];
  env?: Record<string, string>;
  /** Container port (`5432/tcp`) → host binding. */
  ports?: Record<string, PortBinding>;
  /** Named volume → path inside the container. Created on first use. */
  volumes?: Record<string, string>;
  /** Host path → path inside the container. */
  binds?: Record<string, string>;
  /**
   * `host` shares this machine's network instead of evertap's own, with no ports to publish.
   * `isolated` joins a network whose containers cannot reach each other, for an instance its user
   * controls fully; it is reached only where it publishes.
   */
  network?: "host" | "isolated";
  /** A command Docker runs now and then to mark the container healthy, when it exits 0. */
  healthcheck?: string[];
  /** Docker's init as process 1, to reap the programs that the engine's own children leave. */
  init?: boolean;
};

/** A container of the person's own and where on the host it publishes over TCP. */
export type Published = {
  name: string;
  /** A running one holds its ports now; a stopped one asks for them again when it starts. */
  running: boolean;
  /** `0.0.0.0` for every IPv4 address, as an empty host IP means. */
  bindings: PortBinding[];
};

export type ContainerInfo = {
  running: boolean;
  /**
   * Container port (`5432/tcp`) → published host port. A stopped container shows only the ports
   * it was created with a fixed number for.
   */
  ports: Record<string, number>;
};

export class DockerError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const LABEL = "evertap.managed";
/** A hash of what a container was created from; another evertap release or setting differs. */
const SPEC_LABEL = "evertap.spec";
/** How long an engine gets to shut down cleanly before it is replaced. */
const STOP_TIMEOUT_S = 60;
/** A download stuck longer than this gives way, so the next create can start another. */
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;

const filters = (filter: Record<string, string[]>) => encodeURIComponent(JSON.stringify(filter));

/**
 * What `EVERTAP_PREFIX` may be. Docker's name filter matches anywhere in a name, and an empty one
 * matches every name, so a prefix outside this would reach the person's own containers and volumes.
 */
export const NAME_PREFIX = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

/**
 * What evertap names the isolated network's bridge: not Docker's `br-…`, whose requests evertap
 * takes for a proxy's (`fromProxy`), as an instance's user can run programs there. Linux allows 15
 * characters.
 */
export const ISOLATED_BRIDGE = /^ev-[0-9a-f]{12}$/;

const portsSchema = z
  .record(z.string(), z.array(z.object({ HostPort: z.string() })).nullable())
  .nullable();

const inspectSchema = z.object({
  Config: z.object({ Labels: z.record(z.string(), z.string()).nullish() }),
  State: z.object({ Running: z.boolean() }),
  HostConfig: z.object({ PortBindings: portsSchema.optional() }),
  NetworkSettings: z.object({ Ports: portsSchema }),
});

const engineSchema = z.object({
  Version: z.string(),
  ApiVersion: z.string(),
  MinAPIVersion: z.string(),
});

const infoSchema = z.object({
  ServerVersion: z.string(),
  DockerRootDir: z.string(),
  OperatingSystem: z.string(),
  SecurityOptions: z.array(z.string()).nullish(),
  /** API 1.49 and later: `iptables` or `nftables`, with `+firewalld` when firewalld runs. */
  FirewallBackend: z.object({ Driver: z.string() }).nullish(),
});

export type DockerInfo = z.infer<typeof infoSchema>;

const bridgeSchema = z.object({
  IPAM: z.object({
    Config: z.array(z.object({ Gateway: z.string().optional() })).nullish(),
  }),
});

const pullErrorSchema = z.object({
  errorDetail: z.object({ message: z.string() }).optional(),
  // Deprecated in API 1.48 in favor of `errorDetail`, still sent alongside it.
  error: z.string().optional(),
});

// `numeric` orders `1.9` before `1.43`, which comparing the strings would not.
export const compareVersions = (a: string, b: string) =>
  a.localeCompare(b, "en", { numeric: true });

/** The newest API version both evertap and the engine speak, or an error saying what to update. */
export const pickApiVersion = (engine: z.infer<typeof engineSchema>) => {
  if (compareVersions(engine.ApiVersion, OLDEST_API) < 0) {
    throw new DockerError(
      400,
      `Docker ${engine.Version} is too old. Update Docker to version 24 or later`,
    );
  }
  if (compareVersions(engine.MinAPIVersion, NEWEST_API) > 0) {
    throw new DockerError(
      400,
      `Docker ${engine.Version} is newer than this evertap supports. Update evertap`,
    );
  }
  return compareVersions(engine.ApiVersion, NEWEST_API) < 0 ? engine.ApiVersion : NEWEST_API;
};

export type Docker = Awaited<ReturnType<typeof createDocker>>;

/** Agrees on an API version with the engine first, so an engine evertap cannot use fails here. */
export const createDocker = async ({ socket, network }: { socket: string; network: string }) => {
  const request = async (
    prefix: string,
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ) => {
    const response = await fetch(`http://docker${prefix}${path}`, {
      unix: socket,
      method,
      signal,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      let message = text;
      try {
        const parsed: unknown = JSON.parse(text);
        if (typeof parsed === "object" && parsed !== null && "message" in parsed) {
          message = String(parsed.message);
        }
      } catch {
        // Not JSON; keep the raw text.
      }
      throw new DockerError(response.status, `${method} ${path}: ${message}`);
    }
    return response;
  };

  // Without a version in the path, the engine answers in its own newest one.
  const engine = engineSchema.parse(await (await request("", "GET", "/version")).json());
  const apiVersion = pickApiVersion(engine);
  const call = (method: string, path: string, body?: unknown, signal?: AbortSignal) =>
    request(`/v${apiVersion}`, method, path, body, signal);

  const read = async (name: string) => {
    try {
      const response = await call("GET", `/containers/${encodeURIComponent(name)}/json`);
      const data = inspectSchema.parse(await response.json());
      const ports: Record<string, number> = {};
      const published = data.State.Running
        ? data.NetworkSettings.Ports
        : data.HostConfig.PortBindings;
      for (const [port, bindings] of Object.entries(published ?? {})) {
        const hostPort = bindings?.[0]?.HostPort;
        if (hostPort) {
          ports[port] = Number(hostPort);
        }
      }
      const info: ContainerInfo = { running: data.State.Running, ports };
      const labels = data.Config.Labels ?? {};
      return { info, managed: labels[LABEL] === "true", spec: labels[SPEC_LABEL] };
    } catch (error) {
      if (error instanceof DockerError && error.status === 404) {
        return null;
      }
      throw error;
    }
  };

  const inspect = async (name: string) => (await read(name))?.info ?? null;

  const fetchImage = async (image: string) => {
    // `name:tag@sha256:…` is fetched by its digest; the tag is there for people reading it.
    const [name = image, digest] = image.split("@");
    const [repo = name, tag = "latest"] = name.split(/:(?=[^/]+$)/);
    try {
      const response = await call(
        "POST",
        `/images/create?fromImage=${encodeURIComponent(repo)}&tag=${encodeURIComponent(digest ?? tag)}`,
        undefined,
        AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      );
      // Progress arrives as JSON lines; a failed pull still answers 200 and reports it in one.
      const text = await response.text();
      for (const line of text.split("\n")) {
        if (line.includes('"error')) {
          const parsed = pullErrorSchema.safeParse(JSON.parse(line));
          const reason = parsed.success
            ? (parsed.data.errorDetail?.message ?? parsed.data.error)
            : undefined;
          throw new DockerError(500, `pull ${image}: ${reason ?? line}`);
        }
      }
    } catch (error) {
      if (
        error instanceof DockerError ||
        (error instanceof Error && error.name === "TimeoutError")
      ) {
        throw new UnavailableError(
          "This service couldn't be downloaded. Check that the machine running evertap is online and has free disk space, then try again",
          { cause: error },
        );
      }
      throw error;
    }
  };

  const hasImage = async (image: string) => {
    try {
      await call("GET", `/images/${encodeURIComponent(image)}/json`);
      return true;
    } catch (error) {
      if (error instanceof DockerError && error.status === 404) {
        return false;
      }
      throw error;
    }
  };

  /** One download per image at a time: a create and the startup that began it wait on the same one. */
  const downloads = new Map<string, Promise<void>>();
  const download = (image: string) => {
    let pending = downloads.get(image);
    if (!pending) {
      pending = fetchImage(image).finally(() => downloads.delete(image));
      downloads.set(image, pending);
    }
    return pending;
  };

  /** Pulls the image unless it is already present. The first pull can take minutes. */
  const ensureImage = async (image: string) => {
    if (!(await hasImage(image))) {
      await download(image);
    }
  };

  /**
   * Like `ensureImage` for each, but waits at most `waitMs` for downloads: one still running goes
   * on in the background, and the caller is told to come back, so a request never waits out a
   * first pull.
   */
  const pull = async (images: string[], waitMs: number) => {
    const missing = [];
    for (const image of images) {
      if (!(await hasImage(image))) {
        missing.push(image);
      }
    }
    if (missing.length === 0) {
      return;
    }
    const all = Promise.all(missing.map(download));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<"late">((resolve) => {
      timer = setTimeout(resolve, waitMs, "late");
    });
    try {
      if ((await Promise.race([all, late])) === "late") {
        all.catch((error: unknown) => {
          console.error("downloading in the background:", error);
        });
        throw new UnavailableError(
          "This service is still downloading for its first use. Try again in a minute",
        );
      }
    } finally {
      clearTimeout(timer);
    }
  };

  /**
   * One network for every isolated container rather than one each: Docker's default address pools
   * hold about 30 networks, shared with the person's own Compose projects.
   */
  const isolatedNetwork = `${network}-isolated`;
  // A hash, so that each prefix's bridge has a name of its own.
  const isolatedBridge = `ev-${createHash("sha256").update(isolatedNetwork).digest("hex").slice(0, 12)}`;

  const ensureNetwork = async (isolated: boolean) => {
    const name = isolated ? isolatedNetwork : network;
    try {
      await call("GET", `/networks/${encodeURIComponent(name)}`);
    } catch (error) {
      if (!(error instanceof DockerError && error.status === 404)) {
        throw error;
      }
      try {
        await call("POST", "/networks/create", {
          Name: name,
          Driver: "bridge",
          Options: isolated
            ? {
                "com.docker.network.bridge.enable_icc": "false",
                "com.docker.network.bridge.name": isolatedBridge,
              }
            : undefined,
          Labels: { [LABEL]: "true" },
        });
      } catch (createError) {
        // Drivers start in parallel on a first run; another one may have just created it.
        if (!(createError instanceof DockerError && createError.status === 409)) {
          throw createError;
        }
      }
    }
  };

  /** Lets the engine shut down cleanly. A missing or stopped container is fine. */
  const stop = async (name: string) => {
    try {
      await call("POST", `/containers/${encodeURIComponent(name)}/stop?t=${STOP_TIMEOUT_S}`);
    } catch (error) {
      if (!(error instanceof DockerError && (error.status === 304 || error.status === 404))) {
        throw error;
      }
    }
  };

  /**
   * Starts the container, creating it first when missing. One created from another spec, such as
   * by an older evertap with an older image, is replaced; its named volumes stay.
   */
  const ensureContainer = async (spec: ContainerSpec): Promise<ContainerInfo> => {
    const ports = Object.entries(spec.ports ?? {});
    const body = {
      Image: spec.image,
      Cmd: spec.cmd,
      Env: Object.entries(spec.env ?? {}).map(([key, value]) => `${key}=${value}`),
      ExposedPorts: Object.fromEntries(ports.map(([port]) => [port, {}])),
      Healthcheck: spec.healthcheck && { Test: ["CMD", ...spec.healthcheck] },
      HostConfig: {
        NetworkMode:
          spec.network === "host"
            ? "host"
            : spec.network === "isolated"
              ? isolatedNetwork
              : network,
        RestartPolicy: { Name: "unless-stopped" },
        Init: spec.init,
        PortBindings: Object.fromEntries(
          ports.map(([port, binding]) => [
            port,
            [
              {
                HostIp: binding.hostIp,
                HostPort: binding.hostPort === 0 ? "" : String(binding.hostPort),
              },
            ],
          ]),
        ),
        Mounts: Object.entries(spec.volumes ?? {}).map(([source, target]) => ({
          Type: "volume",
          Source: source,
          Target: target,
        })),
        Binds: Object.entries(spec.binds ?? {}).map(([source, target]) => `${source}:${target}`),
      },
    };
    const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const existing = await read(spec.name);
    // Every container evertap made carries the label, so one without it is the person's own.
    if (existing && !existing.managed) {
      throw new DataError(
        `${spec.name} is not evertap's. Rename or remove it, or set EVERTAP_PREFIX to another name`,
      );
    }
    let info: ContainerInfo | null = null;
    if (existing?.spec === hash) {
      info = existing.info;
    } else {
      // Downloaded before the old one stops; offline or with the registry down, the old one
      // carries on until a later start.
      try {
        await ensureImage(spec.image);
      } catch (error) {
        if (!(existing && error instanceof UnavailableError)) {
          throw error;
        }
        console.error(`keeping ${spec.name} as it is:`, error);
        info = existing.info;
      }
      if (!info) {
        if (spec.network !== "host") {
          await ensureNetwork(spec.network === "isolated");
        }
        if (existing) {
          await stop(spec.name);
          await remove(spec.name);
        }
        await call("POST", `/containers/create?name=${encodeURIComponent(spec.name)}`, {
          ...body,
          Labels: { [LABEL]: "true", [SPEC_LABEL]: hash },
        });
        info = { running: false, ports: {} };
      }
    }
    if (!info.running) {
      await call("POST", `/containers/${encodeURIComponent(spec.name)}/start`);
      info = await inspect(spec.name);
    }
    if (!info) {
      throw new DockerError(500, `${spec.name} disappeared while starting`);
    }
    return info;
  };

  /**
   * Removes the container and, when given, its named volumes. Missing ones are fine. `v` takes the
   * volumes Docker made for an image's `VOLUME` it had none for, which nothing else would remove.
   */
  const remove = async (name: string, volumes: string[] = []) => {
    try {
      await call("DELETE", `/containers/${encodeURIComponent(name)}?force=true&v=true`);
    } catch (error) {
      if (!(error instanceof DockerError && error.status === 404)) {
        throw error;
      }
    }
    for (const volume of volumes) {
      try {
        await call("DELETE", `/volumes/${encodeURIComponent(volume)}`);
      } catch (error) {
        if (!(error instanceof DockerError && error.status === 404)) {
          throw error;
        }
      }
    }
  };

  /**
   * Runs `cmd` in a throwaway container with no network, named `name`, and returns what it
   * printed. Fails when it exits with anything but 0. `volumes` maps named volumes to paths.
   */
  const run = async (
    name: string,
    image: string,
    cmd: string[],
    volumes: Record<string, string> = {},
  ) => {
    await ensureImage(image);
    await remove(name);
    // A terminal sends the output as it is, without the frames that split stdout from stderr.
    await call("POST", `/containers/create?name=${encodeURIComponent(name)}`, {
      Image: image,
      Cmd: cmd,
      Tty: true,
      HostConfig: {
        NetworkMode: "none",
        Mounts: Object.entries(volumes).map(([source, target]) => ({
          Type: "volume",
          Source: source,
          Target: target,
        })),
      },
      Labels: { [LABEL]: "true" },
    });
    try {
      const path = `/containers/${encodeURIComponent(name)}`;
      await call("POST", `${path}/start`);
      const { StatusCode } = z
        .object({ StatusCode: z.number() })
        .parse(await (await call("POST", `${path}/wait`)).json());
      const output = await (await call("GET", `${path}/logs?stdout=true&stderr=true`)).text();
      if (StatusCode !== 0) {
        throw new DockerError(500, `${name} exited with ${StatusCode}: ${output.slice(0, 500)}`);
      }
      return output;
    } finally {
      await remove(name);
    }
  };

  /**
   * The containers and volumes named `<prefix>-…`, and the networks named `prefix` and
   * `<prefix>-isolated`. A Compose project called `evertap` names its volumes `evertap_…`, so the
   * dash is what keeps them apart.
   */
  const listByPrefix = async (prefix: string) => {
    if (!NAME_PREFIX.test(prefix)) {
      throw new Error(`${JSON.stringify(prefix)} is not a name prefix evertap can use`);
    }
    const start = `${prefix}-`;
    const containers = z
      .array(z.object({ Names: z.array(z.string()) }))
      .parse(
        await (
          await call(
            "GET",
            `/containers/json?all=true&filters=${filters({ name: [start], label: [LABEL] })}`,
          )
        ).json(),
      );
    const volumes = z
      .object({ Volumes: z.array(z.object({ Name: z.string() })).nullable() })
      .parse(await (await call("GET", `/volumes?filters=${filters({ name: [start] })}`)).json());
    const networks = z
      .array(z.object({ Name: z.string() }))
      .parse(
        await (
          await call("GET", `/networks?filters=${filters({ name: [prefix], label: [LABEL] })}`)
        ).json(),
      );
    return {
      containers: containers
        .flatMap((container) => container.Names.map((name) => name.replace(/^\//, "")))
        .filter((name) => name.startsWith(start)),
      volumes: (volumes.Volumes ?? [])
        .map((volume) => volume.Name)
        .filter((name) => name.startsWith(start)),
      networks: networks
        .map((item) => item.Name)
        .filter((name) => name === prefix || name === `${prefix}-isolated`),
    };
  };

  /** Where the containers evertap did not make publish, so a clash with an entry can be named. */
  const published = async (): Promise<Published[]> => {
    const listed = z
      .array(
        z.object({
          Id: z.string(),
          Names: z.array(z.string()),
          State: z.string(),
          Labels: z.record(z.string(), z.string()).nullish(),
          Ports: z
            .array(
              z.object({
                IP: z.string().optional(),
                PublicPort: z.number().optional(),
                Type: z.string(),
              }),
            )
            .nullish(),
        }),
      )
      .parse(await (await call("GET", "/containers/json?all=true")).json());
    const found = await Promise.all(
      listed
        .filter((container) => container.Labels?.[LABEL] !== "true")
        .map(async (container): Promise<Published | null> => {
          const name = container.Names[0]?.replace(/^\//, "") ?? container.Id.slice(0, 12);
          if (container.State === "running" || container.State === "paused") {
            const bindings = (container.Ports ?? []).flatMap(({ IP, PublicPort, Type }) =>
              Type === "tcp" && PublicPort !== undefined
                ? [{ hostIp: IP || "0.0.0.0", hostPort: PublicPort }]
                : [],
            );
            return { name, running: true, bindings };
          }
          // A stopped container lists no ports; what it asks for at start is in its config.
          try {
            const response = await call("GET", `/containers/${container.Id}/json`);
            const asked = z
              .object({
                HostConfig: z.object({
                  PortBindings: z
                    .record(
                      z.string(),
                      z
                        .array(z.object({ HostIp: z.string().optional(), HostPort: z.string() }))
                        .nullable(),
                    )
                    .nullish(),
                }),
              })
              .parse(await response.json()).HostConfig.PortBindings;
            const bindings = Object.entries(asked ?? {}).flatMap(([port, list]) =>
              port.endsWith("/tcp")
                ? (list ?? []).flatMap(({ HostIp, HostPort }) =>
                    HostPort === ""
                      ? []
                      : [{ hostIp: HostIp || "0.0.0.0", hostPort: Number(HostPort) }],
                  )
                : [],
            );
            return { name, running: false, bindings };
          } catch (error) {
            // Removed since it was listed.
            if (error instanceof DockerError && error.status === 404) {
              return null;
            }
            throw error;
          }
        }),
    );
    return found.flatMap((container) => (container?.bindings.length ? [container] : []));
  };

  /** Removes what `listByPrefix` finds. */
  const removeByPrefix = async (prefix: string) => {
    const found = await listByPrefix(prefix);
    for (const name of found.containers) {
      await remove(name);
    }
    for (const name of found.volumes) {
      await call("DELETE", `/volumes/${encodeURIComponent(name)}?force=true`);
    }
    for (const name of found.networks) {
      try {
        await call("DELETE", `/networks/${encodeURIComponent(name)}`);
      } catch (error) {
        if (!(error instanceof DockerError && error.status === 404)) {
          throw error;
        }
      }
    }
  };

  const version = async () => {
    const response = await call("GET", "/version");
    return z.object({ Version: z.string() }).parse(await response.json()).Version;
  };

  /** How this Docker was installed, for the doctor's warnings. */
  const info = async () => infoSchema.parse(await (await call("GET", "/info")).json());

  /**
   * Where containers reach this machine on Docker's default bridge (docker0); null without one.
   * Asked of Docker, as the interface is down, and missing from `networkInterfaces()`, while no
   * container uses it.
   */
  const bridgeAddress = async () => {
    try {
      const { IPAM } = bridgeSchema.parse(await (await call("GET", "/networks/bridge")).json());
      return (
        IPAM.Config?.map((config) => config.Gateway).find(
          (gateway) => gateway !== undefined && isIP(gateway) === 4,
        ) ?? null
      );
    } catch (error) {
      if (error instanceof DockerError && error.status === 404) {
        return null;
      }
      throw error;
    }
  };

  return {
    apiVersion,
    inspect,
    ensureImage,
    pull,
    ensureNetwork,
    ensureContainer,
    stop,
    remove,
    run,
    listByPrefix,
    removeByPrefix,
    published,
    version,
    info,
    bridgeAddress,
  };
};
