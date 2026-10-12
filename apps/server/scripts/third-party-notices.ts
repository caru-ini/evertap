// Prints the third-party notices for the binary `pnpm build` makes: the npm packages bundled into it
// or into the web UI it serves, the service marks in that UI, and the Bun runtime it embeds. Run it
// with the bun that compiled the binary, since the Bun section names that bun's version.
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

const root = join(import.meta.dir, "../../..");
const brands = join(root, "apps/web/public/brands");

const licensesSchema = z.record(
  z.string(),
  z.array(
    z.object({ paths: z.array(z.string()), license: z.string(), homepage: z.string().optional() }),
  ),
);
const manifestSchema = z.object({ name: z.string(), version: z.string() });

const fetchText = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: ${response.status}`);
  }
  return response.text();
};

// A fence longer than any backtick run inside, so a license written in Markdown stays verbatim.
const fence = (text: string) => {
  const mark = "`".repeat(Math.max(2, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length)) + 1);
  return `${mark}text\n${text.trimEnd()}\n${mark}`;
};

const licenseFiles = async (dir: string) =>
  (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^(licen[cs]e|copying|notice)/i.test(entry.name))
    .map((entry) => entry.name)
    .toSorted();

const npmPackages = async () => {
  // The server and the workspace packages it builds from, the web UI among them; not the site.
  const listed = Bun.spawnSync(
    ["pnpm", "--filter", "server...", "licenses", "list", "--prod", "--json"],
    { cwd: root, stderr: "inherit" },
  );
  if (listed.exitCode !== 0) {
    throw new Error("pnpm licenses list failed");
  }
  const byKey = new Map<string, string>();
  for (const entries of Object.values(licensesSchema.parse(JSON.parse(listed.stdout.toString())))) {
    for (const entry of entries) {
      for (const dir of entry.paths) {
        const manifest = manifestSchema.parse(await Bun.file(join(dir, "package.json")).json());
        const key = `${manifest.name} ${manifest.version}`;
        if (byKey.has(key)) {
          continue;
        }
        const files = await licenseFiles(dir);
        const texts = await Promise.all(files.map((name) => Bun.file(join(dir, name)).text()));
        byKey.set(
          key,
          [
            `### ${key}`,
            `License: ${entry.license}${entry.homepage ? `. ${entry.homepage}` : ""}`,
            ...(texts.length > 0 ? texts.map(fence) : ["The package includes no license file."]),
          ].join("\n\n"),
        );
      }
    }
  }
  return [...byKey].toSorted(([a], [b]) => a.localeCompare(b)).map(([, text]) => text);
};

const serviceMarks = async () => {
  const readme = await Bun.file(join(brands, "README.md")).text();
  const files = (await readdir(brands)).filter((name) => name.endsWith("-LICENSE")).toSorted();
  return [
    readme
      .replace(/^# .*$/m, "## Service marks in the web UI")
      // The links point at files beside the README; their licenses follow below instead.
      .replace(/\[([^\]]+)\]\(\.\/[^)]+\)/g, "$1")
      .trimEnd(),
    ...(await Promise.all(
      files.map(
        async (name) => `### ${name}\n\n${fence(await Bun.file(join(brands, name)).text())}`,
      ),
    )),
  ];
};

const bun = async () => {
  const source = `https://github.com/oven-sh/bun/tree/${Bun.revision}`;
  const spdx = "https://raw.githubusercontent.com/spdx/license-list-data/v3.29.0/text";
  const [license, lgpl20, lgpl21] = await Promise.all([
    fetchText(`https://raw.githubusercontent.com/oven-sh/bun/${Bun.revision}/LICENSE.md`),
    fetchText(`${spdx}/LGPL-2.0-only.txt`),
    fetchText(`${spdx}/LGPL-2.1-only.txt`),
  ]);
  return [
    "## Bun",
    `The binary is built with \`bun build --compile\`, so it contains the Bun runtime, version ${Bun.version}. Its source is at ${source}. Bun is MIT-licensed and statically links the libraries its license lists below.`,
    "Bun statically links JavaScriptCore and WebKit under the GNU Library General Public License version 2, and tinycc under the GNU Lesser General Public License version 2.1. Bun's patched WebKit is at https://github.com/oven-sh/WebKit, and Bun's source above pins the commit it uses and explains how to build Bun with a changed WebKit. To run evertap on such a build, build evertap from its source with that bun. Both license texts follow Bun's license.",
    fence(license),
    "### GNU Library General Public License, version 2",
    fence(lgpl20),
    "### GNU Lesser General Public License, version 2.1",
    fence(lgpl21),
  ];
};

const { version } = manifestSchema.parse(
  await Bun.file(join(root, "apps/server/package.json")).json(),
);

const sections = [
  "# Third-party notices",
  `The evertap ${version} binary includes the following works. Their own license terms apply to them.`,
  ...(await bun()),
  ...(await serviceMarks()),
  "## npm packages",
  "These packages are bundled into the binary or into the web UI it serves.",
  ...(await npmPackages()),
];

process.stdout.write(`${sections.join("\n\n")}\n`);
