import { expect, test } from "vitest";

import { readApproval } from "./approval.tsx";

test("joins the code and state to paste as one", () => {
  expect(readApproval("?code=ory_ac_abc.def-1~2&state=xyz_123&scope=zone.read")).toEqual({
    kind: "code",
    value: "ory_ac_abc.def-1~2#xyz_123",
  });
});

test("says why Cloudflare refused in the page's own words, never the address's", () => {
  expect(
    readApproval("?error=access_denied&error_description=Call+us+at+555-0100+to+fix+this"),
  ).toEqual({ kind: "refused", reason: "The approval was declined, so evertap has no access." });
  expect(readApproval("?error=invalid_state&error_description=Anything")).toEqual({
    kind: "refused",
    reason: "Cloudflare could not finish the approval (invalid_state).",
  });
  expect(readApproval("?error=Visit+example.com+now")).toEqual({
    kind: "refused",
    reason: "Cloudflare could not finish the approval.",
  });
});

test("has nothing to show without a code, or for one no code looks like", () => {
  expect(readApproval("")).toEqual({ kind: "none" });
  expect(readApproval("?code=Call+us+at+555-0100&state=abc")).toEqual({ kind: "none" });
  expect(readApproval("?code=abc&state=Visit+example.com")).toEqual({ kind: "none" });
});
