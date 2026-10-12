import { skillIndex } from "../../../../lib/skill.ts";

export async function GET() {
  return Response.json(await skillIndex());
}
