/** Rules the UI and the API share; no zod here so the web bundle stays free of it. */

export const DATABASE_ENGINES = ["postgresql", "mysql", "redis"] as const;
export const STORAGE_ENGINES = ["garage"] as const;
export const RESOURCE_ENGINES = [...DATABASE_ENGINES, ...STORAGE_ENGINES] as const;

export type ResourceEngine = (typeof RESOURCE_ENGINES)[number];
export type DatabaseEngine = (typeof DATABASE_ENGINES)[number];
export type StorageEngine = (typeof STORAGE_ENGINES)[number];

/**
 * Every database URL and bucket endpoint names this host on the engine's standard port, whatever
 * the version and wherever the developer is: the CLI's relay answers there on their machine. A
 * loopback address of its own (127.77.0.1) keeps it apart from `localhost`.
 */
export const DATABASE_HOST = "ev.internal";

/** Addresses that listen on every interface, loopback included. */
export const WILDCARDS = new Set(["0.0.0.0", "::", "[::]"]);

/** Where `DATABASE_HOST` points on each machine. */
export const DATABASE_ADDRESS = "127.77.0.1";

export const DATABASE_PORTS: Record<DatabaseEngine, number> = {
  postgresql: 5432,
  mysql: 3306,
  redis: 6379,
};

export const STORAGE_PORTS: Record<StorageEngine, number> = {
  garage: 3900,
};

export const RESOURCE_PORTS: Record<ResourceEngine, number> = {
  ...DATABASE_PORTS,
  ...STORAGE_PORTS,
};

/** The same in every access mode, so a project's `.env` never changes. */
export const bucketEndpoint = (engine: StorageEngine) =>
  `http://${DATABASE_HOST}:${STORAGE_PORTS[engine]}`;

/** Every bucket's region: many apps assume it, and Garage refuses a request signed for another. */
export const STORAGE_REGION = "us-east-1";

/** The address examples give buckets reached from anywhere, until the person gives theirs. */
export const STORAGE_URL_EXAMPLE = "https://s3.example.com";

/**
 * How browsers and apps reach evertap, as the settings keep it. `network`: the person's LAN, or
 * their own reverse proxy or tunnel. `cloudflare`: the Cloudflare Tunnel evertap runs. `local`:
 * only this machine, at `DATABASE_HOST`. Until one is chosen, evertap listens on 127.0.0.1.
 */
export const ACCESS_MODES = ["network", "cloudflare", "local"] as const;

export type AccessMode = (typeof ACCESS_MODES)[number];

/**
 * Where a person opens evertap from: the one question `evertap setup` and Settings ask, in this
 * order. `network` and `proxy` are both the `network` mode, told apart by where the UI listens.
 */
export const ACCESS_CHOICES = ["local", "network", "cloudflare", "proxy"] as const;

export type AccessChoice = (typeof ACCESS_CHOICES)[number];

export const ACCESS_QUESTION = "Where will you open evertap from?";

/** What `evertap setup`, Settings, and the Doctor call each choice, with a line on what it means. */
export const ACCESS_CHOICE_NAMES: Record<AccessChoice, { label: string; hint: string }> = {
  local: { label: "This computer only", hint: `Apps on it connect to ${DATABASE_HOST} directly` },
  network: {
    label: "Devices on your network",
    hint: "Phones and laptops on your LAN or Tailscale, over plain HTTP",
  },
  cloudflare: {
    label: "Anywhere, through Cloudflare",
    hint: "evertap runs a Cloudflare Tunnel. Needs a domain on Cloudflare",
  },
  proxy: {
    label: "Behind your own proxy or tunnel",
    hint: "Caddy, nginx, Tailscale Serve, or a cloudflared you run",
  },
};

/** The mode a choice saves. */
const modeOf = (choice: AccessChoice): AccessMode => (choice === "proxy" ? "network" : choice);

const LOOPBACK = /^(127\.|::1$)/;

/**
 * Which choice network mode is where the UI listens at `listenHost`: loopback and Docker's bridge
 * (`docker`, where it has one) are for a proxy or tunnel of the person's own.
 */
export const networkChoice = (listenHost: string, docker: string | null) =>
  LOOPBACK.test(listenHost) || listenHost === docker ? "proxy" : "network";

/** Which choice a mode and listen address are; null until evertap is set up. */
export const accessChoice = (
  mode: AccessMode | null,
  listenHost: string,
  docker: string | null,
): AccessChoice | null => (mode === "network" ? networkChoice(listenHost, docker) : mode);

/**
 * The choices left where environment variables fix the mode or the listen address (`fixed`, each
 * null when unset).
 */
export const offeredChoices = (
  fixed: { mode: AccessMode | null; listenHost: string | null },
  docker: string | null,
) =>
  ACCESS_CHOICES.filter(
    (choice) =>
      (fixed.mode === null || modeOf(choice) === fixed.mode) &&
      (fixed.listenHost === null ||
        modeOf(choice) !== "network" ||
        networkChoice(fixed.listenHost, docker) === choice),
  );

/**
 * The domain a name of a tunnel evertap makes sits in: all but its first label, as the names go one
 * label deep, which is all Universal SSL covers.
 */
export const zoneOf = (hostname: string) => hostname.slice(hostname.indexOf(".") + 1);

/** The names a tunnel evertap makes in `zone` serves unless the person gives others. */
export const defaultTunnelNames = (zone: string) => ({
  ui: `evertap.${zone}`,
  storage: `s3.${zone}`,
});

/** The name of the tunnel evertap makes in a Cloudflare account, and looks for there. */
export const TUNNEL_NAME = "evertap";

/** Where a person takes back the access they gave evertap in Cloudflare, should evertap fail to. */
export const CLOUDFLARE_CONNECTED_APPS =
  "https://dash.cloudflare.com/profile/access-management/authorization";

/**
 * What evertap made in Cloudflare for a tunnel, with where each is in Cloudflare's dashboard, for a
 * person to remove when evertap does not.
 */
export const tunnelLeftovers = ({
  accountId,
  zone,
  hostnames: names,
}: {
  accountId: string;
  zone: string;
  hostnames: { ui: string; storage: string };
}) => {
  const account = `https://dash.cloudflare.com/${accountId}`;
  return [
    {
      what: `The tunnel ${TUNNEL_NAME}`,
      where: "Networking → Tunnels",
      url: `${account}/tunnels`,
    },
    {
      what: `The DNS records ${names.ui} and ${names.storage}`,
      where: `DNS for ${zone}`,
      url: `${account}/${zone}/dns/records`,
    },
    {
      what: `The Cache Rule for ${names.storage}`,
      where: `Caching → Cache Rules for ${zone}`,
      url: `${account}/${zone}/caching/cache-rules`,
    },
  ];
};

/**
 * Where a change to the tunnel evertap runs is, while the person waits for it: checking the code
 * they pasted, making or removing in Cloudflare, cloudflared connecting, then switching to it.
 */
export const TUNNEL_PHASES = ["approval", "cloudflare", "connecting", "switching"] as const;

export type TunnelPhase = (typeof TUNNEL_PHASES)[number];

/** What the doctor and Settings say about the tunnel evertap runs, by how it is doing. */
export const TUNNEL_STATES = {
  connected: { label: "Connected", advice: null },
  connecting: {
    label: "Not connected yet",
    advice: "If this lasts, let this machine connect out to Cloudflare on TCP 7844 in its firewall",
  },
  stopped: {
    label: "Not running",
    advice:
      "Restart evertap to start it again. evertap doctor on the machine running evertap says why it stopped",
  },
} as const;

/**
 * Where network mode can put the UI. `lan`: every interface, for the home network. `proxy`: behind
 * a proxy on this machine. `docker`: Docker's bridge, behind a proxy run with Docker.
 */
export const LISTEN_USES = ["lan", "proxy", "docker"] as const;

/** Where the person's own proxy or tunnel runs, as setup and Settings ask it for `proxy`. */
export const PROXY_PLACES: Record<
  Exclude<(typeof LISTEN_USES)[number], "lan">,
  { label: string; hint: string }
> = {
  proxy: { label: "On this machine", hint: "evertap listens on 127.0.0.1 for it" },
  docker: {
    label: "In Docker",
    hint: "evertap listens on Docker's bridge, where a container reaches this machine",
  },
};

/** The warning where listening opens the UI on a public address, unencrypted. */
export const exposedWarning = (address: string) =>
  `${address} is a public address: anyone on the internet can open evertap there, unencrypted. Block that in your firewall, or use a proxy with HTTPS`;

/** The environment variable that fixes each setting; while it is set, the saved value is ignored. */
export const SETTING_VARIABLES = {
  mode: "EVERTAP_MODE",
  publicUrl: "EVERTAP_PUBLIC_URL",
  listenHost: "EVERTAP_LISTEN_HOST",
} as const;

/** What a read-only console run says when the text tries to change something. */
export const READ_ONLY_REFUSED =
  "The console is read-only. Turn on Allow writes to change data, then run it again";

/**
 * Major versions offered at creation, newest first; the first is the default. MySQL offers LTS
 * lines only. Object storage has none: S3 clients see no difference between versions.
 */
export const DATABASE_VERSIONS = {
  postgresql: ["18", "17", "16", "15"],
  mysql: ["9.7", "8.4"],
  redis: ["8.10", "8.2", "7.4"],
} as const satisfies Record<DatabaseEngine, readonly string[]>;

export const isDatabaseEngine = (engine: ResourceEngine): engine is DatabaseEngine =>
  engine !== "garage";

export const RESOURCE_NAME_MAX = 63;

/** A note is a one-line label: about this many characters fit a list row at full width. */
export const DESCRIPTION_MAX = 80;

/** A label alone, which no URL carries, easy to type in the CLI. */
const LABEL_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,62}$/;
const BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/** The message to show for a bad name, or null when the name is fine. */
export const resourceNameError = (name: string, engine: ResourceEngine): string | null => {
  if (engine === "garage") {
    return BUCKET_NAME_PATTERN.test(name)
      ? null
      : "Use 3–63 lowercase letters, digits or hyphens. Start and end with a letter or digit";
  }
  return LABEL_NAME_PATTERN.test(name)
    ? null
    : "Start with a lowercase letter and use only lowercase letters, digits, _ or - (63 characters max)";
};

/** A temporary resource is deleted after this long without a connection. */
export const TEMPORARY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** From this used share of CPU, memory, or disk the sidebar meter turns amber (disk: under 20% free). */
export const USAGE_WARNING_RATIO = 0.8;

/** From this used share the meter turns red. */
export const USAGE_CRITICAL_RATIO = 0.9;

export const CLIENT_NAME_MAX = 63;

/** How long a code (from `evertap login` or a browser's sign-in page) or a sign-in link lasts. */
export const PAIRING_WINDOW_MS = 10 * 60 * 1000;

/** The browser's session token. The server keeps the 30-day window; the cookie outlives it. */
export const SESSION_COOKIE = "evertap_session";

/**
 * A cookie's name on a request over HTTPS or not. Over HTTPS it carries `__Host-`, so another host
 * under the same domain cannot plant it; plain HTTP cannot carry the prefix.
 */
export const cookieName = (name: string, https: boolean | undefined) =>
  https ? `__Host-${name}` : name;

/** A browser stays signed in this long after its last call. */
export const SESSION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Starting a request needs no sign-in, so each source may hold only a few open at once. A cap
 * shared by everyone would let one flood lock every person out of signing in.
 */
export const REQUESTS_PER_SOURCE_MAX = 5;

/**
 * A site is often handed an IPv6 /48, which holds 65,536 /64s, so the /48 has a cap of its own.
 * Without it, one site could fill the backstop below with a few requests from each /64.
 */
export const REQUESTS_PER_SITE_MAX = REQUESTS_PER_SOURCE_MAX * 4;

/** A backstop on memory and disk across all sources. */
export const PENDING_REQUESTS_MAX = 500;

/** Consonants only, as RFC 8628 suggests: no look-alike characters and no accidental words. */
export const PAIRING_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

const PAIRING_CODE_PATTERN = new RegExp(`^[${PAIRING_CODE_ALPHABET}]{8}$`);

/** `bcdf ghjk` → `BCDF-GHJK`; null when what was typed cannot be a code. */
export const normalizePairingCode = (typed: string): string | null => {
  const letters = typed.toUpperCase().replaceAll(/[^A-Z]/g, "");
  return PAIRING_CODE_PATTERN.test(letters) ? `${letters.slice(0, 4)}-${letters.slice(4)}` : null;
};

/** The pending request the demo seeds, since no CLI exists yet to ask for one. */
export const DEMO_PAIRING_CODE = "HSDM-PRNG";

/** `Chrome on macOS`: how a browser session is named in Clients and on the approval page. */
export const browserName = (userAgent: string | null | undefined): string => {
  const ua = userAgent ?? "";
  const browser = ua.includes("Edg/")
    ? "Edge"
    : ua.includes("OPR/")
      ? "Opera"
      : ua.includes("Firefox/")
        ? "Firefox"
        : ua.includes("Chrome/")
          ? "Chrome"
          : ua.includes("Safari/")
            ? "Safari"
            : "Browser";
  const system = /iPhone|iPad/.test(ua)
    ? "iOS"
    : ua.includes("Android")
      ? "Android"
      : ua.includes("Mac OS X")
        ? "macOS"
        : ua.includes("Windows")
          ? "Windows"
          : ua.includes("Linux")
            ? "Linux"
            : null;
  return system ? `${browser} on ${system}` : browser;
};
