import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { z } from "zod";

const settingsSchema = z.object({ url: z.string(), token: z.string() });

/** Where `evertap login` keeps the server's address and this CLI's token. */
export type Settings = z.infer<typeof settingsSchema>;

export const settingsDir = () =>
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "evertap");

const path = () => join(settingsDir(), "config.json");

export const readSettings = async (): Promise<Settings | null> => {
  const file = Bun.file(path());
  if (!(await file.exists())) {
    return null;
  }
  const parsed = settingsSchema.safeParse(await file.json());
  return parsed.success ? parsed.data : null;
};

export const writeSettings = async (settings: Settings) => {
  const file = path();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  // The token acts for the person who approved it. `mode` applies only to a file being created,
  // so a fresh one replaces the old: the token never sits in a file others can read.
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
};

export const removeSettings = async () => {
  await rm(path(), { force: true });
};

/** `evertap.local:8080` → `http://evertap.local:8080`; a bare domain gets HTTPS. */
export const normalizeUrl = (typed: string) => {
  const trimmed = typed.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^https?/i, (scheme) => scheme.toLowerCase());
  }
  const local = /(^localhost|\.local|^\d+\.\d+\.\d+\.\d+|^\[[\da-f:]+\])(:\d+)?$/i.test(trimmed);
  return `${local ? "http" : "https"}://${trimmed}`;
};
