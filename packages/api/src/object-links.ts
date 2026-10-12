import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Where a browser downloads an object through evertap's own origin. */
export const OBJECT_LINK_PATH = "/api/objects";

/** How long a download link works; a download already under way keeps going. */
const LINK_WINDOW_MS = 5 * 60 * 1000;

// A restart makes a new key, which only ends the links handed out before it.
const KEY = randomBytes(32);

const sign = (id: string, bucket: string, key: string, expires: string) =>
  createHmac("sha256", KEY)
    .update(JSON.stringify([id, bucket, key, expires]))
    .digest("base64url");

/**
 * A link the browser opens to download an object. A navigation cannot carry the CSRF header, so
 * the signature stands in for it: only the page's own script, over RPC, can get one.
 */
export const signObjectLink = (id: string, bucket: string, key: string, now = Date.now()) => {
  const expires = String(now + LINK_WINDOW_MS);
  const signature = sign(id, bucket, key, expires);
  const query = new URLSearchParams({ id, bucket, key, expires, signature });
  return `${OBJECT_LINK_PATH}?${query.toString()}`;
};

/** The object a link names; null when evertap did not sign it or it has expired. */
export const readObjectLink = (query: URLSearchParams, now = Date.now()) => {
  const id = query.get("id");
  const bucket = query.get("bucket");
  const key = query.get("key");
  const expires = query.get("expires");
  const signature = query.get("signature");
  if (id === null || bucket === null || key === null || expires === null || signature === null) {
    return null;
  }
  if (!(Number(expires) > now)) {
    return null;
  }
  const expected = Buffer.from(sign(id, bucket, key, expires));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  return { id, bucket, key };
};
