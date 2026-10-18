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
    "9.7": "mysql:9.7@sha256:c7cb87a9822f499375287930cbff71d6d3b201e346b45108b1115b435ee2df13",
    "8.4": "mysql:8.4@sha256:24989179f58856db763f418010c1169fecc944e3ec1ea7e921572d83eb070f70",
  },
  redis: {
    "8.10": "redis:8.10@sha256:2c2dff791878316e3b083188be0d578423b24813cdda5de0e80ea4f7b3e6bfd6",
    "8.2": "redis:8.2@sha256:47670742d7924adbcdb404d1288b6327815b23141969c0939b8e5d61f78c2634",
    "7.4": "redis:7.4@sha256:4fa24486b8bcca8eec45ee0eb166edc674795e53a2b53d1a9ef263eecebaac85",
  },
} satisfies { [E in DatabaseEngine]: Record<(typeof DATABASE_VERSIONS)[E][number], string> };
