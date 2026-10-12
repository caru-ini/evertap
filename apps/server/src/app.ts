import { bearerCaller, sessionCaller } from "@evertap/api/callers";
import type { Caller, Context } from "@evertap/api/context";
import { OBJECT_LINK_PATH } from "@evertap/api/object-links";
import { appRouter } from "@evertap/api/router";
import { SESSION_COOKIE, cookieName } from "@evertap/api/rules";
import { OBJECT_PART_SIZE, RPC_BODY_MAX } from "@evertap/api/schemas";
import { allowsHost } from "@evertap/api/settings";
import { ORPCError, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { getCookie } from "@orpc/server/helpers";
import {
  RequestHeadersPlugin,
  ResponseHeadersPlugin,
  SimpleCsrfProtectionHandlerPlugin,
} from "@orpc/server/plugins";
import type { Server } from "bun";
import { type Context as HonoContext, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getBunServer, getConnInfo } from "hono/bun";
import { secureHeaders } from "hono/secure-headers";

import { clientAddress } from "./address.ts";
import { config } from "./config.ts";
import { downloadObject } from "./object-download.ts";
import { arrived } from "./reach.ts";
import { findWebRoot, serveWeb } from "./static.ts";
import { access, store } from "./store.ts";

const logError = (error: unknown) => {
  // A 4xx is a refusal the caller is told about, and a 503 a first download still running; another
  // 5xx, such as output failing its schema, is a bug.
  if (error instanceof ORPCError && (error.status < 500 || error.status === 503)) {
    return;
  }
  console.error(error);
};

// A download link carries the object's key and its signature; the log keeps only the path.
const LINK_QUERY = new RegExp(`(${OBJECT_LINK_PATH})\\?\\S*`);

const RPC_PATH = /^\/api\/(client\/)?rpc\//;

const TUNNEL_CHANGE_S = 600;

// journald keeps every line and the UI polls every few seconds, so only failures are written. A
// 401 asks to sign in, and an RPC refusal reaches its caller, as `logError` assumes.
const failed = (status: number, path: string) =>
  status >= 500 || (status >= 400 && status !== 401 && !RPC_PATH.test(path));

// Colors only in a terminal: journald would keep the escape codes.
const COLOR = process.stdout.isTTY && !("NO_COLOR" in process.env);

const WRONG_HOST =
  "evertap does not answer to this address. Use the address it was set up with, or change that with evertap setup on the machine running evertap";

// The UI's path: a session cookie, so requests must prove they come from the page's own script.
const uiRpc = new RPCHandler<Context>(appRouter, {
  interceptors: [onError(logError)],
  plugins: [
    new RequestHeadersPlugin(),
    new ResponseHeadersPlugin(),
    new SimpleCsrfProtectionHandlerPlugin(),
  ],
});
// The CLI's path: a bearer token, which a browser never attaches on its own.
const clientRpc = new RPCHandler<Context>(appRouter, {
  interceptors: [onError(logError)],
  plugins: [new RequestHeadersPlugin(), new ResponseHeadersPlugin()],
});

export type AppOptions = {
  /** Served on the local Unix socket: the CLI on this machine, which needs no sign-in. */
  local: boolean;
};

export const createApp = async ({ local }: AppOptions) => {
  const app = new Hono();

  app.use(async (c, next) => {
    const start = Date.now();
    await next();
    const { status } = c.res;
    if (failed(status, c.req.path)) {
      const { method, url } = c.req;
      const path = url.slice(url.indexOf("/", 8)).replace(LINK_QUERY, "$1");
      const code = COLOR ? `\x1b[${status >= 500 ? 31 : 33}m${status}\x1b[0m` : status;
      console.log(`${method} ${path} ${code} ${Date.now() - start}ms`);
    }
  });
  // No HSTS: plain HTTP on the LAN is a supported setup, and HSTS would lock a hostname out of it.
  app.use(secureHeaders({ xFrameOptions: "DENY", strictTransportSecurity: false }));
  // Before the Host check, so a check through a proxy that changes the Host still learns of it.
  app.use("/api/health", async (c, next) => {
    const token = c.req.query("probe");
    if (token) {
      arrived(token, c.req.raw.headers);
    }
    return next();
  });
  if (!local) {
    // A page that points its own name at this machine (DNS rebinding) gets no further than this.
    app.use(async (c, next) => {
      if (allowsHost(access.current(), access.environment, c.req.header("host"))) {
        return next();
      }
      // Shaped as oRPC's own error there, so the CLI and the UI show the message.
      if (RPC_PATH.test(c.req.path)) {
        return c.json({ json: new ORPCError("FORBIDDEN", { message: WRONG_HOST }).toJSON() }, 403);
      }
      return c.text(`${WRONG_HOST}.`, 403);
    });
  }

  // Plain HTTP so `evertap uninstall`, the address check, and the install script can probe it
  // without an RPC client.
  app.get("/api/health", (c) => c.json({ ok: true }));

  /** Who sent the request, by the one kind of credential its path takes. */
  const identify = async (c: HonoContext, from: "cookie" | "bearer") => {
    const https =
      new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https";
    const ip = local
      ? null
      : clientAddress(
          getConnInfo(c).remote.address,
          c.req.raw.headers,
          access.current().mode.value,
        );
    let caller: Caller;
    if (local) {
      caller = { kind: "local" };
    } else if (config.demo) {
      // The demo has no sign-in: every browser is the person trying it out.
      caller = { kind: "person", client: null };
    } else if (from === "cookie") {
      const token = getCookie(c.req.raw.headers, cookieName(SESSION_COOKIE, https));
      caller = await sessionCaller(store, token, ip);
    } else {
      caller = await bearerCaller(store, c.req.header("authorization"), ip);
    }
    return { caller, ip, https };
  };

  const mount = (prefix: `/${string}`, handler: RPCHandler<Context>, from: "cookie" | "bearer") => {
    app.use(
      `${prefix}/*`,
      bodyLimit({
        maxSize: RPC_BODY_MAX,
        onError: (c) =>
          c.text(`Send the file in parts of ${OBJECT_PART_SIZE / 1024 / 1024} MiB or less`, 413),
      }),
    );
    app.use(`${prefix}/*`, async (c, next) => {
      const { caller, ip, https } = await identify(c, from);
      // Making a tunnel waits for cloudflared's first download and its link to Cloudflare, longer
      // than Bun lets a request go quiet: from Settings, or from setup on this machine as it saves.
      // Only a signed-in person or this machine gets that long, so no one else can hold
      // connections open with it.
      if (
        (caller.kind === "person" &&
          caller.client !== null &&
          c.req.path === `${prefix}/system/settings/tunnel/finish`) ||
        (caller.kind === "local" && c.req.path === `${prefix}/system/settings/update`)
      ) {
        getBunServer<Server<never>>(c)?.timeout(c.req.raw, TUNNEL_CHANGE_S);
      }
      const result = await handler.handle(c.req.raw, {
        prefix,
        context: {
          store,
          caller,
          origin: access.current().publicUrl.value ?? undefined,
          https,
          ip,
        },
      });
      return result.matched ? c.newResponse(result.response.body, result.response) : next();
    });
  };
  mount("/api/rpc", uiRpc, "cookie");
  // Separate from the UI's path so Cloudflare Access, where used, can cover the UI alone.
  mount("/api/client/rpc", clientRpc, "bearer");
  // Outside oRPC so the browser saves the object as it streams instead of holding it in memory.
  app.get(OBJECT_LINK_PATH, async (c) => {
    const { caller } = await identify(c, "cookie");
    const response = await downloadObject(store, caller, new URL(c.req.url));
    if (response.ok) {
      // A slow phone or a paused download goes quiet for longer than Bun's idle timeout.
      getBunServer<Server<never>>(c)?.timeout(c.req.raw, 0);
    }
    return response;
  });

  const webRoot = await findWebRoot();
  if (webRoot) {
    app.get("*", await serveWeb(webRoot));
  } else {
    app.get("*", (c) =>
      c.text("The UI is not built. Run `pnpm build`, or `pnpm dev` and open the Vite URL.", 404),
    );
  }

  return app;
};
