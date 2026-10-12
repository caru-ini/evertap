/** Where something listens: an IP address and a port. */
export type Address = { hostname: string; port: number };

/** `127.0.0.1:8080`, or `[::1]:8080` for IPv6. */
export const formatAddress = ({ hostname, port }: Address) =>
  `${hostname.includes(":") ? `[${hostname}]` : hostname}:${port}`;

type Stoppable = { stop: (closeActiveConnections?: boolean) => unknown };

/**
 * Binds with `bind` at `address`, and again wherever `move` sends it while evertap runs, as the
 * settings can. Connections already taken stay open. A move that cannot listen throws and leaves
 * it unbound until the next move.
 */
export const listenAt = (address: Address, bind: (at: Address) => Stoppable) => {
  let bound = address;
  let listener: Stoppable | null = bind(bound);
  return {
    move: (next: Address) => {
      if (listener !== null && next.hostname === bound.hostname && next.port === bound.port) {
        return;
      }
      listener?.stop(false);
      listener = null;
      listener = bind(next);
      bound = next;
    },
    stop: () => {
      listener?.stop(true);
      listener = null;
    },
  };
};
