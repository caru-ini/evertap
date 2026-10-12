import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  type LoopbackState,
  type RootChanges,
  addAliasCommand,
  hostsAddress,
  hostsLine,
  hostsPath,
  isHostsEntry,
  isLoopback,
  launchDaemonPath,
  loopbackRemoval,
  loopbackSetup,
} from "./loopback.ts";

const hosts = [
  "127.0.0.1 localhost",
  "# 127.0.0.2 ev.internal",
  "127.77.0.1\tev.internal # added for evertap",
  "10.0.0.5 ev.internal other.lan",
  "",
].join("\r\n");

describe("hosts file", () => {
  it("finds where ev.internal points, skipping comments", () => {
    expect(hostsAddress(hosts)).toBe("127.77.0.1");
    expect(hostsAddress("127.0.0.1 localhost\n")).toBeNull();
    expect(hostsAddress("127.0.0.1 dev.internal ev.internal.example\n")).toBeNull();
  });

  it("treats only a line naming ev.internal alone as evertap's", () => {
    expect(hosts.split("\n").filter(isHostsEntry)).toEqual([
      "127.77.0.1\tev.internal # added for evertap\r",
    ]);
  });

  it("writes the line and knows where the file is on each system", () => {
    expect(hostsLine("127.77.0.1")).toBe("127.77.0.1 ev.internal");
    expect(hostsPath("darwin")).toBe("/etc/hosts");
    expect(hostsPath("win32")).toMatch(/\\System32\\drivers\\etc\\hosts$/);
  });
});

describe("isLoopback", () => {
  it("accepts what never leaves this machine", () => {
    for (const host of ["localhost", "app.localhost", "127.0.0.1", "127.77.0.1", "::1", "[::1]"]) {
      expect(isLoopback(host)).toBe(true);
    }
  });

  it("rejects every address others can reach", () => {
    for (const host of ["0.0.0.0", "::", "192.168.1.20", "evertap.local", "127.0.0.1.nip.io"]) {
      expect(isLoopback(host)).toBe(false);
    }
  });
});

it("aliases a single address, never the /8 that overlaps 127.0.0.1", () => {
  expect(addAliasCommand("127.77.0.1")).toEqual([
    "ifconfig",
    "lo0",
    "alias",
    "127.77.0.1",
    "netmask",
    "255.255.255.255",
  ]);
});

const linux = (file: string | null): LoopbackState => ({
  platform: "linux",
  hosts: file,
  aliased: false,
  daemon: false,
});

const mac = (file: string, has: { aliased: boolean; daemon: boolean }): LoopbackState => ({
  platform: "darwin",
  hosts: file,
  ...has,
});

const changes = (result: RootChanges | { refused: string }): RootChanges => {
  if ("refused" in result) {
    throw new Error(result.refused);
  }
  return result;
};

/** Whether `sh` can parse the script; nothing in it runs. */
const parses = (script: string) => spawnSync("sh", ["-n", "-c", script]).status === 0;

describe("loopbackSetup", () => {
  it("adds the hosts line on Linux, which answers on all of 127/8 already", () => {
    const setup = changes(loopbackSetup(linux("127.0.0.1 localhost\n")));
    expect(setup.changes).toEqual(['Add "127.77.0.1 ev.internal" to /etc/hosts']);
    expect(setup.script).toBe("set -e\ncat > /etc/hosts");
    expect(setup.input).toBe("127.0.0.1 localhost\n127.77.0.1 ev.internal\n");
  });

  it("starts the line on its own when the file does not end in a newline", () => {
    expect(changes(loopbackSetup(linux("127.0.0.1 localhost"))).input).toBe(
      "127.0.0.1 localhost\n127.77.0.1 ev.internal\n",
    );
  });

  it("has nothing to do once the name leads here", () => {
    const setup = changes(loopbackSetup(linux("127.77.0.1 ev.internal\n")));
    expect(setup.changes).toEqual([]);
  });

  it("replaces its own line that sends the name elsewhere, as connect --host may have", () => {
    const setup = changes(loopbackSetup(linux("10.0.0.5 ev.internal\n127.0.0.1 localhost\n")));
    expect(setup.changes).toEqual([
      'Add "127.77.0.1 ev.internal" to /etc/hosts in place of its ev.internal line',
    ]);
    expect(setup.input).toBe("127.0.0.1 localhost\n127.77.0.1 ev.internal\n");
  });

  it("leaves a line of someone else's alone and says what to change", () => {
    const setup = loopbackSetup(linux("10.0.0.5 ev.internal nas.lan\n"));
    expect(setup).toEqual({
      refused:
        '/etc/hosts sends ev.internal elsewhere in "10.0.0.5 ev.internal nas.lan". Take ev.internal off that line, then try again',
    });
  });

  it("never writes a hosts file it could not read", () => {
    expect("refused" in loopbackSetup(linux(null))).toBe(true);
  });

  it("adds the alias on macOS now and at every startup, with one script", () => {
    const setup = changes(loopbackSetup(mac("", { aliased: false, daemon: false })));
    expect(setup.changes).toEqual([
      'Add "127.77.0.1 ev.internal" to /etc/hosts',
      "Add 127.77.0.1 to this Mac's loopback (lo0)",
      `Add it again at every startup, with ${launchDaemonPath}`,
    ]);
    expect(setup.script).toContain(
      "\n/sbin/ifconfig lo0 alias 127.77.0.1 netmask 255.255.255.255\n",
    );
    expect(setup.script).toContain("<string>evertap.loopback</string>");
    expect(setup.script).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(setup.script).toContain(
      `chown root:wheel ${launchDaemonPath}\nchmod 644 ${launchDaemonPath}`,
    );
    expect(setup.script).toMatch(
      /launchctl bootstrap system \/Library\/LaunchDaemons\/evertap\.loopback\.plist$/,
    );
    expect(parses(setup.script)).toBe(true);
  });

  it("adds only what a Mac is missing", () => {
    const setup = changes(
      loopbackSetup(mac("127.77.0.1 ev.internal\n", { aliased: true, daemon: false })),
    );
    expect(setup.changes).toEqual([`Add it again at every startup, with ${launchDaemonPath}`]);
    expect(setup.script).not.toContain("ifconfig lo0 alias 127.77.0.1 netmask");
    expect(setup.script).not.toContain("/etc/hosts");
  });
});

describe("loopbackRemoval", () => {
  it("removes evertap's hosts line and keeps the rest", () => {
    const removal = loopbackRemoval(
      linux("127.0.0.1 localhost\n127.77.0.1 ev.internal\n10.0.0.5 ev.internal nas.lan\n"),
    );
    expect(removal.changes).toEqual(["Remove the ev.internal line from /etc/hosts"]);
    expect(removal.input).toBe("127.0.0.1 localhost\n10.0.0.5 ev.internal nas.lan\n");
    expect(loopbackRemoval(linux("127.0.0.1 localhost\n")).changes).toEqual([]);
    expect(loopbackRemoval(linux(null)).changes).toEqual([]);
  });

  it("unloads the startup job before it drops the alias on macOS", () => {
    const removal = loopbackRemoval(
      mac("127.77.0.1 ev.internal\n", { aliased: true, daemon: true }),
    );
    expect(removal.changes).toEqual([
      `Delete ${launchDaemonPath}`,
      "Run ifconfig lo0 -alias 127.77.0.1",
      "Remove the ev.internal line from /etc/hosts",
    ]);
    expect(removal.script.split("\n")).toEqual([
      "set -e",
      "launchctl bootout system/evertap.loopback 2>/dev/null || true",
      `rm -f ${launchDaemonPath}`,
      "/sbin/ifconfig lo0 -alias 127.77.0.1",
      "cat > /etc/hosts",
    ]);
    expect(parses(removal.script)).toBe(true);
  });
});
