import { DataError } from "@evertap/api/context";
import { describe, expect, it, vi } from "vitest";

import { createAccess, listenFailure } from "./access.ts";
import { config } from "./config.ts";

const PROXIED = {
  mode: "network",
  publicUrl: null,
  listenHost: "127.0.0.1",
  storageUrl: null,
} as const;

const failing = (code: string) => Object.assign(new Error("Failed to listen"), { code });

type AccessOptions = Parameters<typeof createAccess>[0];

/** No environment variables, whatever the shell running the tests has set. */
const accessFor = (
  saved: AccessOptions["saved"],
  { keep = () => {}, variables = {} }: Partial<Omit<AccessOptions, "saved">> = {},
) => createAccess({ saved, keep, variables });

describe("createAccess", () => {
  it("puts each entry on 127.0.0.1 for the relay, or on ev.internal's standard ports in local mode", () => {
    const access = accessFor(PROXIED);
    expect(access.entry("postgresql")).toEqual({
      hostname: "127.0.0.1",
      port: config.postgresPort,
    });
    expect(access.portVariable("postgresql")).toBe("EVERTAP_POSTGRES_PORT");

    access.save({ mode: "local" });
    expect(access.entry("postgresql")).toEqual({ hostname: "127.77.0.1", port: 5432 });
    // Where bucket endpoints point, whatever EVERTAP_GARAGE_PORT says.
    expect(access.entry("garage")).toEqual({ hostname: "127.77.0.1", port: 3900 });
    expect(access.portVariable("postgresql")).toBeNull();
    expect(access.portVariable("garage")).toBeNull();
    expect(access.ui()).toEqual({ hostname: "127.77.0.1", port: config.port });
  });

  it("moves every listener, then keeps the settings", () => {
    const keep = vi.fn();
    const access = accessFor(null, { keep });
    const seen: string[] = [];
    access.follow(() => seen.push(`ui ${access.ui().hostname}`));
    access.follow(() => seen.push(`entry ${access.entry("redis").hostname}`));

    access.save({ mode: "local" });
    expect(seen).toEqual(["ui 127.77.0.1", "entry 127.77.0.1"]);
    expect(keep).toHaveBeenCalledWith({ mode: "local" });
  });

  it("moves every listener back and keeps nothing when one cannot move", () => {
    const keep = vi.fn();
    const access = accessFor(PROXIED, { keep });
    const seen: string[] = [];
    access.follow(() => seen.push(`ui ${access.ui().hostname}`));
    access.follow(() => {
      if (access.current().mode.value === "local") {
        throw new DataError("redis: 127.77.0.1:6379 is taken");
      }
      seen.push(`entry ${access.entry("redis").hostname}`);
    });

    expect(() => {
      access.save({ mode: "local" });
    }).toThrow("127.77.0.1:6379 is taken");
    expect(seen).toEqual(["ui 127.77.0.1", "ui 127.0.0.1", "entry 127.0.0.1"]);
    expect(access.current().mode.value).toBe("network");
    expect(keep).not.toHaveBeenCalled();
  });

  it("refuses to start on a variable it cannot use, naming it", () => {
    expect(() => accessFor(null, { variables: { mode: "lan" } })).toThrow(
      "Unset EVERTAP_MODE, or set it to network, cloudflare, or local",
    );
    expect(() => accessFor(null, { variables: { publicUrl: "evertap.example.com" } })).toThrow(
      "EVERTAP_PUBLIC_URL:",
    );
    expect(() => accessFor(null, { variables: { listenHost: "localhost" } })).toThrow(
      "EVERTAP_LISTEN_HOST",
    );
    // A tunnel of the person's own is network mode behind their own proxy.
    expect(() =>
      accessFor(null, {
        variables: { mode: "cloudflare", publicUrl: "https://evertap.example.com" },
      }),
    ).toThrow(
      "Unset EVERTAP_PUBLIC_URL: the tunnel evertap runs has its own address. For a tunnel you run yourself, set EVERTAP_MODE to network and EVERTAP_LISTEN_HOST to 127.0.0.1",
    );
  });

  it("lets the variables win over what was saved", () => {
    const access = accessFor(PROXIED, { variables: { publicUrl: "https://evertap.example.com/" } });
    expect(access.current().publicUrl).toEqual({
      value: "https://evertap.example.com",
      source: "env",
    });
  });
});

describe("listenFailure", () => {
  const address = { hostname: "127.0.0.1", port: 3306 };

  it("says what holds the address and how to move off it", () => {
    expect(listenFailure(failing("EADDRINUSE"), address, "EVERTAP_MYSQL_PORT")).toEqual(
      new DataError(
        "127.0.0.1:3306 is taken by another program. Stop that program, or set EVERTAP_MYSQL_PORT to a free one. To see what it is: sudo lsof -nP -iTCP:3306 -sTCP:LISTEN",
      ),
    );
    expect(
      listenFailure(failing("EADDRINUSE"), { hostname: "127.77.0.1", port: 3306 }, null),
    ).toEqual(
      new DataError(
        '127.77.0.1:3306 is taken by another program. Stop that program, or have it listen on 127.0.0.1 only (in Compose: "127.0.0.1:3306:3306"). To see what it is: sudo lsof -nP -iTCP:3306 -sTCP:LISTEN',
      ),
    );
    expect(
      listenFailure(failing("EADDRNOTAVAIL"), { hostname: "192.0.2.1", port: 8080 }, null),
    ).toEqual(
      new DataError("192.0.2.1 is not an address of this machine. Choose one of its addresses"),
    );
  });

  it("passes any other error on as it is", () => {
    const other = failing("EACCES");
    expect(listenFailure(other, address, null)).toBe(other);
  });
});
