import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";

import { GET as getSkill } from "../app/.well-known/agent-skills/evertap/SKILL.md/route.ts";
import { GET as getIndex } from "../app/.well-known/agent-skills/index.json/route.ts";

test("the index lists the repository's skill with the digest of what is served", async () => {
  const repository = await readFile(new URL("../../../skills/evertap/SKILL.md", import.meta.url));
  const served = getSkill();
  expect(served.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
  expect(Buffer.from(await served.arrayBuffer()).equals(repository)).toBe(true);
  expect(await (await getIndex()).json()).toEqual({
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [
      {
        name: "evertap",
        type: "skill-md",
        description: expect.stringMatching(
          /^Create and manage development databases .+ comes up\.$/,
        ),
        url: "evertap/SKILL.md",
        digest: `sha256:${createHash("sha256").update(repository).digest("hex")}`,
      },
    ],
  });
});
