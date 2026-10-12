/** The evertap skill for coding agents: where it goes, and the record of what this CLI wrote. */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { z } from "zod";

import SKILL from "../../../../skills/evertap/SKILL.md" with { type: "text" };
import { VERSION } from "../version.ts";
import { settingsDir } from "./settings.ts";
import { ask, fail, print, warn } from "./terminal.ts";

type Agent = {
  id: string;
  name: string;
  /** Where the agent reads skills from; the directory above it shows the agent is here. */
  skills: string;
};

const agents = (): Agent[] => {
  const home = homedir();
  const config = process.env.XDG_CONFIG_HOME || join(home, ".config");
  return [
    { id: "universal", name: "shared by many agents", skills: join(home, ".agents", "skills") },
    {
      id: "claude-code",
      name: "Claude Code",
      skills: join(process.env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "skills"),
    },
    {
      id: "codex",
      name: "Codex",
      skills: join(process.env.CODEX_HOME || join(home, ".codex"), "skills"),
    },
    { id: "cursor", name: "Cursor", skills: join(home, ".cursor", "skills") },
    { id: "gemini-cli", name: "Gemini CLI", skills: join(home, ".gemini", "skills") },
    { id: "github-copilot", name: "GitHub Copilot", skills: join(home, ".copilot", "skills") },
    { id: "opencode", name: "OpenCode", skills: join(config, "opencode", "skills") },
    { id: "windsurf", name: "Windsurf", skills: join(home, ".codeium", "windsurf", "skills") },
  ];
};

const fileOf = (agent: Agent) => join(agent.skills, "evertap", "SKILL.md");

const isDirectory = (path: string) =>
  stat(path).then(
    (found) => found.isDirectory(),
    () => false,
  );

/** `~/.agents/skills` always, and each agent whose own directory is here; or the ones named. */
const targets = async (named?: string[]) => {
  const all = agents();
  if (named) {
    return named.map(
      (id) =>
        all.find((agent) => agent.id === id) ??
        fail(`Unknown agent ${id}. Choose one of ${all.map((agent) => agent.id).join(", ")}`),
    );
  }
  const found: Agent[] = [];
  for (const agent of all) {
    if (agent.id === "universal" || (await isDirectory(dirname(agent.skills)))) {
      found.push(agent);
    }
  }
  return found;
};

const recordSchema = z.object({
  /** The CLI that last wrote or checked the skill. */
  version: z.string(),
  /** Whether `evertap login` has offered the skill, so it asks only once. */
  offered: z.boolean(),
  /** The SHA-256 of each SKILL.md this CLI wrote, by its path. */
  written: z.record(z.string(), z.string()),
});

type SkillRecord = z.infer<typeof recordSchema>;

// Beside config.json, not in the skill's directory, where an agent would read it as part of the skill.
const recordPath = () => join(settingsDir(), "skills.json");

const readRecord = async (): Promise<SkillRecord> => {
  const parsed = recordSchema.safeParse(
    await readFile(recordPath(), "utf8").then(
      (text) => JSON.parse(text),
      () => null,
    ),
  );
  return parsed.success ? parsed.data : { version: VERSION, offered: false, written: {} };
};

const writeRecord = async (record: SkillRecord) => {
  const file = recordPath();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
  await rename(temporary, file);
};

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

const readText = (path: string) =>
  readFile(path, "utf8").then(
    (text) => text,
    () => null,
  );

const install = async (chosen: Agent[], force: boolean) => {
  const record = await readRecord();
  const kept: string[] = [];
  try {
    for (const agent of chosen) {
      const file = fileOf(agent);
      const current = await readText(file);
      if (
        current !== null &&
        current !== SKILL &&
        hash(current) !== record.written[file] &&
        !force
      ) {
        kept.push(
          `${dirname(file)}, which ${file in record.written ? "was changed after evertap wrote it" : "evertap did not write"}`,
        );
        continue;
      }
      if (current !== SKILL) {
        try {
          await mkdir(dirname(file), { recursive: true });
          await writeFile(file, SKILL);
        } catch (error) {
          fail(
            `Could not write ${file}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      record.written[file] = hash(SKILL);
    }
  } finally {
    record.version = VERSION;
    await writeRecord(record);
  }
  for (const copy of kept) {
    warn(`Kept ${copy}. Add --force to replace it`);
  }
  if (kept.length < chosen.length) {
    print("Installed. An agent that is already running may need a restart to see it.");
  }
};

const printTargets = (chosen: Agent[]) => {
  for (const agent of chosen) {
    print(`  ${dirname(fileOf(agent))} (${agent.name})`);
  }
};

export const installSkill = async (named: string[] | undefined, force: boolean) => {
  const chosen = await targets(named);
  print("Writing the evertap skill to:");
  printTargets(chosen);
  await install(chosen, force);
};

/**
 * Removes the copies this CLI wrote, for the `named` agents alone if given. A copy changed since
 * stays unless `force`.
 */
export const removeWritten = async (named: string[] | undefined, force: boolean) => {
  const record = await readRecord();
  const only = named ? new Set((await targets(named)).map(fileOf)) : null;
  const removed: string[] = [];
  const kept: string[] = [];
  for (const [file, written] of Object.entries(record.written)) {
    if (only && !only.has(file)) {
      continue;
    }
    const current = await readText(file);
    if (current !== null && hash(current) !== written && !force) {
      kept.push(dirname(file));
      continue;
    }
    if (current !== null) {
      await rm(file, { force: true });
      removed.push(dirname(file));
    }
    // Left behind if the person added files of their own.
    await rmdir(dirname(file)).catch(() => {});
    delete record.written[file];
  }
  await writeRecord(record);
  return { removed, kept };
};

export const removeSkill = async (named: string[] | undefined, force: boolean) => {
  const { removed, kept } = await removeWritten(named, force);
  if (removed.length > 0) {
    print("Removed the evertap skill from:");
    for (const dir of removed) {
      print(`  ${dir}`);
    }
  }
  for (const dir of kept) {
    warn(`Kept ${dir}, which was changed after evertap wrote it. Add --force to remove it`);
  }
  if (removed.length === 0 && kept.length === 0) {
    print("The evertap skill is not installed");
  }
};

/** Where this CLI wrote the skill, for `evertap uninstall` to list. */
export const writtenSkills = async () =>
  Object.keys((await readRecord()).written).map((file) => dirname(file));

/**
 * After the CLI changes version, rewrites the copies it wrote with the skill it now carries. A
 * changed copy stays, and the person hears about it once, since the version is recorded either way.
 */
export const syncSkill = async () => {
  try {
    const record = await readRecord();
    if (record.version === VERSION || Object.keys(record.written).length === 0) {
      return;
    }
    const kept: string[] = [];
    for (const [file, written] of Object.entries(record.written)) {
      const current = await readText(file);
      if (current === null) {
        // Removed by the person: it stays removed.
        delete record.written[file];
      } else if (current === SKILL || hash(current) === written) {
        if (current !== SKILL) {
          await writeFile(file, SKILL);
        }
        record.written[file] = hash(SKILL);
      } else {
        kept.push(dirname(file));
      }
    }
    record.version = VERSION;
    await writeRecord(record);
    for (const dir of kept) {
      warn(
        `Did not update the evertap skill in ${dir}, which was changed after evertap wrote it. Run evertap skills install --force to replace it`,
      );
    }
  } catch {
    // The command the person ran matters more; the next one tries again.
  }
};

/** At the end of `evertap login`, once, in a terminal: asks to install the skill. */
export const offerSkill = async () => {
  if (!process.stdin.isTTY) {
    return;
  }
  const record = await readRecord();
  if (record.offered || Object.keys(record.written).length > 0) {
    return;
  }
  const chosen = await targets();
  print();
  print("Coding agents can learn to use evertap from its skill, written to:");
  printTargets(chosen);
  const answer = (await ask("Install it? [Y/n] ")).toLowerCase();
  await writeRecord({ ...record, offered: true });
  if (answer === "" || answer === "y" || answer === "yes") {
    await install(chosen, false);
  } else {
    print("Skipped. Run evertap skills install to add it later");
  }
};
