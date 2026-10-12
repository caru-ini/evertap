import type { MetadataRoute } from "next";

import { SITE_URL } from "../lib/layout.tsx";
import { source } from "../lib/source.ts";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // vinext prerenders a metadata route only if it is cached; otherwise each request builds it.
  "use cache";
  return [
    { url: SITE_URL },
    ...source.getPages().map((page) => ({ url: `${SITE_URL}${page.url}` })),
  ];
}
