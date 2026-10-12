// `pnpm release`, run on develop: pins the newest database images, takes the next version and its
// CHANGELOG.md section from the conventional commits since the last release (git-cliff, cliff.toml),
// commits and tags the release, and after a yes pushes develop, main (fast-forward only), and the
// tag, which builds and publishes the release. `--dry-run` only prints the version and the section.
import { join } from "node:path";

const root = join(import.meta.dir, "../../..");
const changelogFile = join(root, "CHANGELOG.md");
const manifestFile = join(root, "apps/server/package.json");
const dryRun = process.argv.includes("--dry-run");

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const run = (...command: string[]) => {
  const result = Bun.spawnSync(command, {
    cwd: root,
    stderr: "inherit",
    // git-cliff logs at info level, and its warnings repeat what this script says.
    env: { ...process.env, RUST_LOG: "error" },
  });
  if (result.exitCode !== 0) {
    fail(`${command.join(" ")} failed`);
  }
  return result.stdout.toString().trim();
};

const succeeds = (...command: string[]) =>
  Bun.spawnSync(command, { cwd: root, stderr: "ignore" }).exitCode === 0;

// Straight from node_modules, since `pnpm exec` may install first and print to the output read here.
const bin = (name: string) => join(root, "node_modules/.bin", name);
const cliff = (...args: string[]) => run(bin("git-cliff"), ...args);

if (!dryRun) {
  if (run("git", "branch", "--show-current") !== "develop") {
    fail("Run this on develop");
  }
  if (run("git", "status", "--porcelain") !== "") {
    fail("Commit or stash your changes first");
  }
  run("git", "fetch", "origin", "develop", "main");
  if (run("git", "rev-parse", "HEAD") !== run("git", "rev-parse", "origin/develop")) {
    fail("develop differs from origin/develop. Pull or push it first");
  }
  if (!succeeds("git", "merge-base", "--is-ancestor", "origin/main", "HEAD")) {
    fail("main has commits that develop does not. Merge main into develop first");
  }

  console.log(run("bun", "apps/server/scripts/pin-images.ts"));
  if (run("git", "status", "--porcelain") !== "") {
    run(
      "git",
      "commit",
      "-m",
      "chore(deps): pin the newest database images",
      "--",
      "apps/server/src/live/images.ts",
    );
  }
}

const date = new Date().toISOString().slice(0, 10);
const changelog = await Bun.file(changelogFile).text();
const tags = run("git", "tag", "--list", "v*", "--merged", "HEAD", "--sort=-v:refname");
const last = tags.split("\n")[0];

let version: string;
let section: string;
// The whole new CHANGELOG.md when it is written here rather than by git-cliff.
let released: string | undefined;
if (!last) {
  // The history before the first release is a single commit, so git-cliff has nothing to read; that
  // release uses the Unreleased section written by hand.
  version = "v0.1.0";
  const heading = `## [0.1.0](https://github.com/caru-ini/evertap/releases/tag/${version}) - ${date}`;
  released = changelog
    .replace(/^## \[Unreleased\]$/m, heading)
    .replace(/^\[Unreleased\]: .*\n/m, "");
  if (released === changelog) {
    fail("CHANGELOG.md has no Unreleased section for the first release");
  }
  section = released.slice(released.indexOf(heading)).trim();
} else {
  version = cliff("--bumped-version");
  if (version === last) {
    fail(`Nothing to release: no feat, fix, or perf commits since ${last}`);
  }
  section = cliff("--unreleased", "--tag", version, "--strip", "header");
}

console.log(`${version}\n\n${section}\n`);
if (dryRun) {
  process.exit(0);
}

if (released !== undefined) {
  await Bun.write(changelogFile, released);
} else {
  cliff("--unreleased", "--tag", version, "--prepend", "CHANGELOG.md");
}
run(bin("oxfmt"), "--write", "CHANGELOG.md");
const manifest = await Bun.file(manifestFile).text();
const bumped = manifest.replace(/"version": "[^"]*"/, `"version": "${version.slice(1)}"`);
if (bumped === manifest) {
  fail(`apps/server/package.json is already at ${version}`);
}
await Bun.write(manifestFile, bumped);
run(
  "git",
  "commit",
  "-m",
  `chore(repo): release ${version}`,
  "--",
  "CHANGELOG.md",
  "apps/server/package.json",
);
run("git", "tag", "-a", version, "-m", version);

// One atomic push, so a refused fast-forward of main leaves origin as it was.
const push = ["git", "push", "--atomic", "origin", "develop", "develop:main", version];
const answer = prompt(`Committed and tagged ${version}. Push develop, main, and the tag? [y/N]`);
if (answer?.toLowerCase() !== "y") {
  console.log(`Not pushed. To push: ${push.join(" ")}`);
  console.log(`To undo: git tag -d ${version} && git reset --hard origin/develop`);
  process.exit(0);
}
run(...push);
console.log(`Pushed ${version}. The release builds at https://github.com/caru-ini/evertap/actions`);
