import { rm } from "node:fs/promises";
import { join } from "node:path";

import { bearerCaller } from "@evertap/api/callers";
import { DataError } from "@evertap/api/context";
import { DATABASE_ADDRESS, DATABASE_HOST } from "@evertap/api/rules";
import { exposedAt, urlHost } from "@evertap/api/settings";
import type { Server } from "bun";

import { listenFailure } from "./access.ts";
import { clientAddress } from "./address.ts";
import { createApp } from "./app.ts";
import { config } from "./config.ts";
import { resolve } from "./doctor.ts";
import { type Address, formatAddress, listenAt } from "./live/listener.ts";
import { createRelay } from "./relay.ts";
import { access, close, quit, store } from "./store.ts";

/** Long enough for the answer that moved the UI to reach its browser. */
const MOVE_GRACE_MS = 5000;

/** Long enough for the drivers to close; one still pulling an image is left behind. */
const SHUTDOWN_MS = 10_000;

const serve = async (local: boolean) => {
  const app = await createApp({ local });
  const relay = createRelay({
    entry: access.entry,
    caller: async (request, server) => {
      if (local) {
        return "local";
      }
      const ip = clientAddress(
        server.requestIP(request)?.address,
        request.headers,
        access.current().mode.value,
      );
      const caller = await bearerCaller(store, request.headers.get("authorization"), ip);
      return caller.kind === "client" ? caller.client.id : null;
    },
    // Revoked or lapsed clients drop out of the list.
    stillAllowed: async (caller) =>
      local || (await store.listClients()).some((client) => client.id === caller),
  });
  // The demo starts no databases or buckets, so it has nothing to relay to.
  const fetch = async (request: Request, server: Server<never>) => {
    const relayed = config.demo ? undefined : await relay.upgrade(request, server);
    return relayed === undefined ? app.fetch(request, server) : (relayed ?? undefined);
  };
  // Bun's development mode, its default without NODE_ENV, answers a thrown error with the stack,
  // the source lines, and the working directory.
  return { fetch, websocket: relay.websocket, development: false };
};

const network = await serve(false);

// What the old address took, relayed connections included, closes once the move is answered:
// the new settings may have closed that address to whoever is on it.
const listenUi = (address: Address) => {
  const server = Bun.serve({ ...address, ...network });
  return {
    stop: (closeActiveConnections?: boolean) => {
      void server.stop(closeActiveConnections);
      if (!closeActiveConnections) {
        setTimeout(() => {
          void server.stop(true);
        }, MOVE_GRACE_MS).unref();
      }
    },
  };
};

const uiFailure = (error: unknown) => listenFailure(error, access.ui(), "EVERTAP_PORT");

const startUi = () => {
  try {
    return listenAt(access.ui(), listenUi);
  } catch (error) {
    const failure = uiFailure(error);
    if (failure instanceof DataError) {
      return quit(failure.message);
    }
    throw failure;
  }
};

const ui = startUi();
access.follow(() => {
  try {
    ui.move(access.ui());
  } catch (error) {
    throw uiFailure(error);
  }
});

const settings = access.current();
const url = settings.publicUrl.value;
if (config.demo) {
  console.log(`evertap demo at ${url ?? formatAddress(access.ui())}: sample data, no sign-in`);
} else {
  console.log(
    `evertap is listening on ${formatAddress(access.ui())}${url ? `; browsers open it at ${url}` : ""}`,
  );
  if (
    settings.mode.value === "local" &&
    !(await resolve(DATABASE_HOST)).includes(DATABASE_ADDRESS)
  ) {
    console.log(
      `${DATABASE_HOST} does not lead here yet. Run evertap setup on this machine so browsers and apps reach evertap at it`,
    );
  }
  const exposed = exposedAt(settings.listenHost.value, access.environment);
  if (exposed !== null) {
    console.warn(
      `Warning: anyone on the internet can open evertap's sign-in page at http://${urlHost(exposed)}:${config.port}, unencrypted. Unless your firewall blocks that, run evertap setup and choose a proxy on this machine, or set EVERTAP_LISTEN_HOST=127.0.0.1 and put a proxy with HTTPS in front`,
    );
  }
  if (settings.mode.value === null) {
    // Setup cannot change what a variable sets; only evertap's image is set up with variables.
    console.log(
      config.image
        ? "To choose how browsers elsewhere reach evertap, set EVERTAP_MODE and EVERTAP_LISTEN_HOST: https://evertap.dev/docs/docker#choose-how-it-is-reached"
        : "To choose how browsers elsewhere reach evertap, run evertap setup on this machine",
    );
    // Without a mode the forwarded address is not taken: behind a proxy, everyone is 127.0.0.1.
    if (settings.publicUrl.source === "env") {
      console.warn(
        "Set EVERTAP_MODE=network as well as EVERTAP_PUBLIC_URL: without it, evertap cannot tell callers behind your proxy apart, and one of them can hold up everyone's sign-in",
      );
    }
  }
  if (!(await store.listClients()).some((client) => client.kind === "browser")) {
    console.log("To sign in the first browser, run evertap signin-link on this machine");
  }
}

let local: Server<unknown> | undefined;
if (!config.demo) {
  // The data directory is 0700, so only this user reaches the socket: it needs no sign-in.
  const socket = join(config.dataDir, "evertap.sock");
  await rm(socket, { force: true });
  local = Bun.serve({ unix: socket, ...(await serve(true)) });
}

let stopping = false;
const shutdown = async () => {
  if (stopping) {
    return;
  }
  stopping = true;
  setTimeout(() => {
    process.exit(1);
  }, SHUTDOWN_MS).unref();
  ui.stop();
  void local?.stop(true);
  await close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
