import { describe, expect, it } from "vitest";

import { PRELUDE_MAX, parsePrelude } from "./redis-proxy.ts";

const bytes = (text: string) => new TextEncoder().encode(text);
const bulk = (...args: string[]) =>
  `*${args.length}\r\n${args.map((arg) => `$${new TextEncoder().encode(arg).length}\r\n${arg}\r\n`).join("")}`;

describe("parsePrelude", () => {
  it("finds the user of AUTH <user> <pass>, in any case", () => {
    expect(parsePrelude(bytes(bulk("auth", "evertap_a1", "pw")))).toEqual({
      kind: "user",
      username: "evertap_a1",
    });
  });

  it("finds the user of HELLO with AUTH and SETNAME", () => {
    expect(
      parsePrelude(bytes(bulk("HELLO", "3", "AUTH", "evertap_a1", "pw", "SETNAME", "app"))),
    ).toEqual({ kind: "user", username: "evertap_a1" });
  });

  it("waits for every split point of a command", () => {
    const whole = bulk("AUTH", "evertap_a1", "pw");
    for (let end = 0; end < whole.length; end++) {
      expect(parsePrelude(bytes(whole.slice(0, end)))).toEqual({ kind: "incomplete" });
    }
    expect(parsePrelude(bytes(whole + bulk("PING")))).toEqual({
      kind: "user",
      username: "evertap_a1",
    });
  });

  it("refuses password-only AUTH as the disabled default user", () => {
    expect(parsePrelude(bytes(bulk("AUTH", "pw")))).toEqual({
      kind: "reject",
      reply: "-WRONGPASS invalid username-password pair or user is disabled.\r\n",
    });
  });

  it("asks for AUTH before anything else", () => {
    const noauth = { kind: "reject", reply: "-NOAUTH Authentication required.\r\n" };
    expect(parsePrelude(bytes(bulk("PING")))).toEqual(noauth);
    expect(parsePrelude(bytes("PING\r\n"))).toEqual(noauth);
    expect(parsePrelude(bytes(bulk("HELLO", "3")))).toEqual(noauth);
    expect(parsePrelude(bytes(bulk("HELLO", "3", "AUTH", "evertap_a1")))).toEqual(noauth);
    // Decided from the name alone, before the rest arrives.
    expect(parsePrelude(bytes("*3\r\n$3\r\nSET\r\n$1\r\n"))).toEqual(noauth);
  });

  it("stops buffering a first command that grows past the cap", () => {
    const huge = `*3\r\n$4\r\nAUTH\r\n$${PRELUDE_MAX}\r\n${"u".repeat(PRELUDE_MAX)}`;
    expect(parsePrelude(bytes(huge))).toEqual({
      kind: "reject",
      reply: "-NOAUTH Authentication required.\r\n",
    });
    expect(parsePrelude(bytes(`*3\r\n$4\r\nAUTH\r\n$${PRELUDE_MAX + 1}\r\n`))).toMatchObject({
      kind: "reject",
    });
  });
});
