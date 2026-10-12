import { describe, expect, it } from "vitest";

import { type Listener, checkedName, conflictsWith, dockerWarnings } from "./doctor.ts";
import type { DockerInfo, Published } from "./live/docker.ts";

const system: DockerInfo = {
  ServerVersion: "28.5.1",
  DockerRootDir: "/var/lib/docker",
  OperatingSystem: "Ubuntu 24.04.3 LTS",
  SecurityOptions: ["name=apparmor", "name=seccomp,profile=builtin", "name=cgroupns"],
  FirewallBackend: { Driver: "iptables" },
};

const home: Parameters<typeof dockerWarnings>[1] = {
  dataDir: "/home/me/.local/share/evertap",
  home: "/home/me",
  lingering: () => false,
  platform: "linux",
};

const unasked = () => {
  throw new Error("asked about lingering");
};

const kinds = (info: DockerInfo, place = home) =>
  dockerWarnings(info, place).map((warning) => warning.kind);

describe("dockerWarnings", () => {
  it("has nothing to say about a current system install", () => {
    expect(kinds(system)).toEqual([]);
  });

  it("asks to update a Docker older than 28, which lets the network past 127.0.0.1", () => {
    const [warning] = dockerWarnings({ ...system, ServerVersion: "27.3.1" }, home);
    expect(warning?.message).toMatch(/Update Docker to 28 or later$/);
    expect(kinds({ ...system, ServerVersion: "24.0.7", FirewallBackend: null })).toEqual([
      "outdated",
    ]);
  });

  it("asks for 28.3.3 where firewalld reopens it in 28.2", () => {
    const firewalld = { ...system, FirewallBackend: { Driver: "iptables+firewalld" } };
    expect(kinds({ ...firewalld, ServerVersion: "28.1.1" })).toEqual([]);
    const [warning] = dockerWarnings({ ...firewalld, ServerVersion: "28.3.2" }, home);
    expect(warning?.message).toMatch(/Update Docker to 28\.3\.3 or later$/);
    expect(kinds({ ...firewalld, ServerVersion: "28.3.3" })).toEqual([]);
  });

  it("leaves old rootless Docker and Docker Desktop alone, which keep 127.0.0.1 local", () => {
    expect(
      kinds(
        { ...system, ServerVersion: "27.3.1", SecurityOptions: ["name=rootless"] },
        { ...home, lingering: () => true },
      ),
    ).toEqual([]);
    expect(
      kinds({ ...system, ServerVersion: "27.3.1", OperatingSystem: "Docker Desktop" }),
    ).toEqual([]);
  });

  it("leaves an old Docker on macOS alone, as OrbStack and Colima run it in a VM too", () => {
    const orbstack = { ...system, ServerVersion: "27.3.1", OperatingSystem: "OrbStack" };
    expect(kinds(orbstack, { ...home, platform: "darwin" })).toEqual([]);
  });

  it("warns Snap's Docker off hidden folders and folders outside the home", () => {
    const snap = { ...system, DockerRootDir: "/var/snap/docker/common/var-lib-docker" };
    expect(kinds(snap)).toEqual(["snap"]);
    expect(kinds(snap, { ...home, dataDir: "/srv/evertap" })).toEqual(["snap"]);
    expect(kinds(snap, { ...home, dataDir: "/home/me/evertap" })).toEqual([]);
    // Snap's Docker reports its own base system, whatever the root directory.
    expect(kinds({ ...system, OperatingSystem: "Ubuntu Core 24" })).toEqual(["snap"]);
  });

  it("warns rootless Docker that it stops at logout until lingering is on", () => {
    const rootless = {
      ...system,
      SecurityOptions: ["name=seccomp,profile=builtin", "name=rootless"],
    };
    expect(kinds(rootless)).toEqual(["rootless"]);
    // Looking up the user can throw, so it happens only for rootless Docker.
    expect(kinds(system, { ...home, lingering: unasked })).toEqual([]);
    expect(kinds(rootless, { ...home, lingering: () => true })).toEqual([]);
  });
});

const compose = (name: string, running: boolean, hostIp: string, hostPort: number): Published => ({
  name,
  running,
  bindings: [{ hostIp, hostPort }],
});

const lan = (hostname: string): Listener[] => [
  { address: { hostname, port: 8080 }, portVariable: "EVERTAP_PORT" },
];

describe("conflictsWith", () => {
  const local: Listener[] = [
    { address: { hostname: "127.77.0.1", port: 5432 }, portVariable: null },
    { address: { hostname: "127.77.0.1", port: 9000 }, portVariable: null },
  ];

  it("names a running container that holds the port on every address, and how to share it", () => {
    const [conflict, ...rest] = conflictsWith(
      [
        {
          name: "shop-db-1",
          running: true,
          bindings: [
            { hostIp: "0.0.0.0", hostPort: 5432 },
            { hostIp: "::", hostPort: 5432 },
          ],
        },
      ],
      local,
    );
    expect(rest).toEqual([]);
    expect(conflict).toEqual({
      name: "shop-db-1",
      address: "127.77.0.1:5432",
      running: true,
      message:
        'Holds 5432 on every address, so evertap can\'t listen at 127.77.0.1:5432. Publish it on 127.0.0.1 only, as "127.0.0.1:5432:5432" in Compose',
    });
  });

  it("warns of a stopped one that will fail to start while evertap runs", () => {
    expect(conflictsWith([compose("site-minio-1", false, "0.0.0.0", 9000)], local)).toEqual([
      {
        name: "site-minio-1",
        address: "127.77.0.1:9000",
        running: false,
        message:
          'Can\'t start while evertap listens at 127.77.0.1:9000, as it asks for 9000 on every address. Publish it on 127.0.0.1 only, as "127.0.0.1:9000:9000" in Compose',
      },
    ]);
  });

  it("leaves alone what shares the port on another address, or listens on IPv6 alone", () => {
    expect(
      conflictsWith(
        [
          compose("on-loopback", true, "127.0.0.1", 5432),
          compose("v6-only", false, "::", 9000),
          compose("other-port", true, "0.0.0.0", 5433),
        ],
        local,
      ),
    ).toEqual([]);
  });

  it("points at the variable that moves an entry on 127.0.0.1, where sharing it is not an option", () => {
    const [conflict] = conflictsWith(
      [compose("shop-db-1", false, "127.0.0.1", 3306)],
      [{ address: { hostname: "127.0.0.1", port: 3306 }, portVariable: "EVERTAP_MYSQL_PORT" }],
    );
    expect(conflict?.message).toBe(
      "Can't start while evertap listens at 127.0.0.1:3306, as it asks for 3306 on 127.0.0.1. Change it in its Compose file, or set EVERTAP_MYSQL_PORT to a free one",
    );
  });

  it("counts every address a UI on all of them takes", () => {
    const web = compose("web-1", false, "192.168.1.20", 8080);
    expect(conflictsWith([web], lan("0.0.0.0"))).toHaveLength(1);
    expect(conflictsWith([web], lan("::"))).toHaveLength(1);
    expect(conflictsWith([compose("web-1", false, "::", 8080)], lan("0.0.0.0"))).toEqual([]);
  });
});

describe("checkedName", () => {
  const unset = { host: "evertap.local", chosen: false };

  it("checks ev.internal in local mode", () => {
    expect(checkedName("local", unset, "http://ev.internal:8080")).toBe("ev.internal");
  });

  it("leaves the default LAN name alone where nothing opens evertap at it, as nothing announces it", () => {
    expect(checkedName(null, unset, "http://127.0.0.1:8080")).toBeNull();
    expect(checkedName("network", unset, "http://192.168.1.20:8080")).toBeNull();
    expect(checkedName("cloudflare", unset, null)).toBeNull();
    expect(checkedName("cloudflare", unset, "https://evertap.example.com")).toBeNull();
  });

  it("checks the LAN name once it is set or evertap is opened at it", () => {
    const chosen = { host: "nas.lan", chosen: true };
    expect(checkedName("network", chosen, "http://192.168.1.20:8080")).toBe("nas.lan");
    expect(checkedName("network", unset, "http://Evertap.local:8080")).toBe("evertap.local");
  });
});
