import { BlockList, isIP } from "node:net";
import { networkInterfaces } from "node:os";

import type { AccessMode } from "@evertap/api/rules";

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;

/** Docker's bridges: docker0, and a `br-…` for each network `docker network create` or Compose makes. */
export const DOCKER_BRIDGE = /^(docker0|br-[0-9a-f]{12})$/;

/**
 * Whether `peer` can be a proxy in front of evertap: on loopback, or in a Docker container. Only a
 * container on this machine can hold a connection from a Docker bridge's network, as the answers
 * to any other sender go into that bridge. evertap's isolated network has a bridge of another name
 * (`ISOLATED_BRIDGE`), so its instances are not proxies.
 */
export const fromProxy = (peer: string, interfaces = networkInterfaces) => {
  if (LOOPBACK.test(peer)) {
    return true;
  }
  const bridges = new BlockList();
  for (const [name, addresses] of Object.entries(interfaces())) {
    for (const { family, cidr } of DOCKER_BRIDGE.test(name) ? (addresses ?? []) : []) {
      const [network, prefix] = cidr?.split("/") ?? [];
      if (family === "IPv4" && network && prefix) {
        bridges.addSubnet(network, Number(prefix), "ipv4");
      }
    }
  }
  return bridges.check(peer.replace(/^::ffff:/, ""), "ipv4");
};

/**
 * The caller's address. Behind a reverse proxy or Cloudflare Tunnel, every connection comes from
 * the proxy, which appends the address it saw to `X-Forwarded-For`: the last entry is the one a
 * caller cannot forge. From anywhere else, and in local mode, which has no proxy, the header could
 * be forged, so the socket's own address counts.
 */
export const clientAddress = (
  peer: string | null | undefined,
  headers: Headers,
  mode: AccessMode | null,
  isProxy = fromProxy,
) => {
  if (!peer || (mode !== "network" && mode !== "cloudflare")) {
    return peer ?? null;
  }
  const last = headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  // The header first: most callers send none, and checking the bridges reads the interfaces.
  return last && isIP(last) !== 0 && isProxy(peer) ? last : peer;
};
