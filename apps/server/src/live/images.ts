import type { DATABASE_VERSIONS, DatabaseEngine } from "@evertap/api/rules";

/**
 * The image each database version runs, pinned by index digest so that updating evertap, not
 * whatever the registry served first, moves an install to a newer patch release: a new digest
 * replaces the instance on the next start and keeps its volume. `scripts/pin-images.ts` moves them
 * before a release. A version no longer offered has no pin, and its instances follow the tag.
 */
export const DATABASE_IMAGES: Record<DatabaseEngine, Record<string, string>> = {
  postgresql: {
    "18": "pgvector/pgvector:pg18@sha256:2358fcba361ed2233a5ed81b5fe4ca779ccb304120ce531a3bf51c0ed7e2bc11",
    "17": "pgvector/pgvector:pg17@sha256:ac08538c6f8b9904c33c8224c5e5706dbe760aca29db1d096972b4052c22a75d",
    "16": "pgvector/pgvector:pg16@sha256:7b822b0aac60967beb1ea5e576b8602c94c300a157d187f385ae3e0da199b90a",
    "15": "pgvector/pgvector:pg15@sha256:47af0b65960b14f1c6945aa4ccae37836c632e9a6fe0eea9160936e616e5b2e9",
  },
  mysql: {
    "9.7": "mysql:9.7@sha256:e2bde46db6563855d7177adb5f0b57b9dc663f5a20927a90f4259d3312068497",
    "8.4": "mysql:8.4@sha256:6ea90827b1100f8f2ae306a539f86d2c264a26ed435a2a9f75551dd5c3aeb242",
  },
  redis: {
    "8.10": "redis:8.10@sha256:6f81e8915c60b065a524e6967e0ad1c639ba6efa84d669f823683ea04d9150ee",
    "8.2": "redis:8.2@sha256:164c759a0c342ee69d08fc99219382b0fd682181465c0df2e0e6911f4c85d73c",
    "7.4": "redis:7.4@sha256:c6eabf748fc7a61dbb5a705c78bcf3d6377b1127a97d0ce965c11c44ba46896f",
  },
} satisfies { [E in DatabaseEngine]: Record<(typeof DATABASE_VERSIONS)[E][number], string> };
