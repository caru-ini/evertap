import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";

import { contentSecurityPolicy, serveWeb } from "./static.ts";

// The secret sits beside the web root, where a path that climbs out of it would land.
const dir = await mkdtemp(join(tmpdir(), "evertap-static-"));
const webRoot = join(dir, "public");
await mkdir(join(webRoot, "assets"), { recursive: true });
const INDEX_HTML = `<!doctype html><title>evertap</title><script>document.documentElement.classList.add("dark");</script><script type="module" src="/assets/index-1a2b3c.js"></script>`;
await writeFile(join(webRoot, "index.html"), INDEX_HTML);
await writeFile(join(webRoot, "assets", "index-1a2b3c.js"), "console.log(1)");
await writeFile(join(dir, "secret.txt"), "SECRET");

const app = new Hono();
app.get("*", await serveWeb(webRoot));
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });

afterAll(async () => {
  void server.stop(true);
  await rm(dir, { recursive: true, force: true });
});

/** Sends the path as written, like `curl --path-as-is`; `fetch` would resolve the dots first. */
const get = (target: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    let received = "";
    void Bun.connect({
      hostname: "127.0.0.1",
      port: Number(server.url.port),
      socket: {
        open: (socket) => {
          socket.write(`GET ${target} HTTP/1.1\r\nHost: evertap.test\r\nConnection: close\r\n\r\n`);
        },
        data: (_socket, chunk) => {
          received += new TextDecoder().decode(chunk);
        },
        close: () => {
          const split = received.indexOf("\r\n\r\n");
          resolve({
            status: Number(/^HTTP\/1\.1 (\d{3})/.exec(received)?.[1]),
            body: received.slice(split + 4),
          });
        },
        error: (_socket, error) => {
          reject(error);
        },
      },
    });
  });

test("serves the built files, and index.html for every route", async () => {
  expect(await get("/assets/index-1a2b3c.js")).toEqual({ status: 200, body: "console.log(1)" });
  expect(await get("/resources/blog")).toEqual({ status: 200, body: INDEX_HTML });
});

test("keeps the page to its own origin, apart from index.html's inline script, run by its hash", async () => {
  for (const path of ["/resources/blog", "/assets/index-1a2b3c.js"]) {
    const csp = (await app.request(path)).headers.get("content-security-policy");
    expect(csp).toStartWith("default-src 'self'; ");
    expect(csp).toContain(
      "script-src 'self' 'sha256-2m0LKtL9TkM7m6BmMncU8A6pAb9ikh3OzrtPZXy+uhU='; ",
    );
    expect(csp).toContain("frame-ancestors 'none'");
  }
});

test("hashes an inline script as a browser parses it, CRLF read as LF", () => {
  const html = `<script>\n  document.title = "evertap";\n</script>`;
  expect(contentSecurityPolicy(html.replaceAll("\n", "\r\n"))).toBe(contentSecurityPolicy(html));
});

test("never serves a file outside the web root", async () => {
  const targets = [
    "/../secret.txt",
    "/assets/../../secret.txt",
    "/%2e%2e/secret.txt",
    "/..%2fsecret.txt",
    "/assets/..%2f..%2fsecret.txt",
    "/..\\secret.txt",
    "/..%5csecret.txt",
    `/${join(dir, "secret.txt")}`,
  ];
  for (const target of targets) {
    const response = await get(target);
    expect(response.status, target).toBe(404);
    expect(response.body, target).not.toContain("SECRET");
  }
});
