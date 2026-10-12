import type { Database } from "@evertap/api/schemas";
import { describe, expect, it } from "vitest";

import { recentResources } from "./recent-resources.ts";

const database = (
  id: string,
  createdAt: string,
  lastConnectedAt: string | null = null,
): Database => ({
  id,
  name: id,
  description: "",
  protected: false,
  expiresAt: null,
  sizeBytes: 0,
  lastConnectedAt,
  createdAt,
  kind: "database",
  engine: "postgresql",
  version: "18",
  connectionUrl: `postgres://${id}:fake-password@evertap.local:6432/${id}`,
  extensions: [],
});

describe("recentResources", () => {
  it("puts the latest connection first and cuts to the limit", () => {
    const rows = [
      database("old", "2026-09-01T00:00:00.000Z", "2026-09-02T00:00:00.000Z"),
      database("busy", "2026-08-01T00:00:00.000Z", "2026-09-19T00:00:00.000Z"),
      database("idle", "2026-07-01T00:00:00.000Z", "2026-07-02T00:00:00.000Z"),
    ];
    expect(recentResources(rows, 2).map((row) => row.id)).toEqual(["busy", "old"]);
  });

  it("counts a resource nobody has connected to from its creation", () => {
    const rows = [
      database("connected", "2026-09-01T00:00:00.000Z", "2026-09-10T00:00:00.000Z"),
      database("new", "2026-09-19T00:00:00.000Z"),
    ];
    expect(recentResources(rows, 3).map((row) => row.id)).toEqual(["new", "connected"]);
  });
});
