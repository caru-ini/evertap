import { source } from "../../lib/source.ts";

export async function GET() {
  const pages = await Promise.all(
    source
      .getPages()
      .map(async (page) => `# ${page.data.title}\n\n${await page.data.getText("processed")}`),
  );
  return new Response(pages.join("\n\n"));
}
