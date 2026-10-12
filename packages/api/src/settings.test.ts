import { describe, expect, it } from "vitest";

import { offeredChoices } from "./rules.ts";
import {
  allowsHost,
  choiceOf,
  cutsOff,
  exposedAt,
  listenChoices,
  plannedTunnel,
  resolveSettings,
  type SettingsEnvironment,
  storageEntry,
} from "./settings.ts";

const ENVIRONMENT: SettingsEnvironment = {
  env: {},
  port: 8080,
  publicStoragePort: 9900,
  lanAddress: () => "192.168.1.10",
  lanName: "evertap.local",
  dockerAddress: () => null,
  publicAddresses: () => [],
};

const values = (settings: ReturnType<typeof resolveSettings>) => ({
  mode: settings.mode.value,
  publicUrl: settings.publicUrl.value,
  listenHost: settings.listenHost.value,
});

describe("resolveSettings", () => {
  it("listens on 127.0.0.1 alone until a mode is chosen", () => {
    expect(values(resolveSettings(null, ENVIRONMENT))).toEqual({
      mode: null,
      publicUrl: "http://127.0.0.1:8080",
      listenHost: "127.0.0.1",
    });
  });

  it("gives each mode its own defaults", () => {
    expect(values(resolveSettings({ mode: "local" }, ENVIRONMENT))).toEqual({
      mode: "local",
      publicUrl: "http://ev.internal:8080",
      listenHost: "127.77.0.1",
    });
    const tunnel = plannedTunnel({ ui: "evertap.example.com", storage: "s3.example.com" }, null);
    expect(values(resolveSettings(tunnel, ENVIRONMENT))).toEqual({
      mode: "cloudflare",
      publicUrl: "https://evertap.example.com",
      listenHost: "127.0.0.1",
    });
    // On every interface the URL takes the LAN address, in brackets when it is IPv6.
    const lan = {
      mode: "network",
      publicUrl: null,
      listenHost: "0.0.0.0",
      storageUrl: null,
    } as const;
    expect(resolveSettings(lan, ENVIRONMENT).publicUrl.value).toBe("http://192.168.1.10:8080");
    expect(
      resolveSettings(lan, { ...ENVIRONMENT, lanAddress: () => "fd00::10" }).publicUrl.value,
    ).toBe("http://[fd00::10]:8080");
    expect(
      resolveSettings(lan, { ...ENVIRONMENT, lanAddress: () => null }).publicUrl.value,
    ).toBeNull();
  });

  it("looks the LAN address up only for a URL on every interface", () => {
    let lookups = 0;
    const counting = {
      ...ENVIRONMENT,
      lanAddress: () => {
        lookups += 1;
        return "192.168.1.10";
      },
    };
    resolveSettings(null, counting);
    resolveSettings({ mode: "local" }, counting);
    resolveSettings(
      { mode: "network", publicUrl: null, listenHost: "127.0.0.1", storageUrl: null },
      counting,
    );
    resolveSettings(
      {
        mode: "network",
        publicUrl: "https://evertap.example.com",
        listenHost: "0.0.0.0",
        storageUrl: null,
      },
      counting,
    );
    expect(lookups).toBe(0);
    resolveSettings(
      { mode: "network", publicUrl: null, listenHost: "0.0.0.0", storageUrl: null },
      counting,
    );
    expect(lookups).toBe(1);
  });

  it("ignores what was saved for another mode than the variable sets", () => {
    const saved = {
      mode: "network",
      publicUrl: "https://a.example.com",
      listenHost: "0.0.0.0",
      storageUrl: "https://s3.a.example.com",
    } as const;
    expect(resolveSettings(saved, { ...ENVIRONMENT, env: { mode: "local" } })).toEqual({
      mode: { value: "local", source: "env" },
      publicUrl: { value: "http://ev.internal:8080", source: "default" },
      listenHost: { value: "127.77.0.1", source: "default" },
      tunnel: null,
      storageUrl: { value: null, source: "default" },
    });
  });
});

describe("storageEntry", () => {
  const network = (listenHost: string, storageUrl: string | null) =>
    resolveSettings(
      { mode: "network", publicUrl: "https://evertap.example.com", listenHost, storageUrl },
      ENVIRONMENT,
    );

  it("listens beside the UI once buckets have an address, on loopback for every interface", () => {
    expect(storageEntry(network("127.0.0.1", "https://s3.example.com"), ENVIRONMENT)).toEqual({
      hostname: "127.0.0.1",
      port: 9900,
    });
    expect(storageEntry(network("172.17.0.1", "https://s3.example.com"), ENVIRONMENT)).toEqual({
      hostname: "172.17.0.1",
      port: 9900,
    });
    expect(storageEntry(network("0.0.0.0", "https://s3.example.com"), ENVIRONMENT)).toEqual({
      hostname: "127.0.0.1",
      port: 9900,
    });
    expect(storageEntry(network("127.0.0.1", null), ENVIRONMENT)).toBeNull();
  });

  it("does not listen while only this machine reaches evertap", () => {
    expect(storageEntry(resolveSettings({ mode: "local" }, ENVIRONMENT), ENVIRONMENT)).toBeNull();
    expect(storageEntry(resolveSettings(null, ENVIRONMENT), ENVIRONMENT)).toBeNull();
  });
});

describe("exposedAt", () => {
  const vps = { ...ENVIRONMENT, publicAddresses: () => ["2001:db8::5", "203.0.113.5"] };

  it("finds the public address each wildcard opens the UI on", () => {
    expect(exposedAt("0.0.0.0", vps)).toBe("203.0.113.5");
    // `::` takes IPv4 too.
    expect(exposedAt("::", vps)).toBe("2001:db8::5");
    expect(exposedAt("::", { ...vps, publicAddresses: () => ["203.0.113.5"] })).toBe("203.0.113.5");
    expect(exposedAt("0.0.0.0", { ...vps, publicAddresses: () => ["2001:db8::5"] })).toBeNull();
  });

  it("finds a public address the UI listens on itself, and none on others", () => {
    expect(exposedAt("203.0.113.5", vps)).toBe("203.0.113.5");
    expect(exposedAt("127.0.0.1", vps)).toBeNull();
    expect(exposedAt("192.168.1.10", vps)).toBeNull();
    expect(exposedAt("0.0.0.0", ENVIRONMENT)).toBeNull();
  });
});

describe("listenChoices", () => {
  it("offers the LAN, a proxy here, and Docker's bridge where Docker runs", () => {
    expect(listenChoices(ENVIRONMENT)).toEqual([
      { use: "lan", address: "0.0.0.0", defaultUrl: "http://192.168.1.10:8080", exposes: null },
      { use: "proxy", address: "127.0.0.1", defaultUrl: "http://127.0.0.1:8080", exposes: null },
    ]);
    const docker = listenChoices({
      ...ENVIRONMENT,
      dockerAddress: () => "172.17.0.1",
      publicAddresses: () => ["203.0.113.5"],
    });
    expect(docker.map(({ use, exposes }) => ({ use, exposes }))).toEqual([
      { use: "lan", exposes: "203.0.113.5" },
      { use: "proxy", exposes: null },
      { use: "docker", exposes: null },
    ]);
    expect(docker[2]?.address).toBe("172.17.0.1");
  });
});

describe("allowsHost", () => {
  const proxied = resolveSettings(
    {
      mode: "network",
      publicUrl: "https://evertap.example.com",
      listenHost: "127.0.0.1",
      storageUrl: null,
    },
    ENVIRONMENT,
  );

  it("takes the URL's own name, localhost, and any address", () => {
    for (const host of [
      "evertap.example.com",
      "EVERTAP.example.com:443",
      "localhost:8080",
      "127.0.0.1:8080",
      "192.168.1.10:8080",
      "[::1]:8080",
    ]) {
      expect(allowsHost(proxied, ENVIRONMENT, host), host).toBe(true);
    }
  });

  it("refuses any other name, as a page that rebinds its own name to this machine sends", () => {
    for (const host of [
      "attacker.example",
      "evertap.example.com.attacker.example",
      "evertap.example.com@attacker.example",
      "evertap.local.attacker.example",
      "",
      null,
    ]) {
      expect(allowsHost(proxied, ENVIRONMENT, host), String(host)).toBe(false);
    }
  });

  it("takes ev.internal in local mode alone", () => {
    const local = resolveSettings({ mode: "local" }, ENVIRONMENT);
    expect(allowsHost(local, ENVIRONMENT, "ev.internal:8080")).toBe(true);
    expect(allowsHost(proxied, ENVIRONMENT, "ev.internal:8080")).toBe(false);
  });

  it("takes the LAN name in network mode alone", () => {
    expect(allowsHost(proxied, ENVIRONMENT, "evertap.local:8080")).toBe(true);
    expect(allowsHost(proxied, ENVIRONMENT, "EVERTAP.LOCAL")).toBe(true);
    for (const saved of [
      null,
      { mode: "local" } as const,
      plannedTunnel({ ui: "evertap.example.com", storage: "s3.example.com" }, null),
    ]) {
      const settings = resolveSettings(saved, ENVIRONMENT);
      expect(allowsHost(settings, ENVIRONMENT, "evertap.local:8080"), String(saved?.mode)).toBe(
        false,
      );
    }
  });
});

describe("cutsOff", () => {
  const at = (listenHost: string) =>
    resolveSettings(
      { mode: "network", publicUrl: null, listenHost, storageUrl: null },
      ENVIRONMENT,
    );
  const cuts = (current: string, next: string, host: string) =>
    cutsOff(at(current), at(next), ENVIRONMENT, host);

  it("counts a narrower listen address as cutting off, even when it might not", () => {
    expect(cuts("127.0.0.1", "0.0.0.0", "127.0.0.1:8080")).toBe(false);
    expect(cuts("0.0.0.0", "::", "127.0.0.1:8080")).toBe(false);
    expect(cuts("0.0.0.0", "127.0.0.1", "127.0.0.1:8080")).toBe(true);
    expect(cuts("::", "0.0.0.0", "127.0.0.1:8080")).toBe(true);
  });

  it("knows every IPv4 interface takes no IPv6 connection", () => {
    expect(cuts("::1", "0.0.0.0", "[::1]:8080")).toBe(true);
    expect(cuts("fd00::10", "0.0.0.0", "[fd00::10]:8080")).toBe(true);
    expect(cuts("::1", "::", "[::1]:8080")).toBe(false);
  });
});

const DOCKER: SettingsEnvironment = { ...ENVIRONMENT, dockerAddress: () => "172.17.0.1" };

const choice = (saved: Parameters<typeof resolveSettings>[0], environment = DOCKER) =>
  choiceOf(resolveSettings(saved, environment), environment);

const listening = (listenHost: string) =>
  ({ mode: "network", publicUrl: null, listenHost, storageUrl: null }) as const;

describe("choices", () => {
  it("tells devices on the network from a proxy or tunnel by where the UI listens", () => {
    expect(choice(null)).toBeNull();
    expect(choice({ mode: "local" })).toBe("local");
    expect(
      choice(plannedTunnel({ ui: "evertap.example.com", storage: "s3.example.com" }, null)),
    ).toBe("cloudflare");
    // Every interface, or one address of this machine such as its Tailscale address.
    for (const listenHost of ["0.0.0.0", "::", "100.101.102.103"]) {
      expect(choice(listening(listenHost)), listenHost).toBe("network");
    }
    for (const listenHost of ["127.0.0.1", "::1", "172.17.0.1"]) {
      expect(choice(listening(listenHost)), listenHost).toBe("proxy");
    }
    // Without Docker's bridge, its usual address is just another one.
    expect(choice(listening("172.17.0.1"), ENVIRONMENT)).toBe("network");
  });

  it("offers what environment variables leave to choose", () => {
    const docker = "172.17.0.1";
    expect(offeredChoices({ mode: null, listenHost: null }, docker)).toEqual([
      "local",
      "network",
      "cloudflare",
      "proxy",
    ]);
    expect(offeredChoices({ mode: "network", listenHost: null }, docker)).toEqual([
      "network",
      "proxy",
    ]);
    expect(offeredChoices({ mode: "network", listenHost: docker }, docker)).toEqual(["proxy"]);
    expect(offeredChoices({ mode: null, listenHost: "0.0.0.0" }, docker)).toEqual([
      "local",
      "network",
      "cloudflare",
    ]);
    expect(offeredChoices({ mode: "cloudflare", listenHost: null }, docker)).toEqual([
      "cloudflare",
    ]);
  });
});
