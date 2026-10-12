import { createFileRoute } from "@tanstack/react-router";

import { RouteError } from "@/components/route-error.tsx";
import { ResourcePage } from "@/features/resources/resource-page.tsx";

export const Route = createFileRoute("/resources/$id")({
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(
      context.orpc.resources.get.queryOptions({ input: { id: params.id } }),
    );
  },
  errorComponent: ({ error, reset }) => (
    <RouteError title="Couldn't open this resource" error={error} reset={reset} backTo="/" />
  ),
  component: RouteComponent,
});

function RouteComponent() {
  const { id } = Route.useParams();
  return <ResourcePage key={id} id={id} />;
}
