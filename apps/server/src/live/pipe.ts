import type { Socket } from "bun";

export type Side<T> = {
  socket: Socket<T> | null;
  /** Bytes the socket did not take yet; the other side is paused until they drain. */
  queue: Uint8Array[];
  /** End once the queue drains: the other side closed. */
  ending: boolean;
};

/** Two sockets piped both ways with backpressure: a full side pauses the other. */
export type Ends<T> = { client: Side<T>; backend: Side<T> };

export const side = <T>(socket: Socket<T> | null = null): Side<T> => ({
  socket,
  queue: [],
  ending: false,
});

const other = <T>(ends: Ends<T>, from: Side<T>) =>
  from === ends.client ? ends.backend : ends.client;

/**
 * Writes what `socket` takes of `queue` and keeps the rest in order; returns the bytes written. A
 * Bun socket drops what it cannot take, so the rest waits for its `drain`.
 */
export const writeQueue = (
  socket: { write: (data: Uint8Array) => number },
  queue: Uint8Array[],
) => {
  let total = 0;
  for (let head = queue[0]; head; head = queue[0]) {
    const written = Math.max(socket.write(head), 0);
    total += written;
    if (written < head.length) {
      queue[0] = head.subarray(written);
      break;
    }
    queue.shift();
  }
  return total;
};

/** Writes what the side has queued; call it from the socket's `drain`. */
export const flush = <T>(ends: Ends<T>, to: Side<T>) => {
  const socket = to.socket;
  if (!socket) {
    return;
  }
  writeQueue(socket, to.queue);
  if (to.queue.length > 0) {
    return;
  }
  if (to.ending) {
    socket.end();
    return;
  }
  other(ends, to).socket?.resume();
};

export const send = <T>(ends: Ends<T>, to: Side<T>, chunk: Uint8Array) => {
  // Bun may reuse the chunk's memory once the callback returns.
  to.queue.push(new Uint8Array(chunk));
  if (to.queue.length === 1) {
    flush(ends, to);
  }
  if (to.queue.length > 0) {
    other(ends, to).socket?.pause();
  }
};

/** Ends both sockets, each after its queued bytes are written. */
export const end = <T>(ends: Ends<T>) => {
  for (const each of [ends.client, ends.backend]) {
    if (each.queue.length === 0) {
      each.socket?.end();
    } else {
      each.ending = true;
    }
  }
};
