import { describe, expect, it } from "vitest";

import { STARTUP_MAX, errorResponse, parsePrelude } from "./postgres-proxy.ts";

const packet = (code: number, body: Uint8Array = new Uint8Array()) => {
  const out = new Uint8Array(8 + body.length);
  const view = new DataView(out.buffer);
  view.setInt32(0, out.length);
  view.setInt32(4, code);
  out.set(body, 8);
  return out;
};

const startup = (parameters: Record<string, string>, protocol = 196_608) =>
  packet(
    protocol,
    new TextEncoder().encode(
      `${Object.entries(parameters)
        .map(([name, value]) => `${name}\0${value}\0`)
        .join("")}\0`,
    ),
  );

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("parsePrelude", () => {
  it("finds the user of a startup packet, in protocol 3.0 and 3.2", () => {
    const parameters = { database: "app", user: "evertap_a1", application_name: "x" };
    expect(parsePrelude(startup(parameters))).toEqual({ kind: "user", username: "evertap_a1" });
    expect(parsePrelude(startup(parameters, 196_610))).toEqual({
      kind: "user",
      username: "evertap_a1",
    });
  });

  it("waits for every split point of a startup packet", () => {
    const whole = startup({ user: "evertap_a1", database: "app" });
    for (let end = 0; end < whole.length; end++) {
      expect(parsePrelude(whole.subarray(0, end))).toEqual({ kind: "incomplete" });
    }
  });

  it("declines TLS and GSSAPI so the client starts up in the clear", () => {
    expect(parsePrelude(packet(80_877_103))).toEqual({ kind: "decline", length: 8 });
    expect(parsePrelude(packet(80_877_104))).toEqual({ kind: "decline", length: 8 });
  });

  it("keys a cancel request by process id and secret, of either protocol's length", () => {
    const short = new Uint8Array([0, 0, 0, 42, 1, 2, 3, 4]);
    expect(parsePrelude(packet(80_877_102, short))).toEqual({ kind: "cancel", key: "42:01020304" });
    const long = new Uint8Array(4 + 32).fill(255);
    long.set([0, 0, 1, 0]);
    expect(parsePrelude(packet(80_877_102, long))).toEqual({
      kind: "cancel",
      key: `256:${"ff".repeat(32)}`,
    });
    expect(parsePrelude(packet(80_877_102, new Uint8Array(4 + 257)))).toMatchObject({
      kind: "reject",
    });
  });

  it("asks for the URL's user when there is none", () => {
    const prelude = parsePrelude(startup({ database: "app" }));
    expect(prelude.kind).toBe("reject");
    expect(prelude.kind === "reject" && text(prelude.reply)).toContain(
      "Connect with the user in the database's URL",
    );
  });

  it("refuses an old protocol, a bad length, and TLS sent without asking", () => {
    expect(parsePrelude(packet(131_072))).toMatchObject({ kind: "reject" });
    expect(parsePrelude(packet(80_877_103, new Uint8Array(4)))).toMatchObject({ kind: "reject" });
    const huge = new Uint8Array(8);
    new DataView(huge.buffer).setInt32(0, STARTUP_MAX + 1);
    expect(parsePrelude(huge)).toMatchObject({ kind: "reject" });
    // A TLS ClientHello: nothing a TLS client could read comes back.
    expect(parsePrelude(new Uint8Array([0x16, 3, 1]))).toEqual({
      kind: "reject",
      reply: new Uint8Array(),
    });
  });
});

describe("errorResponse", () => {
  it("frames a FATAL ErrorResponse with its code and message", () => {
    const reply = errorResponse("28000", "Hi");
    expect(text(reply.subarray(0, 1))).toBe("E");
    expect(new DataView(reply.buffer).getInt32(1)).toBe(reply.length - 1);
    expect(text(reply.subarray(5))).toBe("SFATAL\0VFATAL\0C28000\0MHi\0\0");
  });
});
