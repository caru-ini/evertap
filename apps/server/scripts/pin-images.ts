// Moves each database image in src/live/images.ts to the digest its tag points at now, so a release
// ships the newest patch release of every version. Run it before tagging a release and commit what
// it changes. The nightly Docker tests run it first, to try what the next release would pin.
import { join } from "node:path";

import { z } from "zod";

const file = join(import.meta.dir, "../src/live/images.ts");
// `"name:tag@sha256:…"`; every one of them is on Docker Hub.
const PINNED = /"([^"\s:@]+):([^"\s:@]+)@(sha256:[0-9a-f]{64})"/g;
// An index lists the image for every platform, so one pin serves amd64 and arm64 alike.
const INDEX_TYPES = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
];

const tokenSchema = z.object({ token: z.string() });

/** The digest the tag points at now. A HEAD request does not count against Docker Hub's limits. */
const currentDigest = async (name: string, tag: string) => {
  const repo = name.includes("/") ? name : `library/${name}`;
  const auth = await fetch(
    `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`,
  );
  if (!auth.ok) {
    throw new Error(`${name}: token ${auth.status}`);
  }
  const { token } = tokenSchema.parse(await auth.json());
  const response = await fetch(`https://registry-1.docker.io/v2/${repo}/manifests/${tag}`, {
    method: "HEAD",
    headers: { Authorization: `Bearer ${token}`, Accept: INDEX_TYPES.join(", ") },
  });
  const digest = response.headers.get("docker-content-digest");
  if (!response.ok || !digest) {
    throw new Error(`${name}:${tag}: ${response.status}`);
  }
  if (!INDEX_TYPES.includes(response.headers.get("content-type") ?? "")) {
    throw new Error(`${name}:${tag} is not a multi-platform image`);
  }
  return digest;
};

const source = await Bun.file(file).text();
const pins = [...source.matchAll(PINNED)];
if (pins.length === 0) {
  throw new Error(`no pinned images in ${file}`);
}
let pinned = source;
for (const [pin, name = "", tag = "", digest = ""] of pins) {
  const current = await currentDigest(name, tag);
  if (current !== digest) {
    pinned = pinned.replace(pin, `"${name}:${tag}@${current}"`);
    console.log(`${name}:${tag} ${digest} → ${current}`);
  }
}
if (pinned === source) {
  console.log("Every image is pinned to what its tag points at now.");
} else {
  await Bun.write(file, pinned);
}
