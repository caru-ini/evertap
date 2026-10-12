import { DataError } from "@evertap/api/context";
import { OBJECT_PAGE_SIZE, type ObjectStorage } from "@evertap/api/schemas";
import { AwsClient } from "aws4fetch";
import { S3Client } from "bun";

import type { StorageDriver } from "./driver.ts";

/** Requests evertap signs in their query are sent at once; this only bounds a stray one. */
const SIGNED_EXPIRY_S = 60;
/** Content-Type lookups in flight at once for one listing page. */
const STAT_PARALLEL = 16;
/** Deletes sent at once while emptying a bucket. */
const DELETE_BATCH = 50;

/** A client on the bucket with the resource's own key, as its owner's apps would connect. */
export const bucketClient = (
  resource: Pick<ObjectStorage, "name" | "region" | "accessKeyId" | "secretAccessKey">,
  endpoint: string,
) =>
  new S3Client({
    endpoint,
    region: resource.region,
    bucket: resource.name,
    accessKeyId: resource.accessKeyId,
    secretAccessKey: resource.secretAccessKey,
  });

const isMissingBucket = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "NoSuchBucket";

/** Signs as the resource's key, for S3 calls Bun's client does not offer. */
const signer = (resource: ObjectStorage) =>
  new AwsClient({
    accessKeyId: resource.accessKeyId,
    secretAccessKey: resource.secretAccessKey,
    service: "s3",
    region: resource.region,
  });

const objectPath = (resource: ObjectStorage, key: string) =>
  `/${resource.name}/${key.split("/").map(encodeURIComponent).join("/")}`;

/**
 * A PUT signed in its query, so the body goes out as it is instead of being hashed first: the
 * request a browser sends on a signed link.
 */
const putSigned = async (resource: ObjectStorage, url: URL, body: Blob, type: string) => {
  url.searchParams.set("X-Amz-Expires", String(SIGNED_EXPIRY_S));
  const headers: Record<string, string> = type === "" ? {} : { "content-type": type };
  const signed = await signer(resource).sign(url.toString(), {
    method: "PUT",
    headers,
    aws: { signQuery: true },
  });
  return fetch(signed.url, { method: "PUT", headers, body });
};

const xmlText = (xml: string, tag: string) =>
  new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1] ?? null;

const xmlEscape = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/**
 * An S3 answer as text. S3 may answer CompleteMultipartUpload with 200 and an error inside, so
 * the body is checked as well. A missing upload is the person's to retry; the rest are faults.
 */
const s3Call = async (response: Response, what: string) => {
  const body = await response.text();
  const code = xmlText(body, "Code");
  if (response.ok && (code === null || !body.includes("<Error>"))) {
    return body;
  }
  if (code === "NoSuchUpload" || code === "InvalidPart" || code === "InvalidPartOrder") {
    throw new DataError("The upload was interrupted. Upload the file again");
  }
  throw new Error(`${what}: ${response.status} ${body}`);
};

/** Deletes every object; the bucket itself stays. A bucket already gone counts as empty. */
export const emptyBucket = async (client: S3Client) => {
  for (;;) {
    let page;
    try {
      page = await client.list({ maxKeys: 1000 });
    } catch (error) {
      if (isMissingBucket(error)) {
        return;
      }
      throw error;
    }
    const keys = (page.contents ?? []).map((item) => item.key);
    if (keys.length === 0) {
      return;
    }
    for (let index = 0; index < keys.length; index += DELETE_BATCH) {
      await Promise.all(keys.slice(index, index + DELETE_BATCH).map((key) => client.delete(key)));
    }
  }
};

/**
 * The object browser, straight to the instance with the resource's own key: evertap reaches that
 * key's buckets alone, and its reads and writes do not count as use.
 */
export const createObjectBrowser = (
  instanceEndpoint: () => Promise<string>,
): Pick<
  StorageDriver,
  | "listBuckets"
  | "listObjects"
  | "putObject"
  | "startUpload"
  | "uploadPart"
  | "completeUpload"
  | "abortUpload"
  | "readObject"
  | "deleteObject"
> => ({
  listBuckets: async (resource) => {
    const body = await s3Call(
      await signer(resource).fetch(`${await instanceEndpoint()}/`),
      "ListBuckets",
    );
    const names = [...body.matchAll(/<Name>([^<]*)<\/Name>/g)].map((match) => match[1] ?? "");
    return [resource.name, ...names.filter((name) => name !== resource.name).toSorted()];
  },

  listObjects: async (resource, { prefix, cursor }) => {
    const client = bucketClient(resource, await instanceEndpoint());
    const page = await client.list({
      prefix,
      delimiter: "/",
      maxKeys: OBJECT_PAGE_SIZE,
      continuationToken: cursor,
    });
    // The empty object some tools write to mark a folder is the folder, not a file in it.
    const items = (page.contents ?? []).filter((item) => item.key !== prefix);
    // A listing carries no Content-Type, so each object is asked for its own.
    const types: (string | null)[] = [];
    // One iterator shared by the workers, so each object is asked once.
    const queue = items.entries();
    const worker = async () => {
      for (const [index, item] of queue) {
        const type = await client
          .stat(item.key)
          .then((stat) => stat.type)
          // Deleted between the listing and this lookup.
          .catch(() => "");
        types[index] = type === "" ? null : type;
      }
    };
    await Promise.all(Array.from({ length: Math.min(STAT_PARALLEL, items.length) }, worker));
    return {
      folders: (page.commonPrefixes ?? []).map((item) => item.prefix),
      objects: items.map((item, index) => ({
        key: item.key,
        sizeBytes: item.size ?? 0,
        lastModified: new Date(item.lastModified ?? 0).toISOString(),
        contentType: types[index] ?? null,
      })),
      cursor: (page.isTruncated ? page.nextContinuationToken : undefined) ?? null,
    };
  },

  putObject: async (resource, { key, type, body }) => {
    const url = new URL(`${await instanceEndpoint()}${objectPath(resource, key)}`);
    await s3Call(await putSigned(resource, url, body, type), "PutObject");
  },

  startUpload: async (resource, { key, type }) => {
    const url = `${await instanceEndpoint()}${objectPath(resource, key)}?uploads`;
    const body = await s3Call(
      await signer(resource).fetch(url, {
        method: "POST",
        headers: type === "" ? {} : { "content-type": type },
      }),
      "CreateMultipartUpload",
    );
    const uploadId = xmlText(body, "UploadId");
    if (uploadId === null) {
      throw new Error(`CreateMultipartUpload answered without an UploadId: ${body}`);
    }
    return { uploadId };
  },

  uploadPart: async (resource, { key, uploadId, partNumber, body }) => {
    const url = new URL(`${await instanceEndpoint()}${objectPath(resource, key)}`);
    url.searchParams.set("partNumber", String(partNumber));
    url.searchParams.set("uploadId", uploadId);
    const response = await putSigned(resource, url, body, "");
    await s3Call(response, "UploadPart");
    const etag = response.headers.get("etag");
    if (etag === null) {
      throw new Error("UploadPart answered without an ETag");
    }
    return { etag };
  },

  completeUpload: async (resource, { key, uploadId, parts }) => {
    const body = `<CompleteMultipartUpload>${parts
      .toSorted((a, b) => a.partNumber - b.partNumber)
      .map(
        (part) =>
          `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${xmlEscape(part.etag)}</ETag></Part>`,
      )
      .join("")}</CompleteMultipartUpload>`;
    const url = `${await instanceEndpoint()}${objectPath(resource, key)}?${new URLSearchParams({ uploadId }).toString()}`;
    await s3Call(
      await signer(resource).fetch(url, { method: "POST", body }),
      "CompleteMultipartUpload",
    );
  },

  abortUpload: async (resource, { key, uploadId }) => {
    const url = `${await instanceEndpoint()}${objectPath(resource, key)}?${new URLSearchParams({ uploadId }).toString()}`;
    const response = await signer(resource).fetch(url, { method: "DELETE" });
    if (response.status !== 404) {
      await s3Call(response, "AbortMultipartUpload");
    }
  },

  readObject: async (resource, key) => {
    const url = bucketClient(resource, await instanceEndpoint()).presign(key, {
      expiresIn: SIGNED_EXPIRY_S,
    });
    // An object stored gzip-encoded is downloaded as it is stored, not unpacked.
    const response = await fetch(url, { decompress: false });
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok || response.body === null) {
      throw new Error(`GetObject: ${response.status} ${await response.text()}`);
    }
    return { body: response.body, contentType: response.headers.get("content-type") };
  },

  deleteObject: async (resource, key) => {
    await bucketClient(resource, await instanceEndpoint()).delete(key);
  },
});
