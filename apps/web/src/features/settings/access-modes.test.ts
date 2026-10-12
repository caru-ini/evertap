import { describe, expect, it } from "vitest";

import { type ChoiceFields, savedFor } from "./access-modes.ts";

const EMPTY: ChoiceFields = {
  lanHost: "0.0.0.0",
  place: "127.0.0.1",
  lanUrl: "",
  proxyUrl: "",
  storage: "",
  urlFixed: false,
};

describe("savedFor", () => {
  it("saves each choice as its mode and where the UI listens", () => {
    expect(savedFor("local", { ...EMPTY, lanUrl: "not an address" })).toEqual({
      saved: { mode: "local" },
    });
    expect(savedFor("network", EMPTY)).toEqual({
      saved: { mode: "network", listenHost: "0.0.0.0", publicUrl: null, storageUrl: null },
    });
    expect(
      savedFor("proxy", {
        ...EMPTY,
        place: "172.17.0.1",
        lanUrl: "http://evertap.local:8080",
        proxyUrl: " https://evertap.example.com/ ",
        storage: "https://s3.example.com",
      }),
    ).toEqual({
      saved: {
        mode: "network",
        listenHost: "172.17.0.1",
        publicUrl: "https://evertap.example.com",
        storageUrl: "https://s3.example.com",
      },
    });
  });

  it("takes another address for devices on the network, such as its name there", () => {
    expect(savedFor("network", { ...EMPTY, lanUrl: "http://evertap.local:8080" })).toMatchObject({
      saved: { publicUrl: "http://evertap.local:8080" },
    });
  });

  it("needs the address of a proxy or tunnel, unless a variable sets it", () => {
    expect(savedFor("proxy", EMPTY)).toEqual({
      field: "url",
      message: "Give the address your proxy or tunnel serves evertap at",
    });
    expect(savedFor("proxy", { ...EMPTY, urlFixed: true })).toMatchObject({
      saved: { publicUrl: null },
    });
  });

  it("says which address is wrong", () => {
    expect(savedFor("network", { ...EMPTY, lanUrl: "https://evertap.example.com/ui" })).toEqual({
      field: "url",
      message: "Give the address without a path, such as https://evertap.example.com",
    });
    expect(
      savedFor("proxy", {
        ...EMPTY,
        proxyUrl: "https://evertap.example.com",
        storage: "https://s3.example.com/b",
      }),
    ).toEqual({
      field: "storage",
      message: "Give the address without a path, such as https://s3.example.com",
    });
  });
});
