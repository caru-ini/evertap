import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { STORAGE_REGION } from "@evertap/api/rules";
import { z } from "zod";

import type { DriverContext, StorageDriver, Usage } from "./driver.ts";
import { s3Error, startS3Proxy, type S3Proxy } from "./s3-proxy.ts";
import { bucketClient, createObjectBrowser, emptyBucket } from "./s3.ts";

const IMAGE =
  "dxflrs/garage:v2.4.1@sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020";
const S3_PORT = "3900/tcp";
const ADMIN_PORT = "3903/tcp";
const READY_TIMEOUT_MS = 120_000;

/** Every origin may call a bucket: an app's browser uploads always come from another origin. */
const CORS_RULES = [
  {
    AllowedOrigin: ["*"],
    AllowedMethod: ["GET", "PUT", "POST", "DELETE", "HEAD"],
    AllowedHeader: ["*"],
    ExposeHeader: ["ETag"],
    MaxAgeSeconds: 3600,
  },
];

const bucketSchema = z.object({ id: z.string(), bytes: z.number() });
const keySchema = z.object({ accessKeyId: z.string(), secretAccessKey: z.string() });
const keyInfoSchema = z.object({
  buckets: z.array(
    z.object({
      id: z.string(),
      globalAliases: z.array(z.string()),
      localAliases: z.array(z.string()),
    }),
  ),
});
const statusSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      dataPartition: z.object({ total: z.number() }).nullish(),
    }),
  ),
});
const layoutSchema = z.object({ version: z.number(), roles: z.array(z.unknown()) });

const config = ({
  rpcSecret,
  adminToken,
}: {
  rpcSecret: string;
  adminToken: string;
}) => `metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "${rpcSecret}"

[s3_api]
s3_region = "${STORAGE_REGION}"
api_bind_addr = "[::]:3900"

[admin]
api_bind_addr = "[::]:3903"
admin_token = "${adminToken}"
`;

const withQuery = (path: string, params: Record<string, string>) =>
  `${path}?${new URLSearchParams(params).toString()}`;

class AdminError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * One shared Garage node. A resource is a key and a first bucket; the key may create more buckets,
 * each named in a namespace of its own, so two resources can both have `uploads`. Only evertap
 * holds the admin token, and the admin API stays on 127.0.0.1.
 */
export const createGarageDriver = (context: DriverContext): StorageDriver => {
  const { docker, metadata, prefix } = context;
  const name = `${prefix}-garage`;
  const adminToken = () => metadata.secret("garage-admin");
  /** Access key → resource id, for the entry. Filled by `start` and `provision`. */
  const keys = new Map<string, string>();
  let ports: { s3: number; admin: number } | null = null;
  let starting: Promise<{ s3: number; admin: number }> | null = null;
  let proxy: S3Proxy | null = null;

  const forget = () => {
    ports = null;
  };

  /** The running node's ports, without starting it. */
  const portsOf = async () => {
    if (ports !== null) {
      return ports;
    }
    const published = (await docker.inspect(name))?.ports;
    const s3 = published?.[S3_PORT];
    const admin = published?.[ADMIN_PORT];
    if (s3 === undefined || admin === undefined) {
      throw new Error(`${name} is not running`);
    }
    ports = { s3, admin };
    return ports;
  };

  const request = async (adminPort: number, path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${adminPort}/v2/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${adminToken()}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      throw new AdminError(
        response.status,
        `Garage ${path}: ${response.status} ${await response.text()}`,
      );
    }
    const text = await response.text();
    return text === "" ? null : JSON.parse(text);
  };

  const call = async (path: string, body?: unknown) => {
    try {
      return await request((await portsOf()).admin, path, body);
    } catch (error) {
      if (!(error instanceof AdminError)) {
        forget();
      }
      throw error;
    }
  };

  const ignoreMissing = async (run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      if (!(error instanceof AdminError && error.status === 404)) {
        throw error;
      }
    }
  };

  /** A fresh node holds no data until it has a role in the layout; a single node takes it all. */
  const ensureLayout = async (adminPort: number) => {
    const layout = layoutSchema.parse(await request(adminPort, "GetClusterLayout"));
    if (layout.roles.length > 0) {
      return;
    }
    const status = statusSchema.parse(await request(adminPort, "GetClusterStatus"));
    const node = status.nodes[0];
    if (!node) {
      throw new Error("Garage reports no node");
    }
    await request(adminPort, "UpdateClusterLayout", {
      roles: [
        {
          id: node.id,
          zone: "evertap",
          // Only a weight among nodes; with one node it never limits what can be stored.
          capacity: node.dataPartition?.total ?? 1e12,
          tags: [],
        },
      ],
    });
    await request(adminPort, "ApplyClusterLayout", { version: layout.version + 1 });
  };

  const waitReady = async (adminPort: number) => {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    for (;;) {
      try {
        await request(adminPort, "GetClusterStatus");
        return;
      } catch (error) {
        if (Date.now() > deadline) {
          throw new Error(`Garage on port ${adminPort} did not become ready`, { cause: error });
        }
      }
      await Bun.sleep(500);
    }
  };

  const startNode = async () => {
    const configPath = join(context.dir, "garage.toml");
    const text = config({
      rpcSecret: createHash("sha256").update(metadata.secret("garage-rpc")).digest("hex"),
      adminToken: adminToken(),
    });
    await writeFile(configPath, text, { mode: 0o600 });
    const info = await docker.ensureContainer({
      name,
      image: IMAGE,
      // Garage reads its config only when it starts, so a changed one replaces the container.
      env: { EVERTAP_CONFIG: createHash("sha256").update(text).digest("hex") },
      ports: {
        [S3_PORT]: { hostIp: "127.0.0.1", hostPort: 0 },
        [ADMIN_PORT]: { hostIp: "127.0.0.1", hostPort: 0 },
      },
      volumes: { [name]: "/var/lib/garage" },
      binds: { [configPath]: "/etc/garage.toml" },
    });
    const s3 = info.ports[S3_PORT];
    const admin = info.ports[ADMIN_PORT];
    if (s3 === undefined || admin === undefined) {
      throw new Error(`${name} has no published port`);
    }
    await waitReady(admin);
    await ensureLayout(admin);
    ports = { s3, admin };
    return ports;
  };

  /** Starts the node if needed and waits until it takes buckets. */
  const ready = () => {
    starting ??= startNode().finally(() => {
      starting = null;
    });
    return starting;
  };

  const instanceUrl = async () => `http://127.0.0.1:${(await portsOf()).s3}`;

  /** The key's buckets, each with the names the key reaches it by; none once the key is gone. */
  const bucketsOf = async (accessKeyId: string) => {
    try {
      const info = keyInfoSchema.parse(await call(withQuery("GetKeyInfo", { id: accessKeyId })));
      return info.buckets.map((bucket) => ({
        id: bucket.id,
        names: [...bucket.localAliases, ...bucket.globalAliases],
      }));
    } catch (error) {
      if (error instanceof AdminError && error.status === 404) {
        return [];
      }
      throw error;
    }
  };

  /** Deletes the key's buckets and then the key, so a retry still finds what is left. */
  const removeKey = async (key: { accessKeyId: string; secretAccessKey: string }) => {
    // Otherwise an app still running could make a bucket after the last one is gone.
    await ignoreMissing(() =>
      call(withQuery("UpdateKey", { id: key.accessKeyId }), { deny: { createBucket: true } }),
    );
    for (const bucket of await bucketsOf(key.accessKeyId)) {
      const alias = bucket.names[0];
      if (alias !== undefined) {
        // The key can delete objects; the bucket goes through the admin API.
        await emptyBucket(
          bucketClient({ ...key, name: alias, region: STORAGE_REGION }, await instanceUrl()),
        );
      }
      await ignoreMissing(() => call(withQuery("DeleteBucket", { id: bucket.id }), {}));
    }
    await ignoreMissing(() => call(withQuery("DeleteKey", { id: key.accessKeyId }), {}));
    keys.delete(key.accessKeyId);
  };

  const allowBrowsers = (bucketId: string) =>
    call(withQuery("UpdateBucket", { id: bucketId }), { corsRules: CORS_RULES });

  return {
    images: () => [IMAGE],

    start: async (resources) => {
      for (const resource of resources) {
        keys.set(resource.accessKeyId, resource.id);
      }
      proxy ??= startS3Proxy({
        ...context.entry(),
        upstream: async () => (await portsOf()).s3,
        unreachable: forget,
        resolve: (accessKeyId) => keys.get(accessKeyId) ?? null,
        // As the first bucket allows them, so does every bucket an app creates.
        created: async (accessKeyId, alias) => {
          const bucket = (await bucketsOf(accessKeyId)).find((item) => item.names.includes(alias));
          if (bucket !== undefined) {
            await allowBrowsers(bucket.id);
          }
        },
      });
      if (resources.length > 0) {
        await ready();
      }
    },

    provision: async ({ id, name: bucket }) => {
      await ready();
      const key = keySchema.parse(
        await call("CreateKey", { name: `evertap-${id}`, allow: { createBucket: true } }),
      );
      try {
        // A local alias, not a global one, which would keep every other key from that name. Read
        // and write but not owner, which could delete it while empty, past `protected`.
        const { id: bucketId } = bucketSchema.parse(
          await call("CreateBucket", {
            localAlias: {
              accessKeyId: key.accessKeyId,
              alias: bucket,
              allow: { read: true, write: true, owner: false },
            },
          }),
        );
        await allowBrowsers(bucketId);
      } catch (error) {
        // Nothing records a bucket that failed to provision, so leave none of it behind.
        await removeKey(key).catch((cleanupError: unknown) => {
          console.error(`cleaning up ${bucket}:`, cleanupError);
        });
        throw error;
      }
      keys.set(key.accessKeyId, id);
      return { accessKeyId: key.accessKeyId, secretAccessKey: key.secretAccessKey };
    },

    drop: removeKey,

    usage: async (resources) => {
      const usage = new Map<string, Usage>();
      for (const resource of resources) {
        try {
          const buckets = await bucketsOf(resource.accessKeyId);
          if (buckets.length === 0) {
            continue;
          }
          let sizeBytes = 0;
          for (const { id } of buckets) {
            sizeBytes += bucketSchema.parse(await call(withQuery("GetBucketInfo", { id }))).bytes;
          }
          usage.set(resource.id, {
            sizeBytes,
            connected: proxy?.takeConnected(resource.id) ?? false,
          });
        } catch (error) {
          console.error(`usage for ${resource.name}:`, error);
        }
      }
      return usage;
    },

    forward: (incoming) =>
      proxy?.forward(incoming) ??
      Promise.resolve(
        s3Error(503, "ServiceUnavailable", "Buckets are starting. Try again in a moment"),
      ),

    rebind: () => {
      proxy?.move(context.entry());
    },

    close: () => {
      proxy?.stop();
      proxy = null;
      return Promise.resolve();
    },

    ...createObjectBrowser(instanceUrl),
  };
};
