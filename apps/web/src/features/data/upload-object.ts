import { OBJECT_PART_SIZE, OBJECT_PARTS_MAX, type CompletedPart } from "@evertap/api/schemas";

import { client } from "@/lib/orpc.ts";

/** Parts in flight at once for one file. */
const PARALLEL_PARTS = 3;

export const UPLOAD_MAX = OBJECT_PART_SIZE * OBJECT_PARTS_MAX;

/**
 * Sends a file through evertap's own origin, so it works from any page and device: one call when
 * it fits in a part, otherwise a multipart upload of OBJECT_PART_SIZE parts. `onSent` reports
 * bytes as each piece lands.
 */
export const uploadObject = async ({
  id,
  bucket,
  key,
  file,
  onSent,
}: {
  id: string;
  /** One of the resource's buckets; undefined for its first. */
  bucket: string | undefined;
  key: string;
  file: File;
  onSent: (bytes: number) => void;
}) => {
  const type = file.type;
  if (file.size <= OBJECT_PART_SIZE) {
    await client.data.putObject({ id, bucket, key, type, body: file });
    onSent(file.size);
    return;
  }

  const { uploadId } = await client.data.startUpload({ id, bucket, key, type });
  const count = Math.ceil(file.size / OBJECT_PART_SIZE);
  const parts: CompletedPart[] = [];
  let next = 1;
  // Once a part fails, the other workers start no more parts.
  let failed = false;
  const worker = async () => {
    while (!failed && next <= count) {
      const partNumber = next++;
      const start = (partNumber - 1) * OBJECT_PART_SIZE;
      const body = file.slice(start, start + OBJECT_PART_SIZE);
      try {
        const { etag } = await client.data.uploadPart({
          id,
          bucket,
          key,
          uploadId,
          partNumber,
          body,
        });
        parts.push({ partNumber, etag });
        onSent(body.size);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  // Every part in flight settles first, so none lands after the upload is aborted.
  const settled = await Promise.allSettled(
    Array.from({ length: Math.min(PARALLEL_PARTS, count) }, worker),
  );
  const rejected = settled.find((result) => result.status === "rejected");
  try {
    if (rejected) {
      throw rejected.reason;
    }
    await client.data.completeUpload({ id, bucket, key, uploadId, parts });
  } catch (error) {
    // The parts sent so far would otherwise take space until someone cleans them up.
    await client.data.abortUpload({ id, bucket, key, uploadId }).catch(() => undefined);
    throw error;
  }
};
