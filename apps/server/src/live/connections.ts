/** Counts an entry's client connections per resource, for when each was last used. */
export const trackConnections = () => {
  const connections = new Map<string, { active: number; seen: boolean }>();
  return {
    opened: (id: string) => {
      const tracked = connections.get(id) ?? { active: 0, seen: false };
      tracked.active += 1;
      tracked.seen = true;
      connections.set(id, tracked);
    },
    closed: (id: string) => {
      const tracked = connections.get(id);
      if (tracked) {
        tracked.active -= 1;
        // It was open during the current poll interval even if the last poll already saw it.
        tracked.seen = true;
      }
    },
    /** Whether a client was connected to the resource since the last call, which resets it. */
    takeConnected: (id: string) => {
      const tracked = connections.get(id);
      if (!tracked) {
        return false;
      }
      const connected = tracked.active > 0 || tracked.seen;
      tracked.seen = false;
      if (tracked.active === 0) {
        connections.delete(id);
      }
      return connected;
    },
  };
};
