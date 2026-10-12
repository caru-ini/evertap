import { describe, expect, it } from "vitest";

import type { Probe } from "./context.ts";
import { bucketsGuide, explainProbe, proxyConfigs } from "./proxy.ts";
import type { SavedSettings } from "./schemas.ts";
import { plannedTunnel, resolveSettings, type SettingsEnvironment } from "./settings.ts";

const ENVIRONMENT: SettingsEnvironment = {
  env: {},
  port: 8080,
  publicStoragePort: 9900,
  lanAddress: () => "192.168.1.10",
  lanName: "evertap.local",
  dockerAddress: () => "172.17.0.1",
  publicAddresses: () => [],
};

const network = (
  publicUrl: string | null,
  listenHost = "127.0.0.1",
  storageUrl: string | null = null,
) => resolveSettings({ mode: "network", publicUrl, listenHost, storageUrl }, ENVIRONMENT);

const configs = (publicUrl: string | null, listenHost?: string) =>
  proxyConfigs(network(publicUrl, listenHost), ENVIRONMENT.port);

describe("proxyConfigs", () => {
  it("writes an nginx server that passes WebSockets, the Host, the caller, and whole uploads", () => {
    expect(configs("https://evertap.example.com")?.nginx)
      .toBe(`# In nginx's http block, such as in /etc/nginx/conf.d/evertap.conf
map $http_upgrade $evertap_connection {
    default upgrade;
    ""      close;
}

server {
    listen 443 ssl;
    server_name evertap.example.com;

    # Where certbot keeps the certificate; change both paths if it comes from elsewhere
    ssl_certificate     /etc/letsencrypt/live/evertap.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/evertap.example.com/privkey.pem;

    # The UI uploads files in parts of up to 16 MiB
    client_max_body_size 17m;

    location / {
        # No path after the address, so each request's path passes as it came
        proxy_pass http://127.0.0.1:8080;
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
`);
  });

  it("writes a Caddy site that keeps WebSockets open through a reload", () => {
    expect(configs("https://evertap.example.com")?.caddy).toBe(`https://evertap.example.com {
	reverse_proxy 127.0.0.1:8080 {
		# A reload closes open WebSockets, evertap connect's too, unless given time to end
		stream_close_delay 5m
	}
}
`);
  });

  it("listens where the URL says, over plain HTTP without a certificate", () => {
    const lan = configs("http://evertap.lan:8081");
    expect(lan?.nginx).toContain("    listen 8081;\n    server_name evertap.lan;\n\n");
    expect(lan?.nginx).not.toContain("ssl");
    expect(lan?.caddy).toMatch(/^http:\/\/evertap\.lan:8081 \{/);
    expect(configs("https://evertap.example.com:8443")?.nginx).toContain("listen 8443 ssl;");
  });

  it("points the proxy where the UI listens: loopback for every interface, else the address", () => {
    expect(configs("https://evertap.example.com", "0.0.0.0")?.upstream).toBe("127.0.0.1:8080");
    // A proxy in a container reaches the host on Docker's bridge.
    const docker = configs("https://evertap.example.com", "172.17.0.1");
    expect(docker?.upstream).toBe("172.17.0.1:8080");
    expect(docker?.nginx).toContain("proxy_pass http://172.17.0.1:8080;");
    expect(docker?.caddy).toContain("reverse_proxy 172.17.0.1:8080 {");
    expect(configs("https://evertap.example.com", "fd00::10")?.upstream).toBe("[fd00::10]:8080");
  });

  it("writes none where browsers reach the UI itself, with no proxy between", () => {
    // The LAN's default, the listener's own address, and localhost to a loopback listener.
    expect(configs(null, "0.0.0.0")).toBeNull();
    expect(configs("http://evertap.local:8080", "0.0.0.0")).toBeNull();
    expect(configs("http://192.168.1.10:8080", "192.168.1.10")).toBeNull();
    expect(configs("http://localhost:8080")).toBeNull();
    // Another address on the same number is a proxy's own.
    expect(configs("http://192.168.1.10:8080")).not.toBeNull();
  });

  it("writes none outside network mode", () => {
    for (const saved of [
      null,
      { mode: "local" },
      plannedTunnel({ ui: "evertap.example.com", storage: "s3.example.com" }, null),
    ] satisfies (SavedSettings | null)[]) {
      expect(proxyConfigs(resolveSettings(saved, ENVIRONMENT), 8080)).toBeNull();
    }
  });
});

describe("bucketsGuide", () => {
  it("writes an nginx server that keeps the path and Host and streams whole objects", () => {
    expect(bucketsGuide(network(null, "127.0.0.1", "https://s3.example.com"), ENVIRONMENT)).toEqual(
      {
        upstream: "127.0.0.1:9900",
        proxy: {
          caddy: `https://s3.example.com {
	reverse_proxy 127.0.0.1:9900
}
`,
          nginx: `# Buckets reached from anywhere, at an address of their own
server {
    listen 443 ssl;
    server_name s3.example.com;

    # Where certbot keeps the certificate; change both paths if it comes from elsewhere
    ssl_certificate     /etc/letsencrypt/live/s3.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/s3.example.com/privkey.pem;

    # An object goes up in one request of up to 5 GiB, passed on as it arrives
    client_max_body_size 0;
    proxy_request_buffering off;

    location / {
        # Signatures cover the path and the Host, so both pass as they came
        proxy_pass http://127.0.0.1:9900;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        # A large copy can take a while before its answer
        proxy_read_timeout 5m;
    }
}
`,
        },
      },
    );
  });

  it("listens beside the UI, on loopback while the UI takes every interface", () => {
    const at = (listenHost: string) =>
      bucketsGuide(network(null, listenHost, "http://s3.lan:8081"), ENVIRONMENT);
    expect(at("0.0.0.0")?.upstream).toBe("127.0.0.1:9900");
    expect(at("172.17.0.1")?.upstream).toBe("172.17.0.1:9900");
    expect(at("::1")?.upstream).toBe("[::1]:9900");
    expect(at("0.0.0.0")?.proxy?.nginx).toContain("listen 8081;\n    server_name s3.lan;\n\n");
  });

  it("gives an example address until one is given, and no proxy for a tunnel", () => {
    expect(bucketsGuide(network(null), ENVIRONMENT)?.proxy?.caddy).toContain(
      "https://s3.example.com {",
    );
    const tunnel = resolveSettings(
      plannedTunnel({ ui: "evertap.example.com", storage: "s3.example.com" }, null),
      ENVIRONMENT,
    );
    expect(bucketsGuide(tunnel, ENVIRONMENT)).toEqual({ upstream: "127.0.0.1:9900", proxy: null });
    expect(bucketsGuide(resolveSettings({ mode: "local" }, ENVIRONMENT), ENVIRONMENT)).toBeNull();
    expect(bucketsGuide(resolveSettings(null, ENVIRONMENT), ENVIRONMENT)).toBeNull();
  });
});

describe("explainProbe", () => {
  const PUBLIC_URL = "https://evertap.example.com";
  const proxied = network(PUBLIC_URL);
  const explain = (probe: Probe, settings = proxied, url = PUBLIC_URL) =>
    explainProbe(settings, ENVIRONMENT, url, probe);
  const through = {
    host: "evertap.example.com",
    forwardedFor: "203.0.113.7",
    forwardedProto: "https",
  };

  it("finds nothing to fix when the proxy passes on all evertap needs", () => {
    expect(explain({ answered: true, status: 200, arrival: through, upgrades: true })).toEqual({
      url: PUBLIC_URL,
      result: "reached",
      problems: [],
    });
  });

  it("names each header the proxy drops or changes", () => {
    const { result, problems } = explain({
      answered: true,
      status: 403,
      arrival: { host: "internal.example", forwardedFor: null, forwardedProto: "http" },
      upgrades: false,
    });
    expect(result).toBe("reached");
    expect(problems).toEqual([
      "Have your proxy pass the Host header on as it came, evertap.example.com, not internal.example",
      "Have your proxy add X-Forwarded-For. Without it evertap sees every caller as one, and one of them can hold up everyone's sign-in",
      "Have your proxy send X-Forwarded-Proto: https, so sign-in cookies travel over HTTPS only",
      "Have your proxy pass WebSocket upgrades on, with the Upgrade and Connection headers. evertap connect needs them",
    ]);
  });

  it("expects no forwarded headers where browsers reach the UI itself", () => {
    const lan = network(null, "0.0.0.0");
    const direct = { host: "192.168.1.10:8080", forwardedFor: null, forwardedProto: null };
    expect(
      explain(
        { answered: true, status: 200, arrival: direct, upgrades: true },
        lan,
        "http://192.168.1.10:8080",
      ).problems,
    ).toEqual([]);
  });

  it("tells another evertap or site from a proxy that cannot reach this one", () => {
    expect(explain({ answered: true, status: 200, arrival: null, upgrades: false })).toEqual({
      url: PUBLIC_URL,
      result: "elsewhere",
      problems: [
        "https://evertap.example.com reaches something other than this evertap. Point your proxy at 127.0.0.1:8080",
      ],
    });
    expect(
      explain({ answered: true, status: 502, arrival: null, upgrades: false }).problems,
    ).toEqual([
      "Your proxy at https://evertap.example.com cannot reach evertap. Point it at 127.0.0.1:8080",
    ]);
  });

  it("waits for Cloudflare to serve the name of the tunnel evertap runs", () => {
    const tunnel = resolveSettings(
      plannedTunnel({ ui: "evertap.example.com", storage: "s3.example.com" }, null),
      ENVIRONMENT,
    );
    const wait =
      "Wait a few minutes for Cloudflare to start serving evertap.example.com, then check again. If it still fails, run evertap doctor";
    expect(explain({ answered: false, failure: "certificate" }, tunnel)).toEqual({
      url: PUBLIC_URL,
      result: "unreachable",
      problems: [wait],
    });
    expect(
      explain({ answered: true, status: 404, arrival: null, upgrades: false }, tunnel),
    ).toEqual({ url: PUBLIC_URL, result: "elsewhere", problems: [wait] });
  });

  it("says what to do when nothing answers", () => {
    const failures = ["name", "refused", "certificate", "timeout", "other"] as const;
    const explained = failures.map(
      (failure) => explain({ answered: false, failure }).problems[0] ?? "",
    );
    expect(explained[0]).toBe(
      "evertap.example.com does not resolve from this machine. Add a DNS record pointing it at your proxy, then check again",
    );
    expect(explained[1]).toBe(
      "Nothing answers at https://evertap.example.com. Start your proxy, or check the address",
    );
    expect(new Set(explained).size).toBe(failures.length);
    expect(explain({ answered: false, failure: "timeout" }).result).toBe("unreachable");
  });
});
