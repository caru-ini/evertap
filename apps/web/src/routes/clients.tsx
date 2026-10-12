import { createFileRoute } from "@tanstack/react-router";

import { RouteError } from "@/components/route-error.tsx";
import { ClientsPage } from "@/features/clients/clients-page.tsx";

export const Route = createFileRoute("/clients")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(context.orpc.clients.list.queryOptions());
  },
  errorComponent: ({ error, reset }) => (
    <RouteError title="Couldn't load the clients" error={error} reset={reset} />
  ),
  component: RouteComponent,
});

function RouteComponent() {
  return <ClientsPage />;
}
