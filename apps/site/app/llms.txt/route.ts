import { llms } from "fumadocs-core/source";

import { source } from "../../lib/source.ts";

export async function GET() {
  return new Response(await llms(source).index());
}
