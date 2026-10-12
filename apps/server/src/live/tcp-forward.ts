import type { SocketHandler, SocketOptions } from "bun";

import { type Address, listenAt } from "./listener.ts";
import { type Ends, end, flush, send, side } from "./pipe.ts";

interface Pipe extends Ends<Pipe> {
  closed: boolean;
}

const close = (pipe: Pipe) => {
  if (!pipe.closed) {
    pipe.closed = true;
    end(pipe);
  }
};

export type TcpForwardOptions = {
  hostname: string;
  port: number;
  /**
   * The container's port on 127.0.0.1 as it runs now, as Docker picks a new one when it restarts,
   * or the path of a Unix socket it listens on.
   */
  target: () => Promise<number | string>;
};

export type TcpForward = {
  /** Listens at `address` instead; see `listenAt`. */
  move: (address: Address) => void;
  stop: () => void;
};

/**
 * Listens for an entry that runs in a container. Docker publishes the container on 127.0.0.1
 * only: a port it publishes on 0.0.0.0 is routed by iptables ahead of ufw, so ufw cannot close it.
 */
export const startTcpForward = (options: TcpForwardOptions): TcpForward => {
  let cached: number | string | undefined;

  const connect = async (pipe: Pipe, retry: boolean): Promise<void> => {
    const target = cached ?? (await options.target());
    cached = target;
    const backend: SocketOptions<Pipe> = {
      data: pipe,
      socket: {
        open: (socket) => {
          if (pipe.closed) {
            socket.end();
            return;
          }
          pipe.backend.socket = socket;
          flush(pipe, pipe.backend);
          pipe.client.socket?.resume();
        },
        data: (_socket, chunk) => {
          send(pipe, pipe.client, chunk);
        },
        drain: () => {
          flush(pipe, pipe.backend);
        },
        close: () => {
          close(pipe);
        },
        error: () => {
          close(pipe);
        },
      },
    };
    try {
      await (typeof target === "string"
        ? Bun.connect<Pipe>({ ...backend, unix: target })
        : Bun.connect<Pipe>({ ...backend, hostname: "127.0.0.1", port: target }));
    } catch (error) {
      cached = undefined;
      if (retry) {
        return connect(pipe, false);
      }
      throw error;
    }
  };

  const socket: SocketHandler<Pipe> = {
    open: (client) => {
      client.data = { closed: false, client: side(client), backend: side() };
      client.pause();
      connect(client.data, true).catch((error: unknown) => {
        console.error(`entry on port ${client.localPort}:`, error);
        close(client.data);
      });
    },
    data: (client, chunk) => {
      // Bytes before the container answers wait in the backend's queue.
      send(client.data, client.data.backend, chunk);
    },
    drain: (client) => {
      flush(client.data, client.data.client);
    },
    close: (client) => {
      close(client.data);
    },
    error: (client) => {
      close(client.data);
    },
  };

  return listenAt({ hostname: options.hostname, port: options.port }, (address) =>
    Bun.listen<Pipe>({ ...address, socket }),
  );
};
