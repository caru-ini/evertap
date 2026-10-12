import type { NetworkInterfaceInfo } from "node:os";

import { describe, expect, it } from "vitest";

import { clientAddress, fromProxy } from "./address.ts";
import { ISOLATED_BRIDGE } from "./live/docker.ts";

// What a caller sent, then what the proxy appended.
const forwarded = new Headers({ "x-forwarded-for": "198.51.100.7, 203.0.113.9" });

const ipv4 = (cidr: string): NetworkInterfaceInfo => {
  const [address = ""] = cidr.split("/");
  return { address, cidr, family: "IPv4", netmask: "", mac: "", internal: false };
};

/** A LAN, Docker's default bridge, a network Compose made, and evertap's isolated network. */
const interfaces = () => ({
  eth0: [ipv4("192.168.1.10/24")],
  docker0: [ipv4("172.17.0.1/16")],
  "br-0123456789ab": [ipv4("172.18.0.1/16")],
  "ev-0123456789ab": [ipv4("172.20.0.1/16")],
  veth1a2b3c4: [],
});

const onThisMachine = (peer: string) => fromProxy(peer, interfaces);

describe("clientAddress", () => {
  it("takes the address a proxy or tunnel on loopback appended last", () => {
    for (const mode of ["network", "cloudflare"] as const) {
      expect(clientAddress("127.0.0.1", forwarded, mode)).toBe("203.0.113.9");
      expect(clientAddress("::ffff:127.0.0.1", forwarded, mode)).toBe("203.0.113.9");
      expect(clientAddress("::1", forwarded, mode)).toBe("203.0.113.9");
    }
  });

  it("takes it from a proxy in a Docker container, on any of Docker's bridges", () => {
    expect(clientAddress("172.17.0.4", forwarded, "network", onThisMachine)).toBe("203.0.113.9");
    expect(clientAddress("::ffff:172.18.3.2", forwarded, "network", onThisMachine)).toBe(
      "203.0.113.9",
    );
  });

  it("ignores the header from anywhere else, where it could be forged", () => {
    expect(clientAddress("192.168.1.20", forwarded, "network", onThisMachine)).toBe("192.168.1.20");
    expect(clientAddress("172.19.0.2", forwarded, "network", onThisMachine)).toBe("172.19.0.2");
    expect(clientAddress("127.0.0.1", new Headers(), "network")).toBe("127.0.0.1");
    expect(clientAddress(undefined, forwarded, "network")).toBeNull();
  });

  it("ignores it from evertap's isolated network, where a database's user can run programs", () => {
    expect(ISOLATED_BRIDGE.test("ev-0123456789ab")).toBe(true);
    for (const mode of ["network", "cloudflare"] as const) {
      expect(clientAddress("172.20.0.2", forwarded, mode, onThisMachine)).toBe("172.20.0.2");
      expect(clientAddress("::ffff:172.20.0.2", forwarded, mode, onThisMachine)).toBe(
        "::ffff:172.20.0.2",
      );
    }
  });

  it("ignores it in local mode and before a mode is chosen, which have no proxy", () => {
    expect(clientAddress("127.0.0.1", forwarded, "local")).toBe("127.0.0.1");
    expect(clientAddress("127.0.0.1", forwarded, null)).toBe("127.0.0.1");
  });

  it("skips Cloudflare's own header, which another proxy on this machine passes on as sent", () => {
    const cloudflare = new Headers({ "cf-connecting-ip": "198.51.100.7" });
    expect(clientAddress("127.0.0.1", cloudflare, "cloudflare")).toBe("127.0.0.1");
  });

  it("keeps the socket's address when the last entry is not one", () => {
    const garbled = new Headers({ "x-forwarded-for": "203.0.113.9, unknown" });
    expect(clientAddress("127.0.0.1", garbled, "network")).toBe("127.0.0.1");
  });
});
