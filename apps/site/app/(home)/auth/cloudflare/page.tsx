import type { Metadata } from "next";

import { Approval } from "./approval.tsx";

export const metadata: Metadata = {
  title: "Approve evertap in Cloudflare",
  robots: { index: false, follow: false },
  // The address holds the code until the page reads it; no link out should carry it along.
  referrer: "no-referrer",
};

/**
 * Where Cloudflare sends the browser once the person approves evertap. It shows the code to paste
 * back into evertap, since only that evertap holds what turns the code into access.
 */
export default function CloudflareApproval() {
  return <Approval />;
}
