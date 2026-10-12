import { loader } from "fumadocs-core/source";
import { defineDocs } from "fumadocs-mdx/macro";

// The pages live in the repository's docs/ so they read the same on GitHub.
const docs = defineDocs({
  dir: "../../docs",
  docs: { postprocess: { includeProcessedMarkdown: true } },
});

export const source = loader({ baseUrl: "/docs", source: docs.toFumadocsSource() });
