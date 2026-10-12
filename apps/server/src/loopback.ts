/** How `ev.internal` reaches this machine: the hosts entry and, on macOS, the loopback alias. */

import { DATABASE_ADDRESS, DATABASE_HOST, RESOURCE_PORTS } from "@evertap/api/rules";

/** Names and addresses whose traffic never leaves this machine. */
export const isLoopback = (host: string) =>
  host === "localhost" ||
  host.endsWith(".localhost") ||
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
  host === "::1" ||
  host === "[::1]";

export const hostsPath = (platform: NodeJS.Platform = process.platform) =>
  platform === "win32"
    ? `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\drivers\\etc\\hosts`
    : "/etc/hosts";

export const hostsLine = (address: string) => `${address} ${DATABASE_HOST}`;

const fields = (line: string) => line.replace(/#.*/, "").trim().split(/\s+/).filter(Boolean);

/** Where the hosts file sends `ev.internal`, or null. The first line naming it wins, as in the resolver. */
export const hostsAddress = (hosts: string): string | null => {
  for (const line of hosts.split("\n")) {
    const [address, ...names] = fields(line);
    if (address !== undefined && names.some((name) => name.toLowerCase() === DATABASE_HOST)) {
      return address;
    }
  }
  return null;
};

/** A line that names `ev.internal` alone; one that names other hosts too belongs to someone else. */
export const isHostsEntry = (line: string) => {
  const [address, ...names] = fields(line);
  return address !== undefined && names.length === 1 && names[0]?.toLowerCase() === DATABASE_HOST;
};

/**
 * macOS puts only 127.0.0.1 on lo0; Linux and Windows answer on all of 127/8. The alias is a /32:
 * a /8 overlapping 127.0.0.1 has sent mDNSResponder into a loop.
 */
export const aliasNeeded = (platform: NodeJS.Platform = process.platform) => platform === "darwin";

export const addAliasCommand = (address: string) => [
  "ifconfig",
  "lo0",
  "alias",
  address,
  "netmask",
  "255.255.255.255",
];

export const removeAliasCommand = (address: string) => ["ifconfig", "lo0", "-alias", address];

const LAUNCH_LABEL = "evertap.loopback";

/** Adds the alias again at every boot, as macOS drops it at shutdown. */
export const launchDaemonPath = `/Library/LaunchDaemons/${LAUNCH_LABEL}.plist`;

// launchd does not search PATH.
const ifconfig = ([command, ...args]: string[]) => [`/sbin/${command}`, ...args];

const launchDaemon = () =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${LAUNCH_LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...ifconfig(addAliasCommand(DATABASE_ADDRESS)).map((arg) => `    <string>${arg}</string>`),
    "  </array>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "</dict>",
    "</plist>",
  ].join("\n");

/** What the changes below start from. */
export type LoopbackState = {
  platform: NodeJS.Platform;
  /** The hosts file now; null when it cannot be read, so it is never written blind. */
  hosts: string | null;
  /** macOS: the address is on lo0 now. */
  aliased: boolean;
  /** macOS: the LaunchDaemon that adds it at boot is in place. */
  daemon: boolean;
};

export const readLoopback = async (
  platform: NodeJS.Platform = process.platform,
): Promise<LoopbackState> => ({
  platform,
  hosts: await Bun.file(hostsPath(platform))
    .text()
    .catch(() => null),
  aliased: aliasNeeded(platform) && hasAddress(DATABASE_ADDRESS),
  daemon: aliasNeeded(platform) && (await Bun.file(launchDaemonPath).exists()),
});

/** Changes only root can make, as one script so that they ask for the password once. */
export type RootChanges = {
  /** Each change in words, to show before asking, or to make by hand when sudo fails. */
  changes: string[];
  /** A POSIX shell script that makes them. */
  script: string;
  /** The script's standard input: the new hosts file, when it changes. */
  input: string;
};

const withoutEntries = (hosts: string) =>
  hosts
    .split("\n")
    .filter((line) => !isHostsEntry(line))
    .join("\n");

/**
 * What points `ev.internal` at this machine's own address: the hosts line and, on macOS, the alias
 * now and at every boot. Refused when the hosts file cannot be read, or a line of someone else's
 * sends the name elsewhere.
 */
export const loopbackSetup = (state: LoopbackState): RootChanges | { refused: string } => {
  const { hosts, platform } = state;
  const path = hostsPath(platform);
  if (hosts === null) {
    return { refused: `Cannot read ${path}. Check that it exists, then try again` };
  }
  const changes: string[] = [];
  const script = ["set -e"];
  let input = "";
  if (hostsAddress(hosts) !== DATABASE_ADDRESS) {
    const foreign = hosts
      .split("\n")
      .find(
        (line) =>
          !isHostsEntry(line) &&
          hostsAddress(line) !== null &&
          hostsAddress(line) !== DATABASE_ADDRESS,
      );
    if (foreign !== undefined) {
      return {
        refused: `${path} sends ${DATABASE_HOST} elsewhere in "${foreign.trim()}". Take ${DATABASE_HOST} off that line, then try again`,
      };
    }
    const kept = withoutEntries(hosts);
    const line = hostsLine(DATABASE_ADDRESS);
    // Appended to a last line without a newline, the entry would join that line.
    input = `${kept}${kept === "" || kept.endsWith("\n") ? "" : "\n"}${line}\n`;
    changes.push(
      `Add "${line}" to ${path}${kept === hosts ? "" : ` in place of its ${DATABASE_HOST} line`}`,
    );
    script.push(`cat > ${path}`);
    if (platform === "darwin") {
      // So a lookup made before this one is not answered from the cache.
      script.push("killall -HUP mDNSResponder 2>/dev/null || true");
    }
  }
  if (aliasNeeded(platform)) {
    if (!state.aliased) {
      changes.push(`Add ${DATABASE_ADDRESS} to this Mac's loopback (lo0)`);
      script.push(ifconfig(addAliasCommand(DATABASE_ADDRESS)).join(" "));
    }
    if (!state.daemon) {
      changes.push(`Add it again at every startup, with ${launchDaemonPath}`);
      script.push(
        `cat > ${launchDaemonPath} <<'PLIST'`,
        launchDaemon(),
        "PLIST",
        `chown root:wheel ${launchDaemonPath}`,
        `chmod 644 ${launchDaemonPath}`,
        `launchctl print system/${LAUNCH_LABEL} >/dev/null 2>&1 || launchctl bootstrap system ${launchDaemonPath}`,
      );
    }
  }
  return { changes, script: script.join("\n"), input };
};

/** What undoes `loopbackSetup`, and the hosts lines `evertap connect` asked for. */
export const loopbackRemoval = (state: LoopbackState): RootChanges => {
  const { hosts, platform } = state;
  const path = hostsPath(platform);
  const changes: string[] = [];
  const script = ["set -e"];
  let input = "";
  if (aliasNeeded(platform)) {
    // The job goes first, or it could add the alias back.
    if (state.daemon) {
      changes.push(`Delete ${launchDaemonPath}`);
      script.push(
        `launchctl bootout system/${LAUNCH_LABEL} 2>/dev/null || true`,
        `rm -f ${launchDaemonPath}`,
      );
    }
    if (state.aliased) {
      changes.push(`Run ifconfig lo0 -alias ${DATABASE_ADDRESS}`);
      script.push(ifconfig(removeAliasCommand(DATABASE_ADDRESS)).join(" "));
    }
  }
  if (hosts !== null && hosts.split("\n").some(isHostsEntry)) {
    changes.push(`Remove the ${DATABASE_HOST} line from ${path}`);
    input = withoutEntries(hosts);
    script.push(`cat > ${path}`);
  }
  return { changes, script: script.join("\n"), input };
};

/** Makes the changes with sudo, which asks for the password on the terminal; false when it fails. */
export const runAsRoot = async ({ script, input }: RootChanges) => {
  try {
    const child = Bun.spawn(["sudo", "sh", "-c", script], {
      stdin: new Blob([input]),
      stdout: "inherit",
      stderr: "inherit",
    });
    return (await child.exited) === 0;
  } catch {
    return false;
  }
};

/** The command that shows what listens on `port`. */
export const listenerCommand = (port: number) =>
  process.platform === "win32"
    ? `netstat -ano | findstr :${port}`
    : `sudo lsof -nP -iTCP:${port} -sTCP:LISTEN`;

/** How a program shares `port` with evertap on a loopback address of its own. */
export const loopbackOnly = (port: number) =>
  `have it listen on 127.0.0.1 only (in Compose: "127.0.0.1:${port}:${port}")`;

/**
 * What programs that want these ports on every address meet while evertap holds them on one
 * loopback address: Linux refuses a wildcard listener on a port a specific address already holds.
 */
export const sharingAdvice = (ports: number[]) => {
  const [port = RESOURCE_PORTS.postgresql] = ports;
  return `programs that listen on ${ports.join(", ")} on all addresses may fail to start. In Compose, publish them on 127.0.0.1, such as "127.0.0.1:${port}:${port}".`;
};

/** Whether this machine has `address`, so something can listen on it. */
export const hasAddress = (address: string) => {
  try {
    Bun.listen({ hostname: address, port: 0, socket: { data: () => {} } }).stop(true);
    return true;
  } catch {
    return false;
  }
};
