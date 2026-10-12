import { createHash } from "node:crypto";
import { extname, join, normalize } from "node:path";

import type { Context } from "hono";

/** Compiled: `--asset ./public` lands next to the entry module. `bun run`: the web workspace's dist. */
const CANDIDATES = [join(import.meta.dir, "public"), join(import.meta.dir, "../../web/dist")];

export const findWebRoot = async () => {
  for (const dir of CANDIDATES) {
    if (await Bun.file(join(dir, "index.html")).exists()) {
      return dir;
    }
  }
  return null;
};

const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE = "no-cache";

/**
 * Everything comes from this origin, uploads and downloads included. Scripts come from it only,
 * apart from index.html's inline ones (the theme script), allowed by hash. Inline styles stay
 * allowed: sonner and react-remove-scroll add `<style>` elements as they run, which no hash covers.
 */
export const contentSecurityPolicy = (html: string) => {
  // Browsers hash the script as parsed, where a CRLF (a Windows checkout) reads as LF.
  const inline = [...html.replaceAll("\r\n", "\n").matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    ([, script = ""]) => `'sha256-${createHash("sha256").update(script).digest("base64")}'`,
  );
  return [
    "default-src 'self'",
    ["script-src 'self'", ...inline].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
};

export const serveWeb = async (webRoot: string) => {
  const csp = contentSecurityPolicy(await Bun.file(join(webRoot, "index.html")).text());
  return async (c: Context) => {
    const pathname = normalize(new URL(c.req.url).pathname);
    const filePath = join(webRoot, pathname);
    if (extname(pathname) !== "") {
      const file = Bun.file(filePath);
      if (!filePath.startsWith(webRoot) || !(await file.exists())) {
        return c.notFound();
      }
      return new Response(file, {
        headers: {
          "cache-control": pathname.startsWith("/assets/") ? IMMUTABLE : REVALIDATE,
          "content-security-policy": csp,
        },
      });
    }
    // Every other GET is a client-side route.
    return new Response(Bun.file(join(webRoot, "index.html")), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": REVALIDATE,
        "content-security-policy": csp,
      },
    });
  };
};
