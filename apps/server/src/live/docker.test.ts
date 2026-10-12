import { describe, expect, it } from "vitest";

import { pickApiVersion } from "./docker.ts";

describe("pickApiVersion", () => {
  it("speaks the engine's newest version when evertap knows it", () => {
    expect(pickApiVersion({ Version: "27.3.1", ApiVersion: "1.47", MinAPIVersion: "1.24" })).toBe(
      "1.47",
    );
    expect(pickApiVersion({ Version: "29.0.0", ApiVersion: "1.52", MinAPIVersion: "1.44" })).toBe(
      "1.52",
    );
  });

  it("speaks evertap's newest version to a newer engine that still accepts it", () => {
    expect(pickApiVersion({ Version: "31.0.0", ApiVersion: "1.60", MinAPIVersion: "1.44" })).toBe(
      "1.56",
    );
  });

  it("compares the numbers, not the text", () => {
    // As text, "1.100" sorts before "1.56".
    expect(pickApiVersion({ Version: "99.0.0", ApiVersion: "1.100", MinAPIVersion: "1.44" })).toBe(
      "1.56",
    );
  });

  it("asks to update Docker when the engine is older than evertap supports", () => {
    expect(() =>
      pickApiVersion({ Version: "23.0.6", ApiVersion: "1.42", MinAPIVersion: "1.12" }),
    ).toThrow("Docker 23.0.6 is too old. Update Docker to version 24 or later");
  });

  it("asks to update evertap when the engine no longer accepts any version evertap speaks", () => {
    expect(() =>
      pickApiVersion({ Version: "40.0.0", ApiVersion: "1.70", MinAPIVersion: "1.60" }),
    ).toThrow("Docker 40.0.0 is newer than this evertap supports. Update evertap");
  });
});
