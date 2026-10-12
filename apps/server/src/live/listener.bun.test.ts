import { afterAll, expect, test } from "bun:test";

import { listenAt } from "./listener.ts";
import { freePort } from "./testing.ts";

const echo = (address: { hostname: string; port: number }) =>
  Bun.listen({
    ...address,
    socket: {
      data: (socket, chunk) => {
        socket.write(chunk);
      },
    },
  });

/** What the listener at `port` echoes back, or null when nothing listens there. */
const ask = async (port: number) => {
  try {
    const answer = Promise.withResolvers<string>();
    const socket = await Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        data: (_socket, chunk) => {
          answer.resolve(new TextDecoder().decode(chunk));
        },
      },
    });
    socket.write("hi");
    const text = await answer.promise;
    socket.end();
    return text;
  } catch {
    return null;
  }
};

const first = { hostname: "127.0.0.1", port: freePort() };
const second = { hostname: "127.0.0.1", port: freePort() };
const listener = listenAt(first, echo);

afterAll(() => {
  listener.stop();
});

test("moves while connections it took stay open", async () => {
  const kept = Promise.withResolvers<string>();
  const open = await Bun.connect({
    ...first,
    socket: {
      data: (_socket, chunk) => {
        kept.resolve(new TextDecoder().decode(chunk));
      },
    },
  });

  listener.move(second);
  expect(await ask(second.port)).toBe("hi");
  expect(await ask(first.port)).toBeNull();
  open.write("still here");
  expect(await kept.promise).toBe("still here");
  open.end();
});

test("stays unbound after a move it cannot make, until the next one", async () => {
  const taken = echo({ hostname: "127.0.0.1", port: freePort() });
  try {
    expect(() => {
      listener.move({ hostname: "127.0.0.1", port: taken.port });
    }).toThrow();
    expect(await ask(second.port)).toBeNull();
    listener.move(second);
    expect(await ask(second.port)).toBe("hi");
  } finally {
    taken.stop(true);
  }
});
