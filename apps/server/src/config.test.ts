import { describe, expect, it } from "vitest";

import { findDockerSocket } from "./config.ts";

const home = "/Users/me";
const only = (path: string) => (candidate: string) => candidate === path;

describe("findDockerSocket", () => {
  it("takes EVERTAP_DOCKER_SOCKET first, then a unix:// DOCKER_HOST", () => {
    const exists = only("/var/run/docker.sock");
    expect(
      findDockerSocket(
        { EVERTAP_DOCKER_SOCKET: "/srv/docker.sock", DOCKER_HOST: "unix:///x.sock" },
        home,
        exists,
      ),
    ).toBe("/srv/docker.sock");
    expect(
      findDockerSocket({ DOCKER_HOST: "unix:///run/user/1000/docker.sock" }, home, exists),
    ).toBe("/run/user/1000/docker.sock");
  });

  it("passes over a DOCKER_HOST that is not a socket, and a blank EVERTAP_DOCKER_SOCKET", () => {
    expect(
      findDockerSocket(
        { EVERTAP_DOCKER_SOCKET: "", DOCKER_HOST: "tcp://10.0.0.2:2376" },
        home,
        only(`${home}/.orbstack/run/docker.sock`),
      ),
    ).toBe(`${home}/.orbstack/run/docker.sock`);
  });

  it("prefers Docker Engine's socket, then finds Docker Desktop's, OrbStack's or rootless Docker's", () => {
    expect(findDockerSocket({}, home, () => true)).toBe("/var/run/docker.sock");
    expect(findDockerSocket({}, home, only(`${home}/.docker/run/docker.sock`))).toBe(
      `${home}/.docker/run/docker.sock`,
    );
    expect(
      findDockerSocket(
        { XDG_RUNTIME_DIR: "/run/user/1000" },
        "/home/me",
        only("/run/user/1000/docker.sock"),
      ),
    ).toBe("/run/user/1000/docker.sock");
  });

  it("names Docker Engine's socket when none exists, so the hint says where it looked", () => {
    expect(findDockerSocket({}, home, () => false)).toBe("/var/run/docker.sock");
  });
});
