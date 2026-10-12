import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeUrl, readSettings, settingsDir, writeSettings } from "./settings.ts";

describe("normalizeUrl", () => {
  test("gives a LAN name or address plain HTTP and any other name HTTPS", () => {
    expect(normalizeUrl("evertap.local:8080")).toBe("http://evertap.local:8080");
    expect(normalizeUrl("192.168.1.20:8080")).toBe("http://192.168.1.20:8080");
    expect(normalizeUrl("localhost:8080")).toBe("http://localhost:8080");
    expect(normalizeUrl("[::1]:8080")).toBe("http://[::1]:8080");
    expect(normalizeUrl("evertap.example.com")).toBe("https://evertap.example.com");
  });

  test("keeps a typed scheme in lower case and drops spaces and trailing slashes", () => {
    expect(normalizeUrl(" http://evertap.example.com// ")).toBe("http://evertap.example.com");
    expect(normalizeUrl("HTTPS://evertap.example.com/")).toBe("https://evertap.example.com");
  });
});

describe("settings", () => {
  const before = process.env.XDG_CONFIG_HOME;
  let home = "";

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "evertap-settings-"));
    process.env.XDG_CONFIG_HOME = home;
  });

  afterEach(async () => {
    if (before === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = before;
    }
    await rm(home, { recursive: true, force: true });
  });

  test("are readable by this user alone", async () => {
    await writeSettings({ url: "https://evertap.example.com", token: "secret" });
    expect((await stat(settingsDir())).mode & 0o777).toBe(0o700);
    expect((await stat(join(settingsDir(), "config.json"))).mode & 0o777).toBe(0o600);
    expect(await readSettings()).toEqual({ url: "https://evertap.example.com", token: "secret" });
  });

  test("replace a file others could read with one only this user can", async () => {
    const file = join(settingsDir(), "config.json");
    await mkdir(settingsDir(), { recursive: true });
    await writeFile(file, "{}", { mode: 0o644 });
    await writeSettings({ url: "https://evertap.example.com", token: "secret" });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readdir(settingsDir())).toEqual(["config.json"]);
  });

  test("read as none when missing or not written by evertap login", async () => {
    expect(await readSettings()).toBeNull();
    await mkdir(settingsDir(), { recursive: true });
    await writeFile(join(settingsDir(), "config.json"), JSON.stringify({ url: "x" }));
    expect(await readSettings()).toBeNull();
  });
});
