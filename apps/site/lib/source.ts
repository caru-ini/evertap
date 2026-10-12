import { loader } from "fumadocs-core/source";
import { defineDocs } from "fumadocs-mdx/macro";
import { createElement } from "react";

import { iconByName } from "./icons.tsx";

const docs = defineDocs({
  dir: "../../docs",
  // Files starting with `_` are parts that pages pull in with `<include>`, not pages.
  docs: { files: ["**/[!_]*.mdx"], postprocess: { includeProcessedMarkdown: true } },
});

export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
  icon: (name) => (name ? createElement(iconByName(name)) : undefined),
});
