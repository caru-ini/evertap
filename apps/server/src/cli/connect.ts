import { RESOURCE_ENGINES, RESOURCE_PORTS, type ResourceEngine } from "@evertap/api/rules";
import type { Socket } from "bun";

import { writeQueue } from "../live/pipe.ts";
import {
  PAUSE,
  PING_INTERVAL_MS,
  RELAY_PATH,
  RELAY_PROTOCOL,
  RESUME,
  UNANSWERED_PINGS_MAX,
} from "../relay.ts";

/** Unsent bytes past which the app is not read until the WebSocket catches up. */
const SEND_BUFFER_MAX = 1024 * 1024;

/** Bun's WebSocket client has no drain event, so a full buffer is looked at this often. */
const DRAIN_CHECK_MS = 5;

type Link = {
  ws: WebSocket;
  /** What the app has not taken yet. */
  queue: Uint8Array[];
  /** The relay asked to stop sending. */
  held: boolean;
  /** Runs while the WebSocket's buffer is full. */
  draining: ReturnType<typeof setInterval> | undefined;
  /** Something arrived from the relay since the last ping. */
  heard: boolean;
  unanswered: number;
  timer: ReturnType<typeof setInterval>;
  /** The relay closed; the app gets what is queued, then its connection ends. */
  closed: boolean;
};

const stop = (app: Socket<Link>) => {
  clearInterval(app.data.timer);
  clearInterval(app.data.draining);
  app.data.queue = [];
  app.end();
  app.data.ws.close();
};

/** Reads from the app again unless the relay or a full buffer holds it back. */
const resume = (app: Socket<Link>) => {
  const { ws, held, draining } = app.data;
  if (ws.readyState === WebSocket.OPEN && !held && draining === undefined) {
    app.resume();
  }
};

/** Hands the app what it takes, and reads the WebSocket only while the app keeps up. */
const flush = (app: Socket<Link>) => {
  const { ws, queue, closed } = app.data;
  writeQueue(app, queue);
  if (queue.length > 0) {
    ws.pause();
  } else if (closed) {
    app.end();
  } else if (ws.isPaused) {
    ws.resume();
  }
};

const ping = (app: Socket<Link>) => {
  const link = app.data;
  // Paused for a slow app, the WebSocket reads nothing, so its silence says nothing.
  if (link.heard || link.ws.isPaused) {
    link.unanswered = 0;
  }
  link.heard = false;
  // Also gives up on a WebSocket that never opens.
  if (link.unanswered >= UNANSWERED_PINGS_MAX) {
    stop(app);
    return;
  }
  if (link.ws.readyState === WebSocket.OPEN) {
    link.ws.ping();
  }
  link.unanswered += 1;
};

/**
 * Why the relay turns this CLI away, as the next step to take; null when it would take it or
 * cannot be asked. A refused WebSocket tells the CLI nothing, so this asks over plain HTTP.
 */
export const relayRefusal = async (url: string, token: string): Promise<string | null> => {
  let response: Response;
  try {
    response = await fetch(`${url}${RELAY_PATH}postgresql`, {
      headers: { authorization: `Bearer ${token}`, "sec-websocket-protocol": RELAY_PROTOCOL },
    });
  } catch {
    return null;
  }
  if (response.status === 401) {
    return `Run evertap login ${url} again`;
  }
  // 426: another relay version, which names the machine to update. 429: the connection cap.
  return response.status === 426 || response.status === 429 ? response.text() : null;
};

export type ConnectOptions = {
  /** The server's address, such as `https://evertap.example.com`. */
  url: string;
  token: string;
  hostname: string;
  engines?: readonly ResourceEngine[];
  /** Other ports than the standard ones. */
  ports?: Partial<Record<ResourceEngine, number>>;
  /** Called when an engine's port is taken; the others keep listening. */
  unavailable: (engine: ResourceEngine, error: unknown) => void;
  /** Called once with the next step when the relay starts turning connections away. */
  refused?: (message: string) => void;
  pingIntervalMs?: number;
};

/**
 * Listens on each engine's standard port and carries every connection over its own WebSocket to
 * the server's relay. Nothing is multiplexed: a dropped WebSocket closes only its connection.
 */
export const startConnect = (options: ConnectOptions) => {
  const pingIntervalMs = options.pingIntervalMs ?? PING_INTERVAL_MS;
  const relayUrl = (engine: ResourceEngine) =>
    `${options.url.replace(/^http/, "ws")}${RELAY_PATH}${engine}`;

  let asking = false;
  let told: string | null = null;
  /** Asks why a WebSocket was turned away, telling each new reason once. */
  const ask = async () => {
    const { refused } = options;
    if (asking || !refused) {
      return;
    }
    asking = true;
    const message = await relayRefusal(options.url, options.token);
    asking = false;
    if (message !== null && message !== told) {
      told = message;
      refused(message);
    }
  };

  const open = (engine: ResourceEngine, app: Socket<Link>) => {
    const ws = new WebSocket(relayUrl(engine), {
      headers: { authorization: `Bearer ${options.token}` },
      protocols: [RELAY_PROTOCOL],
    });
    ws.binaryType = "arraybuffer";
    // The app's bytes wait in its socket until the WebSocket can take them.
    app.pause();
    app.data = {
      ws,
      queue: [],
      held: false,
      draining: undefined,
      heard: false,
      unanswered: 0,
      timer: setInterval(() => {
        ping(app);
      }, pingIntervalMs),
      closed: false,
    };
    const heard = () => {
      app.data.heard = true;
    };
    let opened = false;
    ws.addEventListener("open", () => {
      opened = true;
      told = null;
      resume(app);
    });
    ws.addEventListener("message", (event) => {
      heard();
      const { data } = event;
      if (data === PAUSE) {
        app.data.held = true;
        app.pause();
      } else if (data === RESUME) {
        app.data.held = false;
        resume(app);
      } else if (data instanceof ArrayBuffer) {
        app.data.queue.push(new Uint8Array(data));
        if (app.data.queue.length === 1) {
          flush(app);
        }
      }
    });
    ws.addEventListener("ping", heard);
    ws.addEventListener("pong", heard);
    ws.addEventListener("close", () => {
      if (!opened) {
        void ask();
      }
      clearInterval(app.data.timer);
      clearInterval(app.data.draining);
      app.data.draining = undefined;
      // Whatever the app sends now has nowhere to go.
      app.pause();
      app.data.closed = true;
      if (app.data.queue.length === 0) {
        app.end();
      }
    });
    ws.addEventListener("error", () => {
      stop(app);
    });
  };

  const listeners = (options.engines ?? RESOURCE_ENGINES).flatMap((engine) => {
    try {
      return [
        Bun.listen<Link>({
          hostname: options.hostname,
          port: options.ports?.[engine] ?? RESOURCE_PORTS[engine],
          socket: {
            open: (app) => {
              open(engine, app);
            },
            data: (app, chunk) => {
              const { ws, closed } = app.data;
              if (closed) {
                return;
              }
              ws.send(new Uint8Array(chunk));
              if (ws.bufferedAmount > SEND_BUFFER_MAX && app.data.draining === undefined) {
                app.pause();
                app.data.draining = setInterval(() => {
                  if (ws.bufferedAmount === 0) {
                    clearInterval(app.data.draining);
                    app.data.draining = undefined;
                    resume(app);
                  }
                }, DRAIN_CHECK_MS);
              }
            },
            drain: (app) => {
              flush(app);
            },
            close: (app) => {
              stop(app);
            },
            error: (app) => {
              stop(app);
            },
          },
        }),
      ];
    } catch (error) {
      options.unavailable(engine, error);
      return [];
    }
  });

  return {
    listening: listeners.length,
    stop: () => {
      for (const listener of listeners) {
        listener.stop(true);
      }
    },
  };
};
