import { Database } from "bun:sqlite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Context, DataError } from "@evertap/api/context";
import { appRouter } from "@evertap/api/router";
import { type SettingsEnvironment, resolveSettings } from "@evertap/api/settings";
import { createMemoryStore } from "@evertap/api/store/memory";
import { os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import type { Server } from "bun";
import { z } from "zod";

import { TOKEN, startFakeCloudflare } from "../cloudflare-testing.ts";
import { loopbackRemoval, loopbackSetup, readLoopback } from "../loopback.ts";
import { TUNNEL_UNCONNECTED } from "../tunnel.ts";

// Each test starts the CLI as its own process, often several times, and on a busy machine each start
// alone can take a second.
setDefaultTimeout(30_000);

const home = await mkdtemp(join(tmpdir(), "evertap-cli-"));
const configDir = join(home, "config", "evertap");
const dataDir = join(home, "data");

// Uninstall would edit this machine's own hosts file and alias, which a test must never do.
const touchesSystem = loopbackRemoval(await readLoopback()).changes.length > 0;
const pointing = loopbackSetup(await readLoopback());
// Whether local mode's setup has anything to ask sudo for on this machine.
const needsSudo = !("refused" in pointing) && pointing.changes.length > 0;

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

const cli = (args: string[]) => [process.execPath, join(import.meta.dir, "..", "main.ts"), ...args];

/** The CLI's environment, with nothing of this machine's own evertap in reach. */
const cliEnv = (env: Record<string, string>) => ({
  PATH: process.env.PATH ?? "",
  HOME: home,
  XDG_CONFIG_HOME: join(home, "config"),
  EVERTAP_DATA_DIR: dataDir,
  EVERTAP_DOCKER_SOCKET: join(home, "docker.sock"),
  ...env,
});

/** Runs the CLI as a person would, with nothing of this machine's own evertap in reach. */
const run = async (args: string[], env: Record<string, string> = {}) => {
  const child = Bun.spawn(cli(args), {
    env: cliEnv(env),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
};

/**
 * Runs the CLI in a terminal, as a person answering its questions: `answer` waits for a question,
 * then types into it.
 */
const inTerminal = (args: string[], env: Record<string, string>) => {
  let output = "";
  let read = 0;
  const decoder = new TextDecoder();
  const child = Bun.spawn(cli(args), {
    env: cliEnv(env),
    terminal: {
      cols: 400,
      rows: 50,
      data: (_, data) => {
        output += decoder.decode(data);
      },
    },
  });
  /** Waits for `text` past what was waited for before. */
  const waitFor = async (text: string) => {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const at = output.indexOf(text, read);
      if (at >= 0) {
        read = at + text.length;
        return;
      }
      if (Date.now() > deadline || child.exitCode !== null) {
        throw new Error(`No ${JSON.stringify(text)} in:\n${output}`);
      }
      await Bun.sleep(20);
    }
  };
  return {
    waitFor,
    answer: async (question: string, typed: string) => {
      await waitFor(question);
      child.terminal?.write(typed);
    },
    /** What it wrote, without its colors and cursor moves. */
    done: async () => {
      const exitCode = await child.exited;
      child.terminal?.close();
      return { exitCode, output: Bun.stripANSI(output).replaceAll("\r", "") };
    },
  };
};

/** The last line setup draws for where evertap is opened from, and for how it reaches Cloudflare. */
const LAST_CHOICE = "or a cloudflared you run";
const LAST_WAY = "as on a VPS where Cloudflare stops the approval";

const signIn = async () => {
  await mkdir(configDir, { recursive: true });
  await writeFile(
    join(configDir, "config.json"),
    JSON.stringify({ url: "http://127.0.0.1:1", token: "token" }),
  );
};

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

describe("arguments", () => {
  test("an unknown option shows the command's usage, not a stack", async () => {
    const { stderr, exitCode } = await run(["list", "--bogus"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown option '--bogus'");
    expect(stderr).toContain("Usage: evertap list [--engine <service>] [--json]");
    expect(stderr).not.toContain("    at ");
  });

  test("an option missing its value shows the command's usage", async () => {
    const { stderr, exitCode } = await run(["connect", "--host"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--host");
    expect(stderr).toContain("Usage: evertap connect");
  });

  test("a missing name or service says what to add", async () => {
    expect((await run(["get"])).stderr).toBe("Name the resource: its name or id\n");
    expect((await run(["create", "postgres"])).stderr).toContain(
      "Usage: evertap create <service> <name>",
    );
  });

  test("--help shows a command's usage instead of running it", async () => {
    expect(await run(["serve", "--help"])).toEqual({
      stdout: "Usage: evertap serve\n  Run evertap on this machine\n",
      stderr: "",
      exitCode: 0,
    });
    const setup = await run(["setup", "--mode", "local", "-h"]);
    expect(setup.exitCode).toBe(0);
    expect(setup.stdout).toStartWith("Usage: evertap setup [--mode local|network|cloudflare]");
  });

  test("an unknown command prints the help and fails", async () => {
    const { stdout, exitCode } = await run(["nope"]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("evertap uninstall [--yes]");
  });
});

describe("signing in", () => {
  test("says to sign in when nothing is set", async () => {
    expect((await run(["list"])).stderr).toBe("Not signed in. Run evertap login <url> first\n");
  });

  test("asks for EVERTAP_URL when only EVERTAP_API_KEY is set", async () => {
    const { stderr } = await run(["list"], { EVERTAP_API_KEY: "key" });
    expect(stderr).toContain("Set EVERTAP_URL");
  });

  test("warns before pairing over plain HTTP", async () => {
    const { stderr, exitCode } = await run(["login", "http://evertap.invalid"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Warning: use https://");
    expect(stderr).toContain("Cannot reach evertap");
  });

  test("does not warn over HTTPS or on this machine", async () => {
    expect((await run(["login", "https://evertap.invalid"])).stderr).not.toContain("Warning");
    expect((await run(["login", "localhost:1"])).stderr).not.toContain("Warning");
  });

  test("says how to trust a self-signed certificate, without a stack", async () => {
    const cert = join(home, "cert.pem");
    const key = join(home, "key.pem");
    const openssl = Bun.spawnSync(
      [
        "openssl",
        "req",
        "-x509",
        // Not RSA: its key takes up to half a second to make, and far longer on a busy machine.
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
        "-keyout",
        key,
        "-out",
        cert,
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    expect(openssl.exitCode).toBe(0);
    let reached = 0;
    const site = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      tls: { cert: Bun.file(cert), key: Bun.file(key) },
      fetch: () => {
        reached++;
        return new Response("Not evertap", { status: 404 });
      },
    });
    try {
      const { stderr, exitCode } = await run(["login", site.url.origin]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Set NODE_EXTRA_CA_CERTS");
      expect(stderr).not.toContain("    at ");
      expect(reached).toBe(0);
      // The step it names is enough for the request to get through.
      await run(["login", site.url.origin], { NODE_EXTRA_CA_CERTS: cert });
      expect(reached).toBe(1);
    } finally {
      void site.stop(true);
    }
  });

  test("refuses what cannot be an address", async () => {
    expect((await run(["login", "not an address"])).stderr).toContain(
      "not an address is not an address",
    );
  });
});

test("connect explains an address this machine does not have", async () => {
  await signIn();
  // 192.0.2.0/24 is reserved for documentation, so no machine has it.
  const { stderr, exitCode } = await run(["connect", "--host", "192.0.2.1"]);
  expect(exitCode).toBe(1);
  expect(stderr).toContain("192.0.2.1 is not an address of this machine");
});

describe("setup and open", () => {
  const machineDir = join(home, "machine");
  const bin = join(home, "bin");
  const opened = join(home, "opened.txt");
  const sudoArgs = join(home, "sudo-args");
  const sudoInput = join(home, "sudo-input");
  const sudoFails = join(home, "sudo-fails");
  const environment: SettingsEnvironment = {
    env: {},
    port: 8080,
    publicStoragePort: 9900,
    lanAddress: () => "192.168.1.20",
    lanName: "evertap.local",
    dockerAddress: () => null,
    publicAddresses: () => [],
  };
  const newStore = () =>
    createMemoryStore({
      version: "1.2.3",
      host: "evertap.local",
      port: 6432,
      settings: environment,
      machine: () =>
        Promise.resolve({
          disk: { totalBytes: 1000, freeBytes: 500 },
          memory: { totalBytes: 2000, freeBytes: 1500 },
          cpu: { usedRatio: 0.25, cores: 4 },
        }),
    });
  let store = newStore();
  // evertap serve's socket, answering with the real router as the CLI on this machine.
  const handler = new RPCHandler<Context>(appRouter);
  let serve: Server<undefined> | undefined;
  const onMachine = { EVERTAP_DATA_DIR: machineDir, PATH: `${bin}:${process.env.PATH ?? ""}` };

  /** The link a browser on this machine was opened at; the CLI does not wait for it. */
  const openedLink = async () => {
    for (let tries = 0; tries < 60 && !(await exists(opened)); tries++) {
      await Bun.sleep(50);
    }
    return (await Bun.file(opened).text()).trim();
  };

  beforeAll(async () => {
    await mkdir(machineDir, { recursive: true });
    serve = Bun.serve({
      unix: join(machineDir, "evertap.sock"),
      fetch: async (request) => {
        const { saved } = await store.settings();
        const { response } = await handler.handle(request, {
          prefix: "/api/client/rpc",
          context: {
            store,
            caller: { kind: "local" },
            origin: resolveSettings(saved, environment).publicUrl.value ?? undefined,
          },
        });
        return response ?? new Response(null, { status: 404 });
      },
    });
    await mkdir(bin, { recursive: true });
    // Stand-ins for the commands that open a browser, noting the link instead.
    for (const name of ["xdg-open", "open"]) {
      // Moved into place once written, so the test never reads it half written.
      await writeFile(
        join(bin, name),
        `#!/bin/sh\necho "$1" > "${opened}.part"\nmv "${opened}.part" "${opened}"\n`,
        { mode: 0o755 },
      );
    }
    // Notes what setup would run as root, so this machine's hosts file and loopback stay as they are.
    await writeFile(
      join(bin, "sudo"),
      `#!/bin/sh\nprintf '%s\\0' "$@" > "${sudoArgs}"\ncat > "${sudoInput}"\n[ ! -e "${sudoFails}" ]\n`,
      { mode: 0o755 },
    );
  });

  beforeEach(async () => {
    store = newStore();
    environment.env = {};
    environment.dockerAddress = () => null;
    environment.publicAddresses = () => [];
    for (const path of [opened, sudoArgs, sudoInput, sudoFails]) {
      await rm(path, { force: true });
    }
  });

  /** What setup ran as root, or null. */
  const asRoot = async () =>
    (await exists(sudoArgs))
      ? {
          args: (await Bun.file(sudoArgs).text()).split("\0").slice(0, -1),
          input: await Bun.file(sudoInput).text(),
        }
      : null;

  afterAll(async () => {
    await serve?.stop(true);
  });

  test("connect on the machine running evertap points at local mode", async () => {
    const { stderr, exitCode } = await run(["connect"], onMachine);
    expect(exitCode).toBe(1);
    expect(stderr).toBe(
      "evertap connect is for other machines. For apps on this one to reach ev.internal, choose This computer only: run evertap setup --mode local\n",
    );
  });

  test("points browsers on the home network at this machine's address", async () => {
    const { stdout, exitCode } = await run(
      ["setup", "--mode", "network", "--listen", "0.0.0.0"],
      onMachine,
    );
    expect(exitCode).toBe(0);
    expect((await store.settings()).saved).toEqual({
      mode: "network",
      listenHost: "0.0.0.0",
      publicUrl: null,
      storageUrl: null,
    });
    expect(stdout).toContain("Saved. Browsers open evertap at http://192.168.1.20:8080\n");
    expect(stdout).toContain("http://192.168.1.20:8080/signin#");
  });

  test("takes the address a proxy serves evertap at, and keeps it on the next run", async () => {
    const first = await run(
      ["setup", "--mode", "network", "--url", "evertap.example.com"],
      onMachine,
    );
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain("https://evertap.example.com/signin#");
    const second = await run(["setup", "--mode", "network", "--listen", "0.0.0.0"], onMachine);
    expect(second.exitCode).toBe(0);
    expect((await store.settings()).saved).toEqual({
      mode: "network",
      listenHost: "0.0.0.0",
      publicUrl: "https://evertap.example.com",
      storageUrl: null,
    });
  });

  test("shows what to paste into the proxy, then checks the address reaches evertap", async () => {
    const { stdout, stderr, exitCode } = await run(
      ["setup", "--mode", "network", "--url", "https://evertap.example.com"],
      onMachine,
    );
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain(
      "Have your proxy pass requests on to 127.0.0.1:8080. For Caddy, in its Caddyfile:\n\nhttps://evertap.example.com {\n",
    );
    expect(stdout).toContain("For nginx:\n\n# In nginx's http block");
    expect(stdout).toContain("Checked: https://evertap.example.com reaches this evertap\n");
    // On a LAN browsers reach evertap itself, with nothing to paste.
    store = newStore();
    const lan = await run(["setup", "--mode", "network", "--listen", "0.0.0.0"], onMachine);
    expect(lan.stdout).not.toContain("Caddyfile");
    expect(lan.stdout).toContain("Checked: http://192.168.1.20:8080 reaches this evertap\n");
  });

  test("says what the proxy should change, without failing setup", async () => {
    store.probe = () =>
      Promise.resolve({
        answered: true,
        status: 200,
        arrival: { host: "evertap.example.com", forwardedFor: null, forwardedProto: "https" },
        upgrades: false,
      });
    const { stderr, exitCode } = await run(
      ["setup", "--mode", "network", "--url", "https://evertap.example.com"],
      onMachine,
    );
    expect(exitCode).toBe(0);
    expect(stderr).toStartWith(
      "https://evertap.example.com reaches this evertap, but:\n  Have your proxy add X-Forwarded-For.",
    );
    expect(stderr).toContain("  Have your proxy pass WebSocket upgrades on");
  });

  test("listens on Docker's bridge for a proxy run with Docker", async () => {
    environment.dockerAddress = () => "172.17.0.1";
    const missing = await run(["setup", "--mode", "network", "--listen", "172.17.0.1"], onMachine);
    expect(missing.stderr).toStartWith(
      "Add --url with the address your proxy or tunnel serves evertap at",
    );
    const { stdout, exitCode } = await run(
      ["setup", "--mode", "network", "--listen", "172.17.0.1", "--url", "evertap.example.com"],
      onMachine,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Have your proxy pass requests on to 172.17.0.1:8080.");
  });

  test("warns that every interface opens evertap to the internet on a public address", async () => {
    environment.publicAddresses = () => ["203.0.113.5"];
    const { stderr, exitCode } = await run(
      ["setup", "--mode", "network", "--listen", "0.0.0.0"],
      onMachine,
    );
    expect(exitCode).toBe(0);
    expect(stderr).toBe(
      "Warning: 203.0.113.5 is a public address: anyone on the internet can open evertap there, unencrypted. Block that in your firewall, or use a proxy with HTTPS\n",
    );
    const behind = await run(
      ["setup", "--mode", "network", "--listen", "127.0.0.1", "--url", "evertap.example.com"],
      onMachine,
    );
    expect(behind.stderr).toBe("");
  });

  test("asks for the address when nothing else reaches evertap", async () => {
    const network = await run(["setup", "--mode", "network"], onMachine);
    expect(network.exitCode).toBe(1);
    expect(network.stderr).toBe(
      "Add --url with the address your proxy or tunnel serves evertap at, or --listen 0.0.0.0 for devices on your network\n",
    );
    expect((await run(["setup", "--mode", "cloudflare"], onMachine)).stderr).toBe(
      "Run evertap setup in a terminal to approve evertap in Cloudflare, or set CLOUDFLARE_API_TOKEN to a Cloudflare API token for evertap to create the tunnel with\n",
    );
    // A tunnel the person runs is their own proxy, in network mode.
    const own = ["setup", "--mode", "cloudflare", "--url", "https://evertap.example.com"];
    expect((await run(own, onMachine)).stderr).toBe(
      "Drop --url: the tunnel evertap runs opens evertap at the name you give it. For a tunnel you run yourself, use --mode network --url <address>\n",
    );
    expect((await store.settings()).saved).toBeNull();
  });

  test("keeps the address buckets are served at, and shows what to paste for it", async () => {
    const flags = ["setup", "--mode", "network", "--url", "https://evertap.example.com"];
    const { stdout, exitCode } = await run([...flags, "--s3-url", "s3.example.com"], onMachine);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(
      "For buckets reached from anywhere, have it serve https://s3.example.com from 127.0.0.1:9900. For Caddy:\n\nhttps://s3.example.com {\n",
    );
    expect(stdout).toContain("# Buckets reached from anywhere, at an address of their own");
    // Kept when setup runs again without it.
    expect((await run(flags, onMachine)).exitCode).toBe(0);
    expect((await store.settings()).saved).toMatchObject({ storageUrl: "https://s3.example.com" });
    expect((await run([...flags, "--s3-url", "https://s3.example.com/b"], onMachine)).stderr).toBe(
      "--s3-url: Give the address without a path, such as https://s3.example.com\n",
    );
  });

  test("lets a bucket's signed links work anywhere, and back", async () => {
    await store.saveSettings({
      mode: "network",
      publicUrl: "https://evertap.example.com",
      listenHost: "127.0.0.1",
      storageUrl: "https://s3.example.com",
    });
    await store.createResource({
      engine: "garage",
      name: "photos",
      description: "",
      extensions: [],
      temporary: false,
    });
    const on = await run(["reachable", "photos"], onMachine);
    expect(on.stdout).toBe(
      "Signed links to photos work on any device. Objects still need a signature.\nSign links with a second client on S3_PUBLIC_ENDPOINT=https://s3.example.com, and keep the endpoint for every other call\n",
    );
    expect((await run(["env", "photos"], onMachine)).stdout).toContain(
      "S3_PUBLIC_ENDPOINT=https://s3.example.com\n",
    );
    const off = await run(["reachable", "photos", "--off"], onMachine);
    expect(off.stdout).toBe("Signed links to photos work only through evertap connect again\n");
    expect((await run(["get", "photos"], onMachine)).stdout).toContain("From anywhere  no\n");
  });

  test("says what to give without a terminal to ask in", async () => {
    expect((await run(["setup"], onMachine)).stderr).toBe(
      "Add --mode local, network, or cloudflare, or run evertap setup in a terminal to be asked\n",
    );
    expect((await run(["setup", "--mode", "lan"], onMachine)).stderr).toBe(
      "Choose --mode local, network, or cloudflare\n",
    );
    expect(
      (
        await run(
          ["setup", "--mode", "network", "--url", "https://evertap.example.com/ui"],
          onMachine,
        )
      ).stderr,
    ).toBe("--url: Give the address without a path, such as https://evertap.example.com\n");
    expect((await run(["setup", "--mode", "local", "--listen", "0.0.0.0"], onMachine)).stderr).toBe(
      "Drop --url, --listen, --zone, and --s3-url: --mode local takes none of them\n",
    );
    expect((await store.settings()).saved).toBeNull();
  });

  test("leaves what an environment variable sets to it", async () => {
    environment.env = { mode: "network" };
    const refused = await run(["setup", "--mode", "local"], onMachine);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toBe("EVERTAP_MODE sets this where evertap runs. Change it there\n");
    expect((await store.settings()).saved).toBeNull();
    expect(await asRoot()).toBeNull();
    // The mode it sets needs no flag.
    expect((await run(["setup", "--listen", "0.0.0.0"], onMachine)).exitCode).toBe(0);
    expect((await store.settings()).saved).toEqual({
      mode: "network",
      listenHost: "0.0.0.0",
      publicUrl: null,
      storageUrl: null,
    });
  });

  test("opens a signed-in browser here in local mode", async () => {
    const { stdout, exitCode } = await run(["setup", "--mode", "local"], onMachine);
    expect(exitCode).toBe(0);
    expect((await store.settings()).saved).toEqual({ mode: "local" });
    const link = await openedLink();
    expect(link).toStartWith("http://ev.internal:8080/signin#");
    expect(stdout).toContain(link);
  });

  test("points ev.internal here with one sudo before it saves local mode", async () => {
    const setup = loopbackSetup(await readLoopback());
    if ("refused" in setup) {
      throw new Error(setup.refused);
    }
    const { stdout, exitCode } = await run(["setup", "--mode", "local"], onMachine);
    expect(exitCode).toBe(0);
    expect(await asRoot()).toEqual(
      setup.changes.length > 0 ? { args: ["sh", "-c", setup.script], input: setup.input } : null,
    );
    if (setup.changes.length > 0) {
      expect(stdout).toContain(
        `So ev.internal reaches evertap, setup makes these changes with sudo:\n  ${setup.changes[0]}`,
      );
      expect(stdout).toContain("ev.internal now leads to evertap.\n");
    }
    expect(stdout).toContain(
      'While evertap runs, programs that listen on 5432, 3306, 6379, 3900, 8080 on all addresses may fail to start. In Compose, publish them on 127.0.0.1, such as "127.0.0.1:5432:5432".',
    );
  });

  test.skipIf(!needsSudo)(
    "saves nothing when sudo fails, and says what to change by hand",
    async () => {
      await writeFile(sudoFails, "");
      const { stderr, exitCode } = await run(["setup", "--mode", "local"], onMachine);
      expect(exitCode).toBe(1);
      expect(stderr).toContain(
        'Could not finish with sudo, so nothing was saved. Make these changes as administrator, then run evertap setup again:\n  Add "127.77.0.1 ev.internal"',
      );
      expect((await store.settings()).saved).toBeNull();
    },
  );

  test("undoes what local mode set up once another mode is in force", async () => {
    expect((await run(["setup", "--mode", "local"], onMachine)).exitCode).toBe(0);
    await rm(sudoArgs, { force: true });
    const removal = loopbackRemoval(await readLoopback());
    const moved = await run(["setup", "--mode", "network", "--listen", "0.0.0.0"], onMachine);
    expect(moved.exitCode).toBe(0);
    expect(await asRoot()).toEqual(
      removal.changes.length > 0
        ? { args: ["sh", "-c", removal.script], input: removal.input }
        : null,
    );
    if (removal.changes.length > 0) {
      expect(moved.stdout).toContain("ev.internal no longer leads here.\n");
    }
  });

  test("sends no laptop to sign in again at the address only this machine opens", async () => {
    const lan = await run(["setup", "--mode", "network", "--listen", "0.0.0.0"], onMachine);
    expect(lan.exitCode).toBe(0);
    const { stdout, exitCode } = await run(["setup", "--mode", "local"], onMachine);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Saved. Browsers open evertap at http://ev.internal:8080\n");
    expect(stdout).not.toContain("evertap login");
    expect(stdout).not.toContain("EVERTAP_URL");
  });

  describe("asked in a terminal", () => {
    const viaTerminal = () => inTerminal(["setup"], onMachine);

    test("offers the four choices with the address each opens, and asks nothing more for the network", async () => {
      const setup = viaTerminal();
      await setup.waitFor("? Where will you open evertap from?");
      await setup.answer(LAST_CHOICE, "j\r");
      await setup.answer("? Save and apply now? (Y/n) ", "\r");
      const { exitCode, output } = await setup.done();
      expect(exitCode).toBe(0);
      expect(output).toMatch(/This computer only +\(http:\/\/ev\.internal:8080\)\n/);
      expect(output).toMatch(/Devices on your network +\(http:\/\/192\.168\.1\.20:8080\)\n/);
      expect(output).toContain("Anywhere, through Cloudflare\n");
      expect(output).toContain("Behind your own proxy or tunnel\n");
      expect((await store.settings()).saved).toEqual({
        mode: "network",
        listenHost: "0.0.0.0",
        publicUrl: null,
        storageUrl: null,
      });
    });

    test("asks where a proxy or tunnel runs and the address it serves, then what to paste", async () => {
      environment.dockerAddress = () => "172.17.0.1";
      const setup = viaTerminal();
      await setup.answer(LAST_CHOICE, "jjj\r");
      await setup.answer("where a container reaches this machine", "j\r");
      await setup.answer(
        "? Address your proxy or tunnel serves evertap at, such as https://evertap.example.com: ",
        "evertap.example.com\r",
      );
      await setup.answer("? Save and apply now? (Y/n) ", "\r");
      await setup.answer("? Press Enter once your proxy uses it, to check the address: ", "\r");
      const { exitCode, output } = await setup.done();
      expect(exitCode).toBe(0);
      expect(output).toContain("Have your proxy pass requests on to 172.17.0.1:8080.");
      expect((await store.settings()).saved).toEqual({
        mode: "network",
        listenHost: "172.17.0.1",
        publicUrl: "https://evertap.example.com",
        storageUrl: null,
      });
    });

    test("offers only what an environment variable leaves to choose", async () => {
      environment.env = { mode: "network" };
      const setup = viaTerminal();
      // Nothing saved listens on 127.0.0.1, as behind a proxy.
      await setup.answer(LAST_CHOICE, "k\r");
      await setup.answer("? Save and apply now? (Y/n) ", "\r");
      const { exitCode, output } = await setup.done();
      expect(exitCode).toBe(0);
      expect(output).not.toContain("This computer only");
      expect(output).not.toContain("Anywhere, through Cloudflare");
      expect((await store.settings()).saved).toMatchObject({ listenHost: "0.0.0.0" });
    });
  });

  describe("a Cloudflare Tunnel evertap creates", () => {
    const fake = startFakeCloudflare();
    const cloudflare = fake.state;
    const { made } = fake;
    const token = TOKEN;
    const withToken = (more: Record<string, string> = {}) => ({
      ...onMachine,
      ...fake.env,
      CLOUDFLARE_API_TOKEN: token,
      ...more,
    });

    beforeEach(() => {
      fake.reset();
    });

    afterAll(async () => {
      await fake.stop();
    });

    test("creates the tunnel, its routes, DNS records, and Cache Rule, and keeps only what runs it", async () => {
      const { stdout, stderr, exitCode } = await run(
        ["setup", "--mode", "cloudflare", "--zone", "example.com"],
        withToken(),
      );
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      const [tunnel] = cloudflare.tunnels.values();
      expect(made()).toEqual({
        tunnels: [
          {
            name: "evertap",
            config: {
              ingress: [
                { hostname: "evertap.example.com", service: "http://127.0.0.1:8080" },
                { hostname: "s3.example.com", service: "http://127.0.0.1:9900" },
                { service: "http_status:404" },
              ],
            },
          },
        ],
        records: ["evertap.example.com", "s3.example.com"].map((name) => ({
          zone: "zone-1",
          name,
          type: "CNAME",
          content: `${tunnel?.id}.cfargotunnel.com`,
          proxied: true,
        })),
        rules: [
          {
            zone: "zone-1",
            ref: "evertap_s3_bypass",
            expression: '(http.host eq "s3.example.com")',
          },
        ],
      });
      const { saved } = await store.settings();
      expect(saved).toMatchObject({
        mode: "cloudflare",
        publicUrl: "https://evertap.example.com",
        tunnel: {
          id: tunnel?.id,
          accountId: "account-1",
          zoneId: "zone-1",
          zone: "example.com",
          token: `run-${tunnel?.id}`,
        },
      });
      expect(JSON.stringify(saved)).not.toContain(token);
      expect(stdout).toContain("Saved. Browsers open evertap at https://evertap.example.com\n");
      expect(stdout).toContain("The tunnel is connected to Cloudflare.\n");
      expect(stdout).toContain("Checked: https://evertap.example.com reaches this evertap\n");
      expect(stdout).toContain("https://evertap.example.com/signin#");
    });

    test("runs again without making a second of anything, and keeps the tunnel without a token", async () => {
      const args = ["setup", "--mode", "cloudflare", "--zone", "example.com"];
      expect((await run(args, withToken())).exitCode).toBe(0);
      const first = made();
      const saved = (await store.settings()).saved;
      expect((await run(args, withToken())).exitCode).toBe(0);
      expect(made()).toEqual(first);
      expect((await store.settings()).saved).toEqual(saved);
      expect(cloudflare.calls.filter((call) => /^(POST|PUT .*entrypoint)/.test(call))).toEqual([
        "POST /accounts/account-1/cfd_tunnel",
        "POST /zones/zone-1/dns_records",
        "POST /zones/zone-1/dns_records",
        "PUT /zones/zone-1/rulesets/phases/http_request_cache_settings/entrypoint",
      ]);

      cloudflare.calls = [];
      const kept = await run(["setup", "--mode", "cloudflare"], onMachine);
      expect(kept.exitCode).toBe(0);
      expect(kept.stdout).toContain(
        "Kept as it is. Browsers open evertap at https://evertap.example.com\n",
      );
      expect(cloudflare.calls).toEqual([]);
      expect((await store.settings()).saved).toEqual(saved);
      const elsewhere = await run(
        ["setup", "--mode", "cloudflare", "--zone", "example.net"],
        onMachine,
      );
      expect(elsewhere.stderr).toBe(
        "Set CLOUDFLARE_API_TOKEN to a Cloudflare API token to set the tunnel up again, or run evertap setup in a terminal to approve evertap in Cloudflare\n",
      );
      expect((await store.settings()).saved).toEqual(saved);
    });

    test("points records an earlier setup made at the new tunnel, as after a lost data directory", async () => {
      for (const name of ["evertap.example.com", "s3.example.com"]) {
        cloudflare.records.set(name, {
          id: name,
          zone: "zone-1",
          name,
          type: "CNAME",
          content: "deleted-tunnel.cfargotunnel.com",
          proxied: true,
          comment: "evertap",
        });
      }
      const { exitCode } = await run(
        ["setup", "--mode", "cloudflare", "--zone", "example.com"],
        withToken(),
      );
      expect(exitCode).toBe(0);
      const [tunnel] = cloudflare.tunnels.keys();
      expect(
        [...cloudflare.records.values()].map((record) => ({
          id: record.id,
          content: record.content,
        })),
      ).toEqual([
        { id: "evertap.example.com", content: `${tunnel}.cfargotunnel.com` },
        { id: "s3.example.com", content: `${tunnel}.cfargotunnel.com` },
      ]);
    });

    test("moves to another domain and removes the names it no longer uses", async () => {
      expect(
        (await run(["setup", "--mode", "cloudflare", "--zone", "example.com"], withToken()))
          .exitCode,
      ).toBe(0);
      const moved = await run(
        ["setup", "--mode", "cloudflare", "--zone", "example.net"],
        withToken(),
      );
      expect(moved.exitCode).toBe(0);
      expect(made().tunnels).toHaveLength(1);
      expect(made().records.map(({ zone, name }) => `${zone} ${name}`)).toEqual([
        "zone-2 evertap.example.net",
        "zone-2 s3.example.net",
      ]);
      expect(made().rules.map(({ zone }) => zone)).toEqual(["zone-2"]);
      expect((await store.settings()).saved).toMatchObject({
        publicUrl: "https://evertap.example.net",
      });
    });

    test("removes the DNS records, Cache Rule, and tunnel once another mode is in force", async () => {
      expect(
        (await run(["setup", "--mode", "cloudflare", "--zone", "example.com"], withToken()))
          .exitCode,
      ).toBe(0);
      const tunnel = [...cloudflare.tunnels.keys()][0];
      cloudflare.calls = [];
      const { stdout, exitCode } = await run(
        ["setup", "--mode", "network", "--listen", "0.0.0.0"],
        withToken(),
      );
      expect(exitCode).toBe(0);
      expect(made()).toEqual({ tunnels: [], records: [], rules: [] });
      expect(stdout).toContain(
        "Removed the tunnel, its DNS records, and its Cache Rule from Cloudflare.\n",
      );
      const removals = cloudflare.calls.filter((call) => call.startsWith("DELETE"));
      expect(removals.slice(-2)).toEqual([
        `DELETE /accounts/account-1/cfd_tunnel/${tunnel}/connections`,
        `DELETE /accounts/account-1/cfd_tunnel/${tunnel}`,
      ]);
      expect((await store.settings()).saved).toMatchObject({ mode: "network" });
    });

    test("says what to remove by hand when no token comes to remove it", async () => {
      expect(
        (await run(["setup", "--mode", "cloudflare", "--zone", "example.com"], withToken()))
          .exitCode,
      ).toBe(0);
      const { stderr, exitCode } = await run(["setup", "--mode", "local"], onMachine);
      expect(exitCode).toBe(0);
      expect(stderr).toContain(
        [
          "Remove what evertap made in Cloudflare yourself:",
          "  The tunnel evertap, under Networking → Tunnels: https://dash.cloudflare.com/account-1/tunnels",
          "  The DNS records evertap.example.com and s3.example.com, under DNS for example.com: https://dash.cloudflare.com/account-1/example.com/dns/records",
          "  The Cache Rule for s3.example.com, under Caching → Cache Rules for example.com: https://dash.cloudflare.com/account-1/example.com/caching/cache-rules",
          "",
        ].join("\n"),
      );
      expect(made().tunnels).toHaveLength(1);
      expect((await store.settings()).saved).toEqual({ mode: "local" });
    });

    test("stops before making anything when it cannot finish", async () => {
      const refused = async (args: string[], env: Record<string, string>) => {
        const { stderr, exitCode } = await run(["setup", "--mode", "cloudflare", ...args], env);
        expect(exitCode).toBe(1);
        expect((await store.settings()).saved).toBeNull();
        return stderr;
      };
      expect(await refused([], withToken({ CLOUDFLARE_API_TOKEN: "cfut_wrong" }))).toBe(
        "CLOUDFLARE_API_TOKEN: That token isn't valid. Copy it again from Cloudflare, or make a new one\n",
      );
      expect(await refused([], withToken())).toBe(
        "Add --zone with the domain for evertap: example.com, example.net\n",
      );
      cloudflare.failing = { path: /verify/, status: 500 };
      expect(await refused([], withToken())).toBe(
        "CLOUDFLARE_API_TOKEN: Cloudflare could not check the token. Try again in a minute\n",
      );
      cloudflare.failing = null;
      expect(await refused(["--zone", "example.org"], withToken())).toBe(
        "--zone: the token reaches no domain named example.org. It reaches example.com, example.net\n",
      );
      cloudflare.records.set("mine", {
        id: "mine",
        zone: "zone-1",
        name: "s3.example.com",
        type: "A",
        content: "203.0.113.9",
        proxied: false,
      });
      expect(await refused(["--zone", "example.com"], withToken())).toBe(
        "s3.example.com already has a DNS record of yours. Remove it in Cloudflare, or choose another name\n",
      );
      // A tunnel of the person's own, such as one for their MinIO, keeps its name.
      cloudflare.records.set("mine", {
        id: "mine",
        zone: "zone-1",
        name: "s3.example.com",
        type: "CNAME",
        content: "theirs.cfargotunnel.com",
        proxied: true,
        comment: null,
      });
      expect(await refused(["--zone", "example.com"], withToken())).toBe(
        "s3.example.com already has a DNS record of yours. Remove it in Cloudflare, or choose another name\n",
      );
      expect(cloudflare.records.get("mine")?.content).toBe("theirs.cfargotunnel.com");
      cloudflare.records.clear();
      cloudflare.tunnels.set("elsewhere", { id: "elsewhere", name: "evertap", status: "healthy" });
      expect(await refused(["--zone", "example.com"], withToken())).toContain(
        "A tunnel named evertap already runs in this Cloudflare account",
      );
      expect(made().records).toEqual([]);
      cloudflare.tunnels.clear();
      environment.env = { publicUrl: "https://evertap.example.org" };
      expect(await refused(["--zone", "example.com"], withToken())).toBe(
        "EVERTAP_PUBLIC_URL sets this where evertap runs. Change it there\n",
      );
      expect(made()).toEqual({ tunnels: [], records: [], rules: [] });
    });

    test("saves nothing when the tunnel does not connect", async () => {
      const save = store.saveSettings;
      store.saveSettings = (saved) =>
        saved.mode === "cloudflare"
          ? Promise.reject(new DataError(TUNNEL_UNCONNECTED))
          : save(saved);
      const { stderr, exitCode } = await run(
        ["setup", "--mode", "cloudflare", "--zone", "example.com"],
        withToken(),
      );
      expect(exitCode).toBe(1);
      expect(stderr).toBe(`${TUNNEL_UNCONNECTED}\n`);
      expect((await store.settings()).saved).toBeNull();
    });

    test("names the permission the token lacks", async () => {
      cloudflare.failing = { path: /\/rulesets\//, status: 403 };
      const { stderr, exitCode } = await run(
        ["setup", "--mode", "cloudflare", "--zone", "example.com"],
        withToken(),
      );
      expect(exitCode).toBe(1);
      expect(stderr).toBe(
        "The token can't add a Cache Rule to example.com. Give it Zone · Cache Rules · Edit in Cloudflare, or make a new one with the link setup shows\n",
      );
    });

    describe("with access approved in Cloudflare", () => {
      const viaTerminal = () => inTerminal(["setup"], { ...onMachine, ...fake.env });
      const allGivenBack = () =>
        fake.state.access.size > 0 &&
        [...fake.state.access.values()].every((access) => access.revoked);

      /** Approves evertap where setup opened this machine's browser, and pastes the code back. */
      const pasteApproval = async (setup: ReturnType<typeof viaTerminal>) => {
        await setup.waitFor("? Paste the code, or press Enter to stop: ");
        const pasted = await fake.approve(await openedLink());
        await setup.answer("", `${pasted}\r`);
      };

      const setUpWithToken = async () => {
        const { exitCode } = await run(
          ["setup", "--mode", "cloudflare", "--zone", "example.com"],
          withToken(),
        );
        expect(exitCode).toBe(0);
        fake.state.calls = [];
      };

      test("makes the tunnel at the names the person gives, then gives the access back", async () => {
        const setup = viaTerminal();
        await setup.answer(LAST_CHOICE, "jj\r");
        await setup.answer(LAST_WAY, "\r");
        await setup.answer("? Name for evertap, such as evertap.example.com: ", "Db.Example.com\r");
        await setup.answer("(Enter for s3.example.com): ", "files.example.net\r");
        await setup.answer("(Enter for s3.example.com): ", "files.example.com\r");
        await pasteApproval(setup);
        await setup.answer("? Save and apply now? (Y/n) ", "\r");
        const { exitCode, output } = await setup.done();
        expect(exitCode).toBe(0);
        expect(output).toContain("  Give buckets a name in example.com, such as s3.example.com\n");
        const [tunnel] = cloudflare.tunnels.values();
        expect(
          made().records.map(({ zone, name, content }) => `${zone} ${name} ${content}`),
        ).toEqual(
          ["db.example.com", "files.example.com"].map(
            (name) => `zone-1 ${name} ${tunnel?.id}.cfargotunnel.com`,
          ),
        );
        expect(made().rules).toHaveLength(1);
        expect((await store.settings()).saved).toMatchObject({
          mode: "cloudflare",
          publicUrl: "https://db.example.com",
          tunnel: {
            id: tunnel?.id,
            zone: "example.com",
            hostnames: { ui: "db.example.com", storage: "files.example.com" },
            token: `run-${tunnel?.id}`,
          },
        });
        expect(output).toContain("The tunnel is connected to Cloudflare.\n");
        expect(output).toContain(
          "evertap gave back the access you approved in Cloudflare, and kept none of it.\n",
        );
        expect(output).toContain("Checked: https://db.example.com reaches this evertap\n");
        expect(output).toContain("https://db.example.com/signin#");
        expect(allGivenBack()).toBe(true);
        expect(output).not.toContain("ory_at_");
      });

      test("moves the tunnel to another domain and removes what the old one used", async () => {
        await setUpWithToken();
        const setup = viaTerminal();
        await setup.answer(LAST_CHOICE, "\r");
        await setup.answer("Set it up again with an API token", "j\r");
        await setup.answer("(Enter for evertap.example.com): ", "evertap.example.net\r");
        await setup.answer("(Enter for s3.example.net): ", "\r");
        await pasteApproval(setup);
        await setup.answer("? Save and apply now? (Y/n) ", "\r");
        const { exitCode, output } = await setup.done();
        expect(exitCode).toBe(0);
        expect(made().tunnels).toHaveLength(1);
        expect(made().records.map(({ zone, name }) => `${zone} ${name}`)).toEqual([
          "zone-2 evertap.example.net",
          "zone-2 s3.example.net",
        ]);
        expect(made().rules.map(({ zone }) => zone)).toEqual(["zone-2"]);
        expect(output).toContain(
          "Removed from Cloudflare what evertap made for example.com and no longer uses.\n",
        );
        expect(output).toContain(
          "  Buckets reached from anywhere move to https://s3.example.net. Change S3_PUBLIC_ENDPOINT in each .env you copied for one.\n",
        );
        expect(output).toContain(
          "Every CLI that uses https://evertap.example.com can no longer reach evertap there. On each laptop, run:\n  evertap login https://evertap.example.net\nWith an API key, as in CI, set EVERTAP_URL=https://evertap.example.net\n",
        );
        expect(allGivenBack()).toBe(true);
      });

      test("asks for the names with an API token too", async () => {
        const setup = viaTerminal();
        await setup.answer(LAST_CHOICE, "jj\r");
        await setup.answer(LAST_WAY, "j\r");
        await setup.answer("? Paste the token: ", `${token}\r`);
        // The token reaches two domains, so there is no name to offer.
        await setup.answer("? Name for evertap, such as evertap.example.com: ", "db.example.net\r");
        await setup.answer("(Enter for s3.example.net): ", "\r");
        await setup.answer("? Save and apply now? (Y/n) ", "\r");
        const { exitCode, output } = await setup.done();
        expect(exitCode).toBe(0);
        expect(made().records.map(({ zone, name }) => `${zone} ${name}`)).toEqual([
          "zone-2 db.example.net",
          "zone-2 s3.example.net",
        ]);
        expect(output).toContain("evertap is done with the token and did not keep it");
        expect(fake.state.calls.filter((call) => call.includes("oauth2"))).toEqual([]);
      });

      test("removes the tunnel once another mode is in force", async () => {
        await setUpWithToken();
        const setup = viaTerminal();
        await setup.answer(LAST_CHOICE, "k\r");
        await setup.answer("? Save and apply now? (Y/n) ", "\r");
        await setup.answer("Setup lists what to remove there yourself", "\r");
        await pasteApproval(setup);
        const { exitCode, output } = await setup.done();
        expect(exitCode).toBe(0);
        expect(output).toContain("evertap no longer runs its tunnel to example.com.\n");
        expect(made()).toEqual({ tunnels: [], records: [], rules: [] });
        expect(output).toContain(
          "Removed the tunnel, its DNS records, and its Cache Rule from Cloudflare.\n",
        );
        expect(allGivenBack()).toBe(true);
        expect((await store.settings()).saved).toMatchObject({ mode: "network" });
      });

      test("leaves the tunnel in Cloudflare, saying where to remove it", async () => {
        await setUpWithToken();
        const before = made();
        const setup = viaTerminal();
        await setup.answer(LAST_CHOICE, "kk\r");
        await setup.answer("? Save and apply now? (Y/n) ", "\r");
        await setup.answer("Setup lists what to remove there yourself", "jj\r");
        const { exitCode, output } = await setup.done();
        expect(exitCode).toBe(0);
        expect(output).toContain(
          "Remove what evertap made in Cloudflare yourself:\n  The tunnel evertap, under Networking → Tunnels: https://dash.cloudflare.com/account-1/tunnels\n",
        );
        expect(made()).toEqual(before);
        expect(fake.state.calls.filter((call) => call.includes("oauth2"))).toEqual([]);
        expect((await store.settings()).saved).toEqual({ mode: "local" });
      });
    });
  });

  test("open signs in the browser it opens", async () => {
    const { stdout, exitCode } = await run(["open"], onMachine);
    expect(exitCode).toBe(0);
    const link = await openedLink();
    expect(stdout).toContain(`${link}\n`);
    const [, requestId = ""] = link.split("#");
    expect((await store.claimPairing(requestId)).status).toBe("approved");
  });

  test("says when no browser opened, and gives the link to open instead", async () => {
    const noBrowser = join(home, "no-browser");
    await mkdir(noBrowser, { recursive: true });
    for (const name of ["xdg-open", "open"]) {
      await writeFile(join(noBrowser, name), "#!/bin/sh\nexit 3\n", { mode: 0o755 });
    }
    const { stdout, exitCode } = await run(["open"], {
      ...onMachine,
      PATH: `${noBrowser}:${onMachine.PATH}`,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain(
      "No browser opened on this machine. Open this link in a browser on it to sign in;",
    );
    expect(stdout).toContain("/signin#");
    expect(await exists(opened)).toBe(false);
  });

  test("doctor says when a newer release is out, and how to upgrade", async () => {
    const report = await store.doctor();
    store.doctor = () =>
      Promise.resolve({
        ...report,
        update: {
          version: "1.3.0",
          url: "https://github.com/caru-ini/evertap/releases/tag/v1.3.0",
          advice: "Run the install script again on the machine running evertap",
        },
      });
    const { stdout, exitCode } = await run(["doctor"], onMachine);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(
      "Update   evertap 1.3.0 is out. Run the install script again on the machine running evertap\n",
    );
  });

  test("works only on the machine running evertap", async () => {
    for (const command of ["setup", "open"]) {
      expect((await run([command])).stderr).toBe(
        "evertap is not running on this machine as this user. Start it with evertap serve, then run this again. On a laptop, pair with evertap login instead\n",
      );
    }
  });
});

const skill = await Bun.file(
  join(import.meta.dir, "..", "..", "..", "..", "skills", "evertap", "SKILL.md"),
).text();

const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

describe("skills", () => {
  const record = join(configDir, "skills.json");
  /** The skill's directory under an agent's own, such as `.claude`. */
  const skillDir = (...agent: string[]) => join(home, ...agent, "skills", "evertap");
  const copy = (...agent: string[]) => join(skillDir(...agent), "SKILL.md");
  const recorded = async () =>
    z
      .object({
        version: z.string(),
        offered: z.boolean(),
        written: z.record(z.string(), z.string()),
      })
      .parse(await Bun.file(record).json());

  beforeEach(async () => {
    for (const agent of [".agents", ".claude", ".cursor", ".codex"]) {
      await rm(join(home, agent), { recursive: true, force: true });
    }
    await rm(configDir, { recursive: true, force: true });
  });

  test("installs in ~/.agents/skills and for each agent found here, and records what it wrote", async () => {
    await mkdir(join(home, ".claude"));
    await mkdir(join(home, ".cursor"));
    const { stdout, exitCode } = await run(["skills", "install"]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      [
        "Writing the evertap skill to:",
        `  ${skillDir(".agents")} (shared by many agents)`,
        `  ${skillDir(".claude")} (Claude Code)`,
        `  ${skillDir(".cursor")} (Cursor)`,
        "Installed. An agent that is already running may need a restart to see it.",
        "",
      ].join("\n"),
    );
    for (const file of [copy(".agents"), copy(".claude"), copy(".cursor")]) {
      expect(await Bun.file(file).text()).toBe(skill);
    }
    expect(await exists(join(home, ".codex"))).toBe(false);
    expect((await recorded()).written).toEqual({
      [copy(".agents")]: sha256(skill),
      [copy(".claude")]: sha256(skill),
      [copy(".cursor")]: sha256(skill),
    });
  });

  test("writes for the agents --agent names alone, found here or not", async () => {
    expect((await run(["skills", "install", "--agent", "codex"])).exitCode).toBe(0);
    expect(await Bun.file(copy(".codex")).text()).toBe(skill);
    expect(await exists(join(home, ".agents"))).toBe(false);
    const unknown = await run(["skills", "install", "--agent", "vim"]);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toStartWith("Unknown agent vim. Choose one of universal, claude-code, ");
  });

  test("leaves a copy it did not write unless --force", async () => {
    await mkdir(skillDir(".claude"), { recursive: true });
    await writeFile(copy(".claude"), "Another skill named evertap");
    const { stderr, exitCode } = await run(["skills", "install"]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe(
      `Kept ${skillDir(".claude")}, which evertap did not write. Add --force to replace it\n`,
    );
    expect(await Bun.file(copy(".claude")).text()).toBe("Another skill named evertap");
    expect(await Bun.file(copy(".agents")).text()).toBe(skill);
    expect((await run(["skills", "install", "--force"])).stderr).toBe("");
    expect(await Bun.file(copy(".claude")).text()).toBe(skill);
  });

  test("after a new version, rewrites what it wrote and keeps changed copies, saying so once", async () => {
    await mkdir(join(home, ".claude"));
    await run(["skills", "install"]);
    // As an earlier version left them: one as it wrote it, one changed since.
    const earlier = "---\nname: evertap\ndescription: An earlier skill\n---\n";
    await writeFile(copy(".agents"), earlier);
    await writeFile(copy(".claude"), `${skill}\nMy own note\n`);
    const before = await recorded();
    await writeFile(
      record,
      JSON.stringify({
        ...before,
        version: "0.0.1",
        written: { ...before.written, [copy(".agents")]: sha256(earlier) },
      }),
    );
    const first = await run(["version"]);
    expect(first.stdout).toBe("dev\n");
    expect(first.stderr).toBe(
      `Did not update the evertap skill in ${skillDir(".claude")}, which was changed after evertap wrote it. Run evertap skills install --force to replace it\n`,
    );
    expect(await Bun.file(copy(".agents")).text()).toBe(skill);
    expect(await Bun.file(copy(".claude")).text()).toBe(`${skill}\nMy own note\n`);
    expect((await recorded()).version).toBe("dev");
    expect((await run(["version"])).stderr).toBe("");
    expect((await run(["skills", "install"])).stderr).toBe(
      `Kept ${skillDir(".claude")}, which was changed after evertap wrote it. Add --force to replace it\n`,
    );
    expect((await run(["skills", "install", "--force"])).exitCode).toBe(0);
    expect(await Bun.file(copy(".claude")).text()).toBe(skill);
  });

  test("leaves a copy the person removed removed", async () => {
    await run(["skills", "install"]);
    await rm(skillDir(".agents"), { recursive: true });
    const before = await recorded();
    await writeFile(record, JSON.stringify({ ...before, version: "0.0.1" }));
    expect((await run(["version"])).stderr).toBe("");
    expect(await exists(skillDir(".agents"))).toBe(false);
    expect((await recorded()).written).toEqual({});
  });

  test("remove takes out what it wrote and keeps changed copies unless --force", async () => {
    await mkdir(join(home, ".claude"));
    await mkdir(join(home, ".cursor"));
    await run(["skills", "install"]);
    await writeFile(copy(".claude"), "Changed");
    const { stdout, stderr, exitCode } = await run(["skills", "remove"]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe(
      `Removed the evertap skill from:\n  ${skillDir(".agents")}\n  ${skillDir(".cursor")}\n`,
    );
    expect(stderr).toBe(
      `Kept ${skillDir(".claude")}, which was changed after evertap wrote it. Add --force to remove it\n`,
    );
    expect(await exists(skillDir(".agents"))).toBe(false);
    expect(await exists(skillDir(".cursor"))).toBe(false);
    expect(Object.keys((await recorded()).written)).toEqual([copy(".claude")]);
    expect((await run(["skills", "remove", "--force"])).stdout).toBe(
      `Removed the evertap skill from:\n  ${skillDir(".claude")}\n`,
    );
    expect(await exists(skillDir(".claude"))).toBe(false);
    expect((await run(["skills", "remove"])).stdout).toBe("The evertap skill is not installed\n");
  });

  test("login offers nothing without a terminal", async () => {
    await mkdir(join(home, ".claude"));
    // evertap's answers to a pairing a person approved at once.
    const handler = new RPCHandler({
      clients: {
        pairing: {
          start: os.handler(() => ({
            code: "BCDF-GHJK",
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
            requestId: "request-1",
          })),
          claim: os.handler(() => ({ status: "approved", token: "token-1" })),
        },
      },
    });
    const site = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) =>
        (await handler.handle(request, { prefix: "/api/client/rpc" })).response ??
        new Response(null, { status: 404 }),
    });
    try {
      // No browser to open.
      const { stdout, exitCode } = await run(["login", site.url.origin], {
        PATH: join(home, "no-bin"),
      });
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Paired");
      expect(stdout).not.toContain("skill");
      expect(await exists(join(home, ".agents"))).toBe(false);
      expect(await exists(record)).toBe(false);
    } finally {
      void site.stop(true);
    }
  });
});

describe("uninstall", () => {
  const noDocker = join(home, "docker.sock");

  // A stand-in Docker holding what `inDocker` names; set `refuse` to fail every removal.
  const fakeSocket = join(home, "fake-docker.sock");
  let inDocker = { containers: [] as string[], volumes: [] as string[], networks: [] as string[] };
  let refuse = false;
  const removed: string[] = [];
  const fake = Bun.serve({
    unix: fakeSocket,
    fetch: (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/version") {
        return Response.json({ Version: "27.3.1", ApiVersion: "1.47", MinAPIVersion: "1.24" });
      }
      if (request.method === "DELETE") {
        removed.push(decodeURIComponent(pathname.replace(/^\/v[\d.]+/, "")));
        return refuse
          ? Response.json({ message: "volume is in use" }, { status: 409 })
          : new Response(null, { status: 204 });
      }
      if (pathname.endsWith("/containers/json")) {
        return Response.json(inDocker.containers.map((name) => ({ Names: [`/${name}`] })));
      }
      if (pathname.endsWith("/volumes")) {
        return Response.json({ Volumes: inDocker.volumes.map((name) => ({ Name: name })) });
      }
      return Response.json(inDocker.networks.map((name) => ({ Name: name })));
    },
  });
  const withDocker = { EVERTAP_DOCKER_SOCKET: fakeSocket };

  const fillDataDir = async () => {
    await mkdir(join(dataDir, "postgresql", "pgbouncer"), { recursive: true });
    await mkdir(join(dataDir, "cloudflared"), { recursive: true });
    await writeFile(join(dataDir, "cloudflared", "token"), "run-token");
    for (const name of [
      "evertap.db",
      "evertap.db-wal",
      "evertap.db.v1-20261002.bak",
      "notes.txt",
    ]) {
      await writeFile(join(dataDir, name), "");
    }
  };

  beforeEach(async () => {
    inDocker = { containers: [], volumes: [], networks: [] };
    refuse = false;
    removed.length = 0;
    await rm(dataDir, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await fake.stop(true);
  });

  test("refuses a prefix that would reach other names", async () => {
    const { stderr, exitCode } = await run(["uninstall", "--yes"], { EVERTAP_PREFIX: "" });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Set EVERTAP_PREFIX");
  });

  test("keeps the data when it cannot reach Docker to remove the rest", async () => {
    await fillDataDir();
    const { stderr, exitCode } = await run(["uninstall", "--yes"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain(`Cannot reach Docker at ${noDocker}`);
    expect(await exists(join(dataDir, "evertap.db"))).toBe(true);
  });

  test("lists what it removes, says what it could not check, and asks first", async () => {
    await signIn();
    const { stdout, stderr, exitCode } = await run(["uninstall"]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain(`Sign-in: ${configDir}`);
    expect(stdout).toContain(`Docker at ${noDocker}: not checked`);
    expect(stderr).toBe("Add --yes to remove without a prompt\n");
    expect(await exists(configDir)).toBe(true);
  });

  test("lists what a Cloudflare Tunnel setup created leaves in Cloudflare", async () => {
    await fillDataDir();
    inDocker = { containers: ["evertap-cloudflared"], volumes: [], networks: [] };
    const records = new Database(join(dataDir, "evertap.db"));
    records.run("CREATE TABLE settings (id INTEGER PRIMARY KEY, data TEXT NOT NULL)");
    records.run("INSERT INTO settings (id, data) VALUES (1, ?)", [
      JSON.stringify({
        mode: "cloudflare",
        publicUrl: "https://evertap.example.com",
        tunnel: {
          id: "c1744f8b-0000-4000-8000-000000000001",
          accountId: "account-1",
          zoneId: "zone-1",
          zone: "example.com",
          hostnames: { ui: "evertap.example.com", storage: "s3.example.com" },
          dnsRecordIds: ["record-1", "record-2"],
          cacheRule: { rulesetId: "ruleset-1", ruleId: "rule-1" },
          token: "run-token",
        },
      }),
    ]);
    records.close();
    const { stdout, exitCode } = await run(["uninstall"], withDocker);
    expect(exitCode).toBe(1);
    expect(stdout).toContain(
      [
        "These stay in Cloudflare. To remove them, stop here and run evertap serve, then choose another way to open evertap in Settings or with evertap setup, or remove them yourself:",
        "  The tunnel evertap, under Networking → Tunnels: https://dash.cloudflare.com/account-1/tunnels",
        "  The DNS records evertap.example.com and s3.example.com, under DNS for example.com: https://dash.cloudflare.com/account-1/example.com/dns/records",
        "",
      ].join("\n"),
    );
    expect(stdout).not.toContain("run-token");
    expect(removed).toEqual([]);
  });

  test("will not take --yes when only the data or only Docker turns up", async () => {
    await fillDataDir();
    const { stdout, stderr, exitCode } = await run(["uninstall", "--yes"], withDocker);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("EVERTAP_DATA_DIR or EVERTAP_PREFIX, or as another user");
    expect(stderr).toContain("Nothing was removed");
    expect(removed).toEqual([]);
    expect(await exists(join(dataDir, "evertap.db"))).toBe(true);
  });

  test("says what to do when Docker stops it partway", async () => {
    await fillDataDir();
    inDocker = { containers: [], volumes: ["evertap-postgres-18"], networks: [] };
    refuse = true;
    const { stderr, exitCode } = await run(["uninstall", "--yes"], withDocker);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Stopped partway");
    expect(stderr).toContain("run evertap uninstall again");
    expect(stderr).not.toContain("    at ");
  });

  test.skipIf(touchesSystem)(
    "removes what evertap made and leaves the rest of the data directory",
    async () => {
      await fillDataDir();
      await signIn();
      inDocker = {
        containers: ["evertap-pgbouncer"],
        volumes: ["evertap-postgres-18"],
        networks: ["evertap"],
      };
      const { stdout, exitCode } = await run(["uninstall", "--yes"], withDocker);
      expect(exitCode).toBe(0);
      expect(removed).toEqual([
        "/containers/evertap-pgbouncer",
        "/volumes/evertap-postgres-18",
        "/networks/evertap",
      ]);
      expect(stdout).toContain(`Left ${dataDir}, which also holds notes.txt`);
      expect(stdout).toContain("Removed.\n");
      expect(await readdir(dataDir)).toEqual(["notes.txt"]);
      expect(await exists(configDir)).toBe(false);
    },
  );

  test.skipIf(touchesSystem)(
    "leaves nothing behind on the machine running evertap, signed in to nothing",
    async () => {
      await mkdir(dataDir, { recursive: true });
      const records = new Database(join(dataDir, "evertap.db"));
      records.run("PRAGMA journal_mode = WAL");
      records.run("CREATE TABLE settings (id INTEGER PRIMARY KEY, data TEXT NOT NULL)");
      records.close();
      inDocker = { containers: [], volumes: ["evertap-postgres-18"], networks: [] };
      const { stdout, exitCode } = await run(["uninstall", "--yes"], withDocker);
      expect(exitCode).toBe(0);
      expect(stdout).not.toContain(`Left ${dataDir}`);
      expect(await exists(dataDir)).toBe(false);
      expect(await exists(configDir)).toBe(false);
    },
  );

  test.skipIf(touchesSystem)(
    "removes the agent skill it wrote and leaves a changed copy",
    async () => {
      const skillDir = (agent: string) => join(home, agent, "skills", "evertap");
      await rm(join(home, ".agents"), { recursive: true, force: true });
      await rm(join(home, ".claude"), { recursive: true, force: true });
      await mkdir(join(home, ".claude"));
      await run(["skills", "install"]);
      await writeFile(join(skillDir(".claude"), "SKILL.md"), "Changed");
      const { stdout, exitCode } = await run(["uninstall", "--yes"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain(`CLI settings: ${configDir}\n`);
      expect(stdout).toContain(`Agent skill: ${skillDir(".agents")}, ${skillDir(".claude")}\n`);
      expect(stdout).toContain(
        `Left ${skillDir(".claude")}, which was changed after evertap wrote it\n`,
      );
      expect(await exists(skillDir(".agents"))).toBe(false);
      expect(await exists(join(skillDir(".claude"), "SKILL.md"))).toBe(true);
      expect(await exists(configDir)).toBe(false);
    },
  );

  test.skipIf(touchesSystem)("does not claim it is done when Docker went unchecked", async () => {
    await signIn();
    const { stdout, exitCode } = await run(["uninstall", "--yes"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(`Removed what is listed. Docker at ${noDocker} was not checked.`);
    expect(stdout).not.toContain("Removed.\n");
    expect(await exists(configDir)).toBe(false);
    expect((await run(["uninstall"])).stdout).toBe(
      `Docker at ${noDocker}: not checked\nNothing else evertap made is on this machine\n`,
    );
  });
});
