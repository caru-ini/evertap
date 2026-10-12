/** A reverse proxy in front of evertap in network mode: its configuration, and a check of the way through it. */

import type { Probe } from "./context.ts";
import { STORAGE_URL_EXAMPLE, WILDCARDS } from "./rules.ts";
import {
  type NetworkGuide,
  OBJECT_PART_SIZE,
  RPC_BODY_MAX,
  type Reach,
  type Settings,
  type TunnelOrigins,
} from "./schemas.ts";
import { type SettingsEnvironment, allowsHost, urlHost } from "./settings.ts";

const LOOPBACK = /^(127\.|::1$)/;

const portOf = (url: URL) =>
  url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);

/** Where a proxy reaches the UI: where it listens, or loopback while that is every interface. */
export const upstream = (listenHost: string, port: number) =>
  `${urlHost(WILDCARDS.has(listenHost) ? "127.0.0.1" : listenHost)}:${port}`;

/** Where a tunnel should send its names, as only evertap knows the ports it was started with. */
export const tunnelOrigins = (environment: SettingsEnvironment): TunnelOrigins => {
  const listenHost = environment.env.listenHost ?? "127.0.0.1";
  return {
    ui: `http://${upstream(listenHost, environment.port)}`,
    // The bucket entry listens beside the UI, as `storageEntry` puts it.
    storage: `http://${upstream(listenHost, environment.publicStoragePort)}`,
  };
};

/** Whether the URL leads straight to the UI's own listener, with no proxy between. */
const direct = (url: URL, listenHost: string, port: number) => {
  if (url.protocol !== "http:" || portOf(url) !== port) {
    return false;
  }
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  return (
    WILDCARDS.has(listenHost) ||
    host === listenHost ||
    (host === "localhost" && LOOPBACK.test(listenHost))
  );
};

const caddy = (url: URL, to: string) => `${url.origin} {
	reverse_proxy ${to} {
		# A reload closes open WebSockets, evertap connect's too, unless given time to end
		stream_close_delay 5m
	}
}
`;

const nginx = (url: URL, to: string) => {
  const https = url.protocol === "https:";
  const certificate = https
    ? `
    # Where certbot keeps the certificate; change both paths if it comes from elsewhere
    ssl_certificate     /etc/letsencrypt/live/${url.hostname}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${url.hostname}/privkey.pem;
`
    : "";
  return `# In nginx's http block, such as in /etc/nginx/conf.d/evertap.conf
map $http_upgrade $evertap_connection {
    default upgrade;
    ""      close;
}

server {
    listen ${portOf(url)}${https ? " ssl" : ""};
    server_name ${url.hostname};
${certificate}
    # The UI uploads files in parts of up to ${OBJECT_PART_SIZE / 1024 / 1024} MiB
    client_max_body_size ${RPC_BODY_MAX / 1024 / 1024}m;

    location / {
        # No path after the address, so each request's path passes as it came
        proxy_pass http://${to};
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $evertap_connection;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Creating the first database of a version waits for its download
        proxy_read_timeout 5m;
    }
}
`;
};

const caddyBuckets = (url: URL, to: string) => `${url.origin} {
	reverse_proxy ${to}
}
`;

const nginxBuckets = (url: URL, to: string) => {
  const https = url.protocol === "https:";
  const certificate = https
    ? `
    # Where certbot keeps the certificate; change both paths if it comes from elsewhere
    ssl_certificate     /etc/letsencrypt/live/${url.hostname}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${url.hostname}/privkey.pem;
`
    : "";
  return `# Buckets reached from anywhere, at an address of their own
server {
    listen ${portOf(url)}${https ? " ssl" : ""};
    server_name ${url.hostname};
${certificate}
    # An object goes up in one request of up to 5 GiB, passed on as it arrives
    client_max_body_size 0;
    proxy_request_buffering off;

    location / {
        # Signatures cover the path and the Host, so both pass as they came
        proxy_pass http://${to};
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        # A large copy can take a while before its answer
        proxy_read_timeout 5m;
    }
}
`;
};

/**
 * The way in for buckets reached from anywhere, and what to paste into a reverse proxy for it, at
 * the address in force or an example.
 */
export const bucketsGuide = (
  settings: Settings,
  environment: SettingsEnvironment,
): NetworkGuide["buckets"] => {
  const mode = settings.mode.value;
  if (mode !== "network" && mode !== "cloudflare") {
    return null;
  }
  const to = upstream(settings.listenHost.value, environment.publicStoragePort);
  if (mode === "cloudflare") {
    return { upstream: to, proxy: null };
  }
  const url = new URL(settings.storageUrl.value ?? STORAGE_URL_EXAMPLE);
  return { upstream: to, proxy: { caddy: caddyBuckets(url, to), nginx: nginxBuckets(url, to) } };
};

/** What to paste into a reverse proxy in front of evertap, for the settings in force. */
export const proxyConfigs = (settings: Settings, port: number): NetworkGuide["proxy"] => {
  const url = settings.publicUrl.value;
  if (settings.mode.value !== "network" || url === null) {
    return null;
  }
  const parsed = new URL(url);
  const listenHost = settings.listenHost.value;
  if (direct(parsed, listenHost, port)) {
    return null;
  }
  const to = upstream(listenHost, port);
  return { upstream: to, caddy: caddy(parsed, to), nginx: nginx(parsed, to) };
};

const UNANSWERED: Record<Extract<Probe, { answered: false }>["failure"], (url: URL) => string> = {
  name: (url) =>
    `${url.hostname} does not resolve from this machine. Add a DNS record pointing it at your proxy, then check again`,
  refused: (url) => `Nothing answers at ${url.origin}. Start your proxy, or check the address`,
  certificate: (url) =>
    `${url.origin} has no valid certificate. Have your proxy get one for ${url.hostname}`,
  timeout: (url) =>
    `${url.origin} did not answer in time. Check your proxy and firewall, then try it from another device`,
  other: (url) =>
    `${url.origin} could not be reached. Check your proxy, then try it from another device`,
};

/** What a probe of `url`, the URL in force, says to do. */
export const explainProbe = (
  settings: Settings,
  environment: SettingsEnvironment,
  url: string,
  probe: Probe,
): Reach => {
  const parsed = new URL(url);
  const listenHost = settings.listenHost.value;
  const to = upstream(listenHost, environment.port);
  // Cloudflare takes a few minutes to serve a name new to the tunnel, and fails it until then.
  if (settings.tunnel !== null && (!probe.answered || probe.arrival === null)) {
    return {
      url,
      result: probe.answered ? "elsewhere" : "unreachable",
      problems: [
        `Wait a few minutes for Cloudflare to start serving ${parsed.host}, then check again. If it still fails, run evertap doctor`,
      ],
    };
  }
  if (!probe.answered) {
    return { url, result: "unreachable", problems: [UNANSWERED[probe.failure](parsed)] };
  }
  const { arrival } = probe;
  if (arrival === null) {
    // What a proxy answers when nothing answers where it points.
    const stranded = probe.status >= 502 && probe.status <= 504;
    return {
      url,
      result: "elsewhere",
      problems: [
        stranded
          ? `Your proxy at ${url} cannot reach evertap. Point it at ${to}`
          : `${url} reaches something other than this evertap. Point your proxy at ${to}`,
      ],
    };
  }
  const problems: string[] = [];
  if (!allowsHost(settings, environment, arrival.host)) {
    problems.push(
      `Have your proxy pass the Host header on as it came, ${parsed.host}, not ${arrival.host ?? "none"}`,
    );
  }
  if (!direct(parsed, listenHost, environment.port)) {
    if (arrival.forwardedFor === null) {
      problems.push(
        "Have your proxy add X-Forwarded-For. Without it evertap sees every caller as one, and one of them can hold up everyone's sign-in",
      );
    }
    if (parsed.protocol === "https:" && arrival.forwardedProto !== "https") {
      problems.push(
        "Have your proxy send X-Forwarded-Proto: https, so sign-in cookies travel over HTTPS only",
      );
    }
  }
  if (!probe.upgrades) {
    problems.push(
      "Have your proxy pass WebSocket upgrades on, with the Upgrade and Connection headers. evertap connect needs them",
    );
  }
  return { url, result: "reached", problems };
};
