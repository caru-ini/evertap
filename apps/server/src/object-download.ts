import { type Caller, DataError, type Store } from "@evertap/api/context";
import { readObjectLink } from "@evertap/api/object-links";

// Never sniffed, and sandboxed should a browser show it, so an uploaded page cannot run on
// evertap's origin. Error answers carry them as well.
const SAFE_HEADERS = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; sandbox",
};

const text = (status: number, message: string) =>
  new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...SAFE_HEADERS },
  });

/** RFC 5987 leaves `'`, `(`, `)` and `*` out of `filename*`; encodeURIComponent keeps them. */
const filenameStar = (name: string) =>
  encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/**
 * Streams an object to a signed-in browser on a link from `data.objectUrl`. Failures answer in
 * plain text, since the browser shows them in place of the page.
 */
export const downloadObject = async (store: Store, caller: Caller, url: URL) => {
  if (caller.kind !== "person") {
    return text(401, "Sign in to evertap, then download the file again.");
  }
  const link = readObjectLink(url.searchParams);
  if (!link) {
    return text(403, "This download link has expired. Download the file again from evertap.");
  }
  const resource = await store.getResource(link.id);
  let object = null;
  if (resource?.kind === "object-storage") {
    try {
      object = await store.readObject({ ...resource, name: link.bucket }, link.key);
    } catch (error) {
      if (error instanceof DataError) {
        return text(400, error.message);
      }
      throw error;
    }
  }
  if (!object) {
    return text(404, "That file no longer exists. Reload the list in evertap.");
  }
  const name = link.key.slice(link.key.lastIndexOf("/") + 1);
  return new Response(object.body, {
    headers: {
      "content-type": object.contentType ?? "application/octet-stream",
      "content-disposition": `attachment; filename*=UTF-8''${filenameStar(name)}`,
      ...SAFE_HEADERS,
      "cache-control": "no-store",
    },
  });
};
