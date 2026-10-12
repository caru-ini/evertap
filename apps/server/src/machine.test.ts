import { describe, expect, it } from "vitest";

import { parseMeminfo } from "./machine.ts";

describe("parseMeminfo", () => {
  it("reads the total and the available memory from the same file, as lxcfs serves it", () => {
    const lxc = [
      "MemTotal:        8388608 kB",
      "MemFree:         6291456 kB",
      "MemAvailable:    7340032 kB",
      "Buffers:               0 kB",
      "Cached:           524288 kB",
    ].join("\n");
    expect(parseMeminfo(lxc)).toEqual({
      totalBytes: 8388608 * 1024,
      freeBytes: 7340032 * 1024,
    });
  });

  it("gives up without MemAvailable, which kernels before 3.14 lack", () => {
    expect(parseMeminfo("MemTotal:        8388608 kB\nMemFree:         6291456 kB\n")).toBeNull();
    expect(parseMeminfo("")).toBeNull();
  });
});
