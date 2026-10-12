import { describe, expect, test } from "bun:test";

import {
  type UpdateCheckOptions,
  cliBehind,
  createUpdateCheck,
  isNewer,
  releaseIn,
} from "./update-check.ts";

const TAG = "https://github.com/caru-ini/evertap/releases/tag/v";

/** GitHub's answer to `releases/latest`, and every request sent to it. */
const github = (answer: () => Response) => {
  const sent: { url: string; init: RequestInit }[] = [];
  const fetch = (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return Promise.resolve(answer());
  };
  return { sent, fetch };
};

const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

const setup = (options: Partial<UpdateCheckOptions> & { answer?: () => Response } = {}) => {
  const { sent, fetch } = github(options.answer ?? (() => redirect(`${TAG}0.2.0`)));
  const lines: string[] = [];
  const updates = createUpdateCheck({
    version: "0.1.0",
    enabled: true,
    image: false,
    fetch,
    log: (line) => lines.push(line),
    ...options,
  });
  return { updates, sent, lines };
};

describe("releaseIn", () => {
  test("reads the version from the release page the redirect leads to", () => {
    expect(releaseIn(`${TAG}0.2.0`)).toBe("0.2.0");
    expect(releaseIn("/caru-ini/evertap/releases/tag/v1.10.3")).toBe("1.10.3");
  });

  test("finds none when there is no release yet, or the tag is not a stable version", () => {
    expect(releaseIn("https://github.com/caru-ini/evertap/releases")).toBeNull();
    expect(releaseIn(`${TAG}0.2.0-rc.1`)).toBeNull();
    expect(releaseIn("https://github.com/caru-ini/evertap/releases/tag/develop-build")).toBeNull();
    expect(releaseIn(`${TAG}0.2`)).toBeNull();
    expect(releaseIn(null)).toBeNull();
    expect(releaseIn("http://[")).toBeNull();
  });
});

describe("isNewer", () => {
  test("orders by semver, with a develop build before its release", () => {
    expect(isNewer("0.2.0", "0.2.0-dev.14+1a2b3c4")).toBe(true);
    expect(isNewer("0.1.1", "0.2.0-dev.14+1a2b3c4")).toBe(false);
    expect(isNewer("0.10.0", "0.9.0")).toBe(true);
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.1.0", "0.2.0")).toBe(false);
  });

  test("never calls anything newer than evertap run from source", () => {
    expect(isNewer("9.0.0", "dev")).toBe(false);
  });
});

describe("createUpdateCheck", () => {
  test("asks GitHub once, sending nothing but its own name", async () => {
    const { updates, sent } = setup();
    await updates.check();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("https://github.com/caru-ini/evertap/releases/latest");
    expect(sent[0]?.init.redirect).toBe("manual");
    expect(sent[0]?.init.headers).toEqual({ "user-agent": "evertap" });
    expect(sent[0]?.init.body).toBeUndefined();
  });

  test("keeps a newer release, and logs it the first time only", async () => {
    const { updates, lines } = setup();
    expect(updates.latest()).toBeNull();
    await updates.check();
    await updates.check();
    expect(updates.latest()).toEqual({
      version: "0.2.0",
      url: `${TAG}0.2.0`,
      advice:
        "Run the install script again on the machine running evertap: curl -fsSL https://evertap.dev/install.sh | sh",
    });
    expect(lines).toEqual([
      "evertap 0.2.0 is out (this is 0.1.0). Run the install script again on the machine running evertap: curl -fsSL https://evertap.dev/install.sh | sh",
    ]);
  });

  test("tells evertap's own image to pull a new one", async () => {
    const { updates } = setup({ image: true });
    await updates.check();
    expect(updates.latest()?.advice).toBe(
      "Run docker compose pull and docker compose up -d on the machine running evertap",
    );
  });

  test("has nothing to say when this is the newest", async () => {
    const { updates, lines } = setup({ version: "0.2.0" });
    await updates.check();
    expect(updates.latest()).toBeNull();
    expect(lines).toEqual([]);
  });

  test("tells a develop build about its release", async () => {
    const { updates } = setup({ version: "0.2.0-dev.14+1a2b3c4" });
    await updates.check();
    expect(updates.latest()?.version).toBe("0.2.0");
  });

  test("keeps what it found when a later check fails, in one line without a stack", async () => {
    let answer = () => redirect(`${TAG}0.2.0`);
    const { updates, lines } = setup({ answer: () => answer() });
    await updates.check();
    answer = () => {
      throw new TypeError("Unable to connect. Is the computer able to access the url?");
    };
    await updates.check();
    answer = () => new Response("Not Found", { status: 404 });
    await updates.check();
    expect(updates.latest()?.version).toBe("0.2.0");
    expect(lines.slice(1)).toEqual([
      "Could not check for a newer evertap, so it tries again in a day: Unable to connect. Is the computer able to access the url?",
      "Could not check for a newer evertap, so it tries again in a day: GitHub answered 404",
    ]);
  });

  test("never asks with EVERTAP_UPDATE_CHECK=0, or when run from source", async () => {
    for (const options of [{ enabled: false }, { version: "dev" }]) {
      const { updates, sent } = setup(options);
      updates.start();
      await updates.check();
      expect(sent).toEqual([]);
      expect(updates.latest()).toBeNull();
    }
  });
});

describe("cliBehind", () => {
  test("asks to upgrade a CLI older than the release evertap runs", () => {
    expect(cliBehind("0.1.0", "0.2.0")).toBe(
      "This machine has evertap 0.1.0, and the evertap it uses runs 0.2.0. Run the install script again on this machine: curl -fsSL https://evertap.dev/install.sh | sh",
    );
    expect(cliBehind("0.2.0-dev.3+1a2b3c4", "0.2.0")).not.toBeNull();
  });

  test("says nothing for the same or an older evertap, a develop build, or a CLI from source", () => {
    expect(cliBehind("0.2.0", "0.2.0")).toBeNull();
    expect(cliBehind("0.2.0", "0.1.0")).toBeNull();
    // The install script brings the newest release, not this build.
    expect(cliBehind("0.1.0", "0.2.0-dev.3+1a2b3c4")).toBeNull();
    expect(cliBehind("dev", "0.2.0")).toBeNull();
  });
});
