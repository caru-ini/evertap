import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createClientRegistry, memoryClientTables } from "./clients.ts";

const NOW = new Date("2026-09-15T00:00:00.000Z");

describe("createClientRegistry", () => {
  it("refuses a request's secret on an approval stored with the request's hash", async () => {
    const tables = memoryClientTables();
    const registry = createClientRegistry(tables, () => NOW);
    const started = await registry.startPairing({ kind: "browser", name: "Browser", source: null });
    if (!started) {
      throw new Error("The machine running evertap is never capped");
    }
    await registry.approvePairing(started.code, null);
    // As an older evertap stored an approval: the client's token hash is the request's own.
    const requestHash = createHash("sha256").update(started.requestId).digest("hex");
    for (const record of tables.listClients()) {
      tables.putClient({ ...record, tokenHash: requestHash });
    }
    expect(await registry.authenticate(started.requestId, { ip: null })).toBeNull();
  });
});
