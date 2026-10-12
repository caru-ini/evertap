import text from "../../../skills/evertap/SKILL.md?raw";

/** The skill `evertap skills install` writes, served for `npx skills add https://evertap.dev`. */
export const skill = text;

const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";

const field = (name: string) => new RegExp(`^${name}: (.+)$`, "m").exec(frontmatter)?.[1] ?? "";

/** What skills clients read first (Agent Skills Discovery 0.2.0); they check the digest. */
export const skillIndex = async () => {
  const name = field("name");
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(skill)),
  );
  return {
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [
      {
        name,
        type: "skill-md",
        description: field("description"),
        url: `${name}/SKILL.md`,
        digest: `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
      },
    ],
  };
};
