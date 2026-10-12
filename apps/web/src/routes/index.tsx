import { RESOURCE_ENGINES } from "@evertap/api/rules";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { RouteError } from "@/components/route-error.tsx";
import { ResourcesSkeleton } from "@/features/resources/components/resources-skeleton.tsx";
import { ResourcesPage } from "@/features/resources/resources-page.tsx";

const searchSchema = z.object({
  engine: z.enum(RESOURCE_ENGINES).optional(),
});

export const Route = createFileRoute("/")({
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(context.orpc.resources.list.queryOptions());
  },
  pendingComponent: ResourcesSkeleton,
  errorComponent: ({ error, reset }) => (
    <RouteError title="Couldn't load the list" error={error} reset={reset} />
  ),
  component: RouteComponent,
});

function RouteComponent() {
  const { engine } = Route.useSearch();
  // The key drops the typed filter when the sidebar moves to another engine on the same route.
  return <ResourcesPage key={engine ?? "all"} engine={engine} />;
}
