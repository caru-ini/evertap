import { describe, expect, it } from "vitest";

import { tunnelNamesSchema } from "./schemas.ts";

const refusal = (input: { ui: string; storage?: string | null }) => {
  const parsed = tunnelNamesSchema.safeParse(input);
  return parsed.success ? "accepted" : parsed.error.issues.map((issue) => issue.message).join("; ");
};

describe("the names a tunnel evertap makes serves", () => {
  it("takes evertap's name as typed, and gives buckets s3. in the same domain", () => {
    expect(tunnelNamesSchema.parse({ ui: " https://DB.Example.com./ " })).toEqual({
      ui: "db.example.com",
      storage: "s3.example.com",
    });
    expect(tunnelNamesSchema.parse({ ui: "db.example.co.uk", storage: "" })).toEqual({
      ui: "db.example.co.uk",
      storage: "s3.example.co.uk",
    });
    expect(tunnelNamesSchema.parse({ ui: "db.example.com", storage: "Files.example.com" })).toEqual(
      { ui: "db.example.com", storage: "files.example.com" },
    );
  });

  it("refuses what DNS cannot name, or a domain with nothing under it", () => {
    expect(refusal({ ui: "*.example.com" })).toBe(
      "Use letters, digits, and hyphens between dots, such as evertap.example.com",
    );
    expect(refusal({ ui: "ever tap.example.com" })).toBe(
      "Use letters, digits, and hyphens between dots, such as evertap.example.com",
    );
    expect(refusal({ ui: "-db.example.com" })).toBe(
      "Use letters, digits, and hyphens between dots, such as evertap.example.com",
    );
    expect(refusal({ ui: `${"a".repeat(64)}.example.com` })).toBe(
      "Use letters, digits, and hyphens between dots, such as evertap.example.com",
    );
    expect(refusal({ ui: "example.com" })).toBe(
      "Give a name under your domain, such as evertap.example.com",
    );
    expect(refusal({ ui: "" })).toBe(
      "Use letters, digits, and hyphens between dots, such as evertap.example.com",
    );
  });

  it("keeps buckets' name apart from evertap's, one level under the same domain", () => {
    expect(refusal({ ui: "db.example.com", storage: "files.example.net" })).toBe(
      "Give buckets a name in example.com, such as s3.example.com",
    );
    // Two levels deep is another domain, which Universal SSL does not cover.
    expect(refusal({ ui: "db.example.com", storage: "files.db.example.com" })).toBe(
      "Give buckets a name in example.com, such as s3.example.com",
    );
    expect(refusal({ ui: "db.example.com", storage: "DB.example.com" })).toBe(
      "Give buckets a name of their own, such as s3.example.com",
    );
    expect(refusal({ ui: "s3.example.com" })).toBe(
      "Give buckets a name of their own, such as files.example.com",
    );
    expect(refusal({ ui: "db.example.com", storage: "*.example.com" })).toBe(
      "Use letters, digits, and hyphens between dots, such as s3.example.com",
    );
  });
});
