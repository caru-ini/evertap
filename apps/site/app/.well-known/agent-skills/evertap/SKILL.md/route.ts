import { skill } from "../../../../../lib/skill.ts";

export function GET() {
  return new Response(skill, { headers: { "content-type": "text/markdown; charset=utf-8" } });
}
