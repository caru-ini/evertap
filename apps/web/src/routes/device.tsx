import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { DevicePage } from "@/features/clients/device-page.tsx";

const searchSchema = z.object({
  code: z.string().optional(),
});

export const Route = createFileRoute("/device")({
  validateSearch: searchSchema,
  component: RouteComponent,
});

function RouteComponent() {
  const { code } = Route.useSearch();
  return <DevicePage key={code} code={code} />;
}
