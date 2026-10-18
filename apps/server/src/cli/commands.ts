import { Database } from "bun:sqlite";
import { readdir, rm, rmdir, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { hostname } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { formatConnection } from "@evertap/api/connections";
import type { AppRouterClient } from "@evertap/api/router";
import {
  ACCESS_CHOICE_NAMES,
  DATABASE_ADDRESS,
  DATABASE_HOST,
  RESOURCE_ENGINES,
  RESOURCE_PORTS,
  type ResourceEngine,
  TUNNEL_STATES,
  WILDCARDS,
  normalizePairingCode,
} from "@evertap/api/rules";
import { type DoctorReport, type Resource, savedSettingsSchema } from "@evertap/api/schemas";
import { renderUnicodeCompact } from "uqr";

import { config } from "../config.ts";
import { NAME_PREFIX, createDocker } from "../live/docker.ts";
import {
  addAliasCommand,
  aliasNeeded,
  hostsAddress,
  hostsLine,
  hostsPath,
  isHostsEntry,
  isLoopback,
  launchDaemonPath,
  listenerCommand,
  loopbackOnly,
  loopbackRemoval,
  readLoopback,
  runAsRoot,
  sharingAdvice,
} from "../loopback.ts";
import { cliBehind } from "../update-check.ts";
import { VERSION } from "../version.ts";
import { relayRefusal, startConnect } from "./connect.ts";
import {
  NOT_RUNNING,
  type Target,
  clientFor,
  findTarget,
  localSocket,
  signInHint,
} from "./remote.ts";
import {
  type Settings,
  normalizeUrl,
  readSettings,
  removeSettings,
  settingsDir,
  writeSettings,
} from "./settings.ts";
import { leftBehind, runSetup } from "./setup.ts";
import { installSkill, offerSkill, removeSkill, removeWritten, writtenSkills } from "./skills.ts";
import { ask, fail, openBrowser, print, warn } from "./terminal.ts";

const POLL_MS = 2000;

const ENGINE_NAMES: Record<string, ResourceEngine> = {
  postgresql: "postgresql",
  postgres: "postgresql",
  pg: "postgresql",
  mysql: "mysql",
  redis: "redis",
  garage: "garage",
};

const engineOf = (typed: string): ResourceEngine =>
  ENGINE_NAMES[typed.toLowerCase()] ??
  fail(`Unknown service ${typed}. Choose one of ${RESOURCE_ENGINES.join(", ")}`);

const signedIn = async () => {
  const target = await findTarget();
  if (!target) {
    fail(signInHint());
  }
  return { target, client: clientFor(target) };
};

const printJson = (value: unknown) => {
  print(JSON.stringify(value, null, 2));
};

/** Pads each column to its widest cell; the last column is left ragged. */
const printTable = (rows: string[][]) => {
  const widths = rows[0]?.map((_, column) =>
    Math.max(...rows.map((row) => (row[column] ?? "").length)),
  );
  for (const row of rows) {
    print(
      row
        .map((cell, column) =>
          column === row.length - 1 ? cell : cell.padEnd(widths?.[column] ?? 0),
        )
        .join("  ")
        .trimEnd(),
    );
  }
};

const ago = (iso: string | null) => {
  if (iso === null) {
    return "never";
  }
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};

const until = (iso: string) => {
  const minutes = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
  if (minutes < 60) {
    return `in ${minutes} minutes`;
  }
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `in ${hours}h` : `in ${Math.round(hours / 24)}d`;
};

/** Names are unique per service, so a name alone can match a database and a bucket. */
const findResource = async (client: AppRouterClient, ref: string, engine?: string) => {
  const wanted = engine === undefined ? undefined : engineOf(engine);
  const all = await client.resources.list();
  const byId = all.find((row) => row.id === ref);
  if (byId) {
    return byId;
  }
  const named = all.filter((row) => row.name === ref && (!wanted || row.engine === wanted));
  const [only] = named;
  if (named.length === 1 && only) {
    return only;
  }
  return fail(
    named.length === 0
      ? `No resource is named ${ref}. Run evertap list to see them`
      : `${named.length} resources are named ${ref}. Add ${named.map((row) => `--engine ${row.engine}`).join(" or ")}`,
  );
};

const refArgs = (args: string[]) => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { engine: { type: "string" }, json: { type: "boolean" }, yes: { type: "boolean" } },
  });
  const [ref] = positionals;
  if (ref === undefined) {
    fail("Name the resource: its name or id");
  }
  return { ref, ...values };
};

const describe = (resource: Resource) => {
  const rows: string[][] = [
    ["Name", resource.name],
    ["Service", resource.engine + (resource.kind === "database" ? ` ${resource.version}` : "")],
    ["Id", resource.id],
  ];
  if (resource.description !== "") {
    rows.push(["Note", resource.description]);
  }
  if (resource.kind === "object-storage") {
    rows.push(["From anywhere", resource.reachableAnywhere ? "yes" : "no"]);
  }
  rows.push(
    ["Protected", resource.protected ? "yes" : "no"],
    [
      "Expires",
      resource.expiresAt === null ? "never" : `${until(resource.expiresAt)} unless kept or used`,
    ],
    ["Last used", ago(resource.lastConnectedAt)],
  );
  printTable(rows);
  print();
  print(formatConnection(resource, "env"));
};

type Command = {
  usage: string;
  summary: string;
  run: (args: string[]) => Promise<void>;
};

const list: Command = {
  usage: "list [--engine <service>] [--json]",
  summary: "List resources, most recently used first",
  run: async (args) => {
    const { values } = parseArgs({
      args,
      options: { engine: { type: "string" }, json: { type: "boolean" } },
    });
    const { client } = await signedIn();
    const engine = values.engine === undefined ? undefined : engineOf(values.engine);
    const rows = (await client.resources.list())
      .filter((row) => !engine || row.engine === engine)
      .toSorted((a, b) =>
        (b.lastConnectedAt ?? b.createdAt).localeCompare(a.lastConnectedAt ?? a.createdAt),
      );
    if (values.json) {
      printJson(rows);
      return;
    }
    if (rows.length === 0) {
      print("No resources yet. Create one with evertap create <service> <name>");
      return;
    }
    printTable([
      ["NAME", "SERVICE", "LAST USED", "NOTE"],
      ...rows.map((row) => [
        row.name + (row.protected ? " (protected)" : "") + (row.expiresAt ? " (temporary)" : ""),
        row.engine + (row.kind === "database" ? ` ${row.version}` : ""),
        ago(row.lastConnectedAt),
        row.description,
      ]),
    ]);
  },
};

const get: Command = {
  usage: "get <name> [--engine <service>] [--json]",
  summary: "Show a resource and its connection details",
  run: async (args) => {
    const { ref, engine, json } = refArgs(args);
    const { client } = await signedIn();
    const resource = await findResource(client, ref, engine);
    if (json) {
      printJson(resource);
      return;
    }
    describe(resource);
  },
};

const create: Command = {
  usage:
    "create <service> <name> [--version <v>] [--extension <e>]... [--note <text>] [--temporary] [--json]",
  summary: "Create a database or bucket and print its connection details",
  run: async (args) => {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        version: { type: "string" },
        extension: { type: "string", multiple: true },
        note: { type: "string" },
        temporary: { type: "boolean" },
        json: { type: "boolean" },
      },
    });
    const [service, name] = positionals;
    if (service === undefined || name === undefined) {
      fail("Usage: evertap create <service> <name>, such as evertap create postgres blog");
    }
    const { client } = await signedIn();
    const resource = await client.resources.create({
      engine: engineOf(service),
      name,
      version: values.version,
      extensions: values.extension ?? [],
      description: values.note ?? "",
      temporary: values.temporary ?? false,
    });
    if (values.json) {
      printJson(resource);
      return;
    }
    describe(resource);
  },
};

const url: Command = {
  usage: "url <name> [--engine <service>]",
  summary: "Print a database's connection URL, or a bucket's endpoint",
  run: async (args) => {
    const { ref, engine } = refArgs(args);
    const { client } = await signedIn();
    const resource = await findResource(client, ref, engine);
    print(resource.kind === "database" ? resource.connectionUrl : resource.endpoint);
  },
};

const env: Command = {
  usage: "env <name> [--engine <service>]",
  summary: "Print the connection details as .env lines",
  run: async (args) => {
    const { ref, engine } = refArgs(args);
    const { client } = await signedIn();
    print(formatConnection(await findResource(client, ref, engine), "env"));
  },
};

const confirmDelete = async (resource: Resource, yes: boolean | undefined) => {
  if (yes) {
    return;
  }
  if (!process.stdin.isTTY) {
    fail("Add --yes to delete without a prompt");
  }
  const typed = await ask(
    `Deleting ${resource.name} removes its data for good. Type its name to confirm: `,
  );
  if (typed !== resource.name) {
    fail("The name did not match. Nothing was deleted");
  }
};

const remove: Command = {
  usage: "delete <name> [--engine <service>] [--yes]",
  summary: "Delete a resource and its data; a protected one needs unprotect first",
  run: async (args) => {
    const { ref, engine, yes } = refArgs(args);
    const { client } = await signedIn();
    const resource = await findResource(client, ref, engine);
    if (resource.protected) {
      fail(`${resource.name} is protected. Run evertap unprotect ${ref} first`);
    }
    await confirmDelete(resource, yes);
    await client.resources.delete({ id: resource.id });
    print(`Deleted ${resource.name}`);
  },
};

const setProtected = (value: boolean): Command => ({
  usage: `${value ? "protect" : "unprotect"} <name> [--engine <service>]`,
  summary: value
    ? "Protect a resource from deletion (a temporary one becomes permanent)"
    : "Allow a resource to be deleted again",
  run: async (args) => {
    const { ref, engine } = refArgs(args);
    const { client } = await signedIn();
    const resource = await findResource(client, ref, engine);
    await client.resources.setProtected({ id: resource.id, protected: value });
    print(`${resource.name} is ${value ? "protected" : "no longer protected"}`);
  },
});

const keep: Command = {
  usage: "keep <name> [--engine <service>]",
  summary: "Keep a temporary resource: it no longer expires",
  run: async (args) => {
    const { ref, engine } = refArgs(args);
    const { client } = await signedIn();
    const resource = await findResource(client, ref, engine);
    await client.resources.keep({ id: resource.id });
    print(`${resource.name} is kept and no longer expires`);
  },
};

const reachable: Command = {
  usage: "reachable <name> [--off] [--engine <service>]",
  summary:
    "Let a bucket's signed links work on any device, not only through evertap connect; --off undoes it",
  run: async (args) => {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { off: { type: "boolean" }, engine: { type: "string" } },
    });
    const [ref] = positionals;
    if (ref === undefined) {
      fail("Name the bucket: its name or id");
    }
    const { client } = await signedIn();
    const resource = await findResource(client, ref, values.engine);
    if (resource.kind !== "object-storage") {
      fail(`${resource.name} is a database. Only a bucket can be reached from anywhere`);
    }
    const updated = await client.resources.setReachableAnywhere({
      id: resource.id,
      reachableAnywhere: !values.off,
    });
    if (updated.kind !== "object-storage" || !updated.reachableAnywhere) {
      print(`Signed links to ${resource.name} work only through evertap connect again`);
      return;
    }
    print(`Signed links to ${resource.name} work on any device. Objects still need a signature.`);
    if (updated.publicEndpoint !== null) {
      print(
        `Sign links with a second client on S3_PUBLIC_ENDPOINT=${updated.publicEndpoint}, and keep the endpoint for every other call`,
      );
    }
  },
};

const login: Command = {
  usage: "login <url>",
  summary: "Pair this machine with evertap; a person approves the code in a browser",
  run: async (args) => {
    const { positionals } = parseArgs({ args, allowPositionals: true });
    const typed = positionals[0] ?? (await readSettings())?.url;
    if (typed === undefined) {
      fail("Give the address you open evertap at: evertap login https://evertap.example.com");
    }
    const base = normalizeUrl(typed);
    if (!URL.canParse(base)) {
      fail(
        `${typed} is not an address. Give the one you open evertap at, such as https://evertap.example.com`,
      );
    }
    const address = new URL(base);
    if (address.protocol === "http:" && !isLoopback(address.hostname)) {
      warn(
        "Warning: use https:// unless you trust every network between here and evertap. Over http://, anyone watching can read this machine's token and act as you.",
      );
    }
    const client = clientFor({ kind: "remote", url: base, token: null, source: "none" });
    const started = await client.clients.pairing.start({ name: hostname() });
    // Checked before it reaches a URL the shell opens: on Windows, `start` runs through cmd.
    const code = normalizePairingCode(started.code);
    if (code === null) {
      fail(`${base} did not answer like evertap. Check the address and run evertap login again`);
    }
    const approve = `${base}/device?code=${code}`;
    print(`Code: ${code}`);
    print(`Approve it at ${approve}`);
    await openBrowser(approve);
    for (;;) {
      await Bun.sleep(POLL_MS);
      const claimed = await client.clients.pairing.claim({ requestId: started.requestId });
      if (claimed.status === "approved" && claimed.token) {
        await writeSettings({ url: base, token: claimed.token });
        print(`Paired ${hostname()} with ${base}`);
        await offerSkill();
        return;
      }
      if (claimed.status === "denied") {
        fail("The request was denied. Run evertap login again to ask again");
      }
      if (claimed.status === "expired") {
        fail("The code expired. Run evertap login again for a new code");
      }
    }
  },
};

const revoke = async (settings: Settings) => {
  try {
    await clientFor({ kind: "remote", ...settings, source: "login" }).session.end(undefined, {
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Already revoked, or the server is gone: forgetting it locally is what is left.
  }
};

const logout: Command = {
  usage: "logout",
  summary: "Revoke this machine's token and forget the address",
  run: async () => {
    const settings = await readSettings();
    if (!settings) {
      print("Not signed in");
      return;
    }
    await revoke(settings);
    await removeSettings();
    print(`Signed out of ${settings.url}`);
  },
};

const describeTarget = (target: Target) =>
  target.kind === "local"
    ? `this machine (${target.socket})`
    : `${target.url}${target.source === "api-key" ? " with EVERTAP_API_KEY" : ""}`;

const status: Command = {
  usage: "status",
  summary: "Show which evertap this CLI uses and whether it is signed in",
  run: async () => {
    const target = await findTarget();
    if (!target) {
      print(signInHint());
      return;
    }
    const client = clientFor(target);
    const session = await client.session.get();
    const rows = [
      ["evertap", describeTarget(target)],
      ["Signed in", session.signedIn ? "yes" : "no — run evertap login again"],
    ];
    if (session.signedIn) {
      const system = await client.system.status();
      rows.push(["Mode", system.mode], ["Services", system.engines.join(", ")]);
    }
    printTable(rows);
  },
};

const describeTunnel = ({
  hostname: name,
  state,
  connections,
  error,
}: NonNullable<DoctorReport["tunnel"]>) => {
  const { label, advice } = TUNNEL_STATES[state];
  const links =
    state === "connected" ? ` (${connections} ${connections === 1 ? "link" : "links"})` : "";
  return `${name}: ${label.toLowerCase()}${links}${error ? `: ${error}` : ""}${advice ? `. ${advice}` : ""}`;
};

const doctor: Command = {
  usage: "doctor",
  summary: "Check Docker, each service, and the entries",
  run: async () => {
    const { client } = await signedIn();
    const report = await client.system.doctor();
    const behind = cliBehind(VERSION, report.version);
    const rows = [
      ["evertap", report.version],
      ...(report.update
        ? [["Update", `evertap ${report.update.version} is out. ${report.update.advice}`]]
        : []),
      ...(behind ? [["CLI", behind]] : []),
      [
        "Docker",
        report.docker === null
          ? "not used (demo)"
          : report.docker.reachable
            ? `ok${report.docker.version ? ` ${report.docker.version}` : ""}, API ${report.docker.apiVersion}`
            : `not reachable${report.docker.socket ? ` at ${report.docker.socket}` : ""}`,
      ],
      ...(report.docker?.warnings ?? []).map((warning) => ["", warning.message]),
      ...report.engines.map((engine) => [
        engine.engine,
        engine.state + (engine.error ? `: ${engine.error}` : ""),
      ]),
      // The demo starts nothing, so nothing listens where its settings say.
      ...(report.docker === null
        ? []
        : [
            [
              "Access",
              report.access
                ? ACCESS_CHOICE_NAMES[report.access].label
                : "not set up: run evertap setup on the machine running evertap",
            ],
          ]),
      ...(report.tunnel ? [["Tunnel", describeTunnel(report.tunnel)]] : []),
      ...report.entries.map((entry) => {
        // What answers there is the other program.
        const taken = report.conflicts.find(
          (conflict) => conflict.running && conflict.address === entry.address,
        );
        return [
          `${entry.engine} entry`,
          `${entry.address} ${taken ? `is taken by ${taken.name}` : entry.reachable ? "answers" : "does not answer"}`,
        ];
      }),
      ...report.conflicts.map((conflict) => [`${conflict.name} (Docker)`, conflict.message]),
    ];
    if (report.lan) {
      const { host, addresses } = report.lan;
      rows.push(
        report.access === "local"
          ? [
              host,
              addresses.includes(DATABASE_ADDRESS)
                ? `→ ${DATABASE_ADDRESS}`
                : "does not lead to evertap yet: run evertap setup on this machine",
            ]
          : [
              "LAN name",
              `${host} → ${addresses.join(", ") || "does not resolve: give it an address in your network's DNS"}`,
            ],
      );
    }
    const { disk } = report.machine;
    rows.push([
      "Disk",
      `${Math.round((disk.freeBytes / Math.max(disk.totalBytes, 1)) * 100)}% free`,
    ]);
    if (report.dataDir) {
      rows.push(["Data", report.dataDir]);
    }
    printTable(rows);
  },
};

/** evertap on this machine, over its socket: what sign-in links and settings need. */
const onThisMachine = async () => {
  const socket = await localSocket();
  if (!socket) {
    fail(NOT_RUNNING);
  }
  return clientFor({ kind: "local", socket });
};

const showSignInLink = async (client: AppRouterClient) => {
  const { url: link, expiresAt } = await client.session.link();
  print("Scan this with your phone, or open the link in a browser.");
  print(`It signs in one browser and expires ${until(expiresAt)}.`);
  print();
  print(renderUnicodeCompact(link, { border: 1 }));
  print(link);
};

const openSignedIn = async (client: AppRouterClient) => {
  const { url: link, expiresAt } = await client.session.link();
  print(
    (await openBrowser(link))
      ? `Opening evertap in your browser, signed in. If it does not open, open this link on this machine; it expires ${until(expiresAt)}:`
      : `No browser opened on this machine. Open this link in a browser on it to sign in; it expires ${until(expiresAt)}:`,
  );
  print(link);
};

const signinLink: Command = {
  usage: "signin-link",
  summary: "On the machine running evertap: print a one-time link that signs a browser in",
  run: async () => {
    await showSignInLink(await onThisMachine());
  },
};

const setup: Command = {
  usage:
    "setup [--mode local|network|cloudflare] [--url <address>] [--listen <address>] [--zone <domain>] [--s3-url <address>]",
  summary:
    "On the machine running evertap: choose how other machines reach it, then sign a browser in",
  run: async (args) => {
    const { values } = parseArgs({
      args,
      options: {
        mode: { type: "string" },
        url: { type: "string" },
        listen: { type: "string" },
        zone: { type: "string" },
        "s3-url": { type: "string" },
      },
    });
    const client = await onThisMachine();
    const { "s3-url": s3Url, ...rest } = values;
    const { opensBrowser } = await runSetup(client, { ...rest, s3Url });
    await (opensBrowser ? openSignedIn(client) : showSignInLink(client));
  },
};

const open: Command = {
  usage: "open",
  summary: "On the machine running evertap: open it in a browser here, signed in",
  run: async () => {
    await openSignedIn(await onThisMachine());
  },
};

/** What usually holds each standard port on a developer's machine. */
const USUAL_HOLDERS: Record<number, string> = {
  5432: "a PostgreSQL run on this machine",
  3306: "a MySQL or MariaDB run on this machine",
  6379: "a Redis run on this machine",
  3900: "a Garage run on this machine",
};

const takenHint = (engine: string, host: string, port: number) => {
  const holder = USUAL_HOLDERS[port];
  // Something on 127.0.0.1 alone leaves other loopback addresses free, but not a wildcard.
  const apart = WILDCARDS.has(host) || host === "127.0.0.1" ? "" : `, or ${loopbackOnly(port)}`;
  return [
    `${engine}: ${port} is taken, likely by ${holder ? `${holder}, ` : ""}a Compose file with "${port}:${port}", or another evertap connect.`,
    `  Stop it${apart}. To see what it is: ${listenerCommand(port)}`,
  ].join("\n");
};

/** How to point `ev.internal` at `host`; null when the hosts file already does or `host` is not one address. */
const hostsStep = (host: string, hosts: string) => {
  const current = hostsAddress(hosts);
  if (isIP(host) === 0 || WILDCARDS.has(host) || current === host) {
    return null;
  }
  const line = hostsLine(host);
  if (current !== null) {
    return `Change the ${DATABASE_HOST} line in ${hostsPath()} to "${line}"`;
  }
  if (process.platform === "win32") {
    return `Add "${line}" to ${hostsPath()}, editing it as administrator`;
  }
  // Appended to a last line without a newline, the entry would join that line.
  return hosts === "" || hosts.endsWith("\n")
    ? `echo "${line}" | sudo tee -a ${hostsPath()}`
    : `printf '\\n%s\\n' "${line}" | sudo tee -a ${hostsPath()}`;
};

const connect: Command = {
  usage: "connect [--host <address>] [--engine <service>]...",
  summary: "Carry database and bucket connections from this machine to evertap; keep it running",
  run: async (args) => {
    const { values } = parseArgs({
      args,
      options: { host: { type: "string" }, engine: { type: "string", multiple: true } },
    });
    const target = await findTarget();
    if (!target) {
      fail(signInHint());
    }
    if (target.kind === "local") {
      fail(
        `evertap connect is for other machines. For apps on this one to reach ${DATABASE_HOST}, choose ${ACCESS_CHOICE_NAMES.local.label}: run evertap setup --mode local`,
      );
    }
    if (!target.token) {
      fail("Run evertap login <url> first");
    }
    const engines = values.engine?.map(engineOf) ?? RESOURCE_ENGINES;
    const refusal = await relayRefusal(target.url, target.token);
    if (refusal !== null) {
      fail(refusal);
    }
    // Only a release that changes the relay is refused above; any newer one is worth a line.
    const remoteVersion = await clientFor(target)
      .system.status()
      .then((system) => system.version)
      .catch(() => null);
    const behind = remoteVersion === null ? null : cliBehind(VERSION, remoteVersion);
    if (behind !== null) {
      warn(behind);
    }
    const host = values.host ?? DATABASE_ADDRESS;
    const failed: ResourceEngine[] = [];
    const notHere: ResourceEngine[] = [];
    const running = startConnect({
      url: target.url,
      token: target.token,
      hostname: host,
      engines,
      refused: warn,
      unavailable: (engine, error) => {
        failed.push(engine);
        const port = RESOURCE_PORTS[engine];
        const code = error instanceof Error && "code" in error ? error.code : undefined;
        if (code === "EADDRNOTAVAIL") {
          notHere.push(engine);
        } else if (code === "EADDRINUSE") {
          warn(takenHint(engine, host, port));
        } else {
          warn(
            `${engine}: cannot listen on ${host}:${port} (${error instanceof Error ? error.message : String(error)})`,
          );
        }
      },
    });
    const hosts = await Bun.file(hostsPath())
      .text()
      .catch(() => "");
    const pointHere = hostsStep(host, hosts);
    if (running.listening === 0) {
      if (notHere.length > 0 && aliasNeeded() && isLoopback(host)) {
        fail(
          [
            `Add ${host} to this Mac${pointHere ? ` and point ${DATABASE_HOST} at it` : ""}, then run evertap connect again:`,
            `  sudo ${addAliasCommand(host).join(" ")}`,
            ...(pointHere ? [`  ${pointHere}`] : []),
          ].join("\n"),
        );
      }
      fail(
        notHere.length > 0
          ? `${host} is not an address of this machine. Drop --host, or give one of its addresses`
          : `Nothing could listen on ${host}. Do as shown above, then run evertap connect again`,
      );
    }
    print(
      `Carrying database and bucket connections on ${host} to ${target.url}. Stop with Ctrl+C.`,
    );
    if (pointHere) {
      print(`Point ${DATABASE_HOST} here so connection URLs and bucket endpoints reach it:`);
      print(`  ${pointHere}`);
    }
    if (!isLoopback(host)) {
      warn(
        "Warning: anyone who can reach this machine can use these connections with your sign-in, leaving only each database's password or bucket's key in the way. Drop --host unless other machines need them.",
      );
    }
    if (!WILDCARDS.has(host)) {
      const ports = engines
        .filter((engine) => !failed.includes(engine))
        .map((engine) => RESOURCE_PORTS[engine]);
      print(`While this runs, ${sharingAdvice(ports)}`);
    }
    // Runs until the process is stopped.
    await new Promise(() => {});
  },
};

const skills: Command = {
  usage: "skills install|remove [--agent <agent>]... [--force]",
  summary:
    "Install the skill that teaches coding agents to use evertap, for each agent found here, or remove it",
  run: async (args) => {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { agent: { type: "string", multiple: true }, force: { type: "boolean" } },
    });
    const [action] = positionals;
    const force = values.force ?? false;
    if (action === "install" || action === "update") {
      await installSkill(values.agent, force);
    } else if (action === "remove") {
      await removeSkill(values.agent, force);
    } else {
      fail("Usage: evertap skills install, or evertap skills remove");
    }
  },
};

const version: Command = {
  usage: "version",
  summary: "Print the version",
  run: async () => {
    print(VERSION);
  },
};

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/** Whether `evertap serve` answers on its socket; a file left by a stopped one does not. */
const serving = async (socket: string) => {
  try {
    const response = await fetch("http://localhost/api/health", {
      unix: socket,
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

/** What `evertap serve` writes in its data directory; anything else there is someone else's. */
const DATA_ENTRIES = new Set<string>([
  "evertap.db",
  "evertap.db-wal",
  "evertap.db-shm",
  "evertap.sock",
  // What cloudflared runs a Cloudflare Tunnel with.
  "cloudflared",
  ...RESOURCE_ENGINES,
]);

const isDataEntry = (name: string) => DATA_ENTRIES.has(name) || /^evertap\.db\..+\.bak$/.test(name);

/** The Cloudflare Tunnel setup made, as the records in the data directory keep it; null without one. */
const recordedTunnel = (path: string) => {
  try {
    const db = new Database(path, { readonly: true });
    try {
      const row = db.query<{ data: string }, []>("SELECT data FROM settings WHERE id = 1").get();
      const saved = savedSettingsSchema.safeParse(row ? JSON.parse(row.data) : null);
      return saved.success && saved.data.mode === "cloudflare" ? saved.data.tunnel : null;
    } finally {
      db.close();
    }
  } catch {
    // No records, or none from an evertap that keeps settings.
    return null;
  }
};

const uninstall: Command = {
  usage: "uninstall [--yes]",
  summary: "Remove everything evertap made on this machine, every database's data included",
  run: async (args) => {
    const { values } = parseArgs({ args, options: { yes: { type: "boolean" } } });
    if (!NAME_PREFIX.test(config.prefix)) {
      fail(
        "Set EVERTAP_PREFIX to the prefix evertap ran with (letters, digits, _ . -), or unset it",
      );
    }
    if (await serving(join(config.dataDir, "evertap.sock"))) {
      fail("Stop evertap serve on this machine first, then run evertap uninstall again");
    }
    const data = await readdir(config.dataDir).then(
      (names) => names.filter(isDataEntry).toSorted(),
      () => [],
    );
    const configDir = (await exists(settingsDir())) ? settingsDir() : null;
    const settings = await readSettings();
    const skillDirs = await writtenSkills();
    const docker = await createDocker({
      socket: config.dockerSocket,
      network: config.prefix,
    }).catch(() => null);
    const made = docker ? await docker.listByPrefix(config.prefix).catch(() => null) : null;
    if (!made && data.length > 0) {
      // Removing the records alone would leave the data behind with no way back to it.
      fail(
        `Cannot reach Docker at ${config.dockerSocket}. Run evertap uninstall as a user who can use Docker`,
      );
    }
    const loopback = await readLoopback();
    const entries = (loopback.hosts ?? "").split("\n").filter(isHostsEntry);
    const inDocker = made ? [...made.containers, ...made.volumes, ...made.networks] : [];
    const found = [
      ...(made?.containers.length ? [`Docker: ${made.containers.join(", ")}`] : []),
      ...(made?.volumes.length ? [`Docker volumes: ${made.volumes.join(", ")}`] : []),
      ...(made?.networks.length ? [`Docker network: ${made.networks.join(", ")}`] : []),
      ...(data.length > 0 ? [`In ${config.dataDir}: ${data.join(", ")}`] : []),
      // Without a sign-in, it holds only the record of the agent skill.
      ...(configDir ? [`${settings ? "Sign-in" : "CLI settings"}: ${configDir}`] : []),
      ...(skillDirs.length > 0 ? [`Agent skill: ${skillDirs.join(", ")}`] : []),
      ...entries.map((line) => `${hostsPath()}: ${line.trim()}`),
      ...(loopback.aliased ? [`Loopback alias: ${DATABASE_ADDRESS} on lo0`] : []),
      ...(loopback.daemon ? [`Loopback alias at startup: ${launchDaemonPath}`] : []),
    ];
    const unchecked = `Docker at ${config.dockerSocket}: not checked`;
    if (found.length === 0) {
      if (made) {
        print("Nothing evertap made is left on this machine");
      } else {
        print(unchecked);
        print("Nothing else evertap made is on this machine");
      }
      return;
    }
    const tunnel = data.some((name) => name === "evertap.db")
      ? recordedTunnel(join(config.dataDir, "evertap.db"))
      : null;
    if (tunnel) {
      print(
        "These stay in Cloudflare. To remove them, stop here and run evertap serve, then choose another way to open evertap in Settings or with evertap setup, or remove them yourself:",
      );
      for (const line of leftBehind(tunnel)) {
        print(`  ${line}`);
      }
    }
    print("This removes from this machine:");
    for (const line of found) {
      print(`  ${line}`);
    }
    if (!made) {
      print(unchecked);
    }
    if (made?.volumes.length || data.length > 0) {
      print("Every database and bucket kept here is deleted with its data, for good.");
    }
    // evertap leaves both, so one alone points at another data directory, prefix or user.
    const lopsided = made !== null && inDocker.length > 0 !== data.length > 0;
    if (lopsided) {
      print(
        inDocker.length > 0
          ? `Found Docker items but no data in ${config.dataDir}.`
          : `Found data in ${config.dataDir} but no Docker items named ${config.prefix}-….`,
      );
      print(
        "evertap may have run with another EVERTAP_DATA_DIR or EVERTAP_PREFIX, or as another user.",
      );
    }
    if (lopsided || !values.yes) {
      if (values.yes || !process.stdin.isTTY) {
        fail(
          lopsided
            ? "Nothing was removed. Check the above, then confirm in a terminal without --yes"
            : "Add --yes to remove without a prompt",
        );
      }
      if ((await ask("Type uninstall to confirm: ")) !== "uninstall") {
        fail("Nothing was removed");
      }
    }
    if (settings) {
      await revoke(settings);
    }
    let changedSkills: string[] = [];
    try {
      if (docker && made) {
        await docker.removeByPrefix(config.prefix);
      }
      // Read again: reading the records for a tunnel leaves SQLite's -wal and -shm beside them.
      const written = await readdir(config.dataDir).then(
        (names) => names.filter(isDataEntry),
        () => [],
      );
      for (const name of written) {
        await rm(join(config.dataDir, name), { recursive: true, force: true });
      }
      // Before the settings, which hold the record of where it went. Without a copy it would only
      // write that record, in a settings directory that may not be there to remove.
      if (skillDirs.length > 0) {
        changedSkills = (await removeWritten(undefined, false)).kept;
      }
      if (configDir) {
        await rm(configDir, { recursive: true, force: true });
      }
    } catch (error) {
      fail(
        `Stopped partway: ${error instanceof Error ? error.message : String(error)}. Fix that, then run evertap uninstall again to finish`,
      );
    }
    if (data.length > 0) {
      try {
        await rmdir(config.dataDir);
      } catch {
        const rest = await readdir(config.dataDir).catch(() => []);
        if (rest.length > 0) {
          print(`Left ${config.dataDir}, which also holds ${rest.join(", ")}`);
        }
      }
    }
    for (const dir of changedSkills) {
      print(`Left ${dir}, which was changed after evertap wrote it`);
    }
    let finished = made !== null;
    // Read again: the hosts file may have changed while the person was confirming.
    const removal = loopbackRemoval(await readLoopback());
    if (removal.changes.length > 0) {
      const steps = removal.changes.map((change) => `  ${change}`);
      if (process.platform === "win32") {
        print(["Last, as administrator:", ...steps].join("\n"));
        finished = false;
      } else {
        print(["With sudo:", ...steps].join("\n"));
        if (!(await runAsRoot(removal))) {
          warn(["Could not finish with sudo. To finish, as administrator:", ...steps].join("\n"));
          finished = false;
        }
      }
    }
    print(
      finished
        ? "Removed."
        : made
          ? "Removed the rest."
          : `Removed what is listed. Docker at ${config.dockerSocket} was not checked.`,
    );
    print("To remove the evertap command too, delete it the way you installed it.");
  },
};

export const COMMANDS: Record<string, Command> = {
  list,
  get,
  create,
  url,
  env,
  delete: remove,
  protect: setProtected(true),
  unprotect: setProtected(false),
  keep,
  reachable,
  login,
  logout,
  status,
  doctor,
  connect,
  setup,
  open,
  "signin-link": signinLink,
  skills,
  version,
  uninstall,
};

// The server, not the CLI, runs it, so it is not among the commands.
const SERVE = { usage: "serve", summary: "Run evertap on this machine" };

export const help = () => {
  print("evertap: databases and object storage from one box");
  print();
  print("Usage: evertap <command>");
  print();
  for (const { usage, summary } of [SERVE, ...Object.values(COMMANDS)]) {
    print(`  evertap ${usage}`);
    print(`      ${summary}`);
  }
};

/** What `evertap <name> --help` prints; undefined when `name` is no command. */
export const commandHelp = (name: string) => {
  const command = name === "serve" ? SERVE : COMMANDS[name];
  return command && `Usage: evertap ${command.usage}\n  ${command.summary}\n`;
};
