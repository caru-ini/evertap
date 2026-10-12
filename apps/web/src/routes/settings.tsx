import { createFileRoute } from "@tanstack/react-router";

import { RouteError } from "@/components/route-error.tsx";
import { SettingsPage } from "@/features/settings/settings-page.tsx";

export const Route = createFileRoute("/settings")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(context.orpc.system.settings.get.queryOptions()),
      context.queryClient.ensureQueryData(context.orpc.system.settings.network.queryOptions()),
    ]);
  },
  errorComponent: ({ error, reset }) => (
    <RouteError title="Couldn't load the settings" error={error} reset={reset} />
  ),
  component: RouteComponent,
});

function RouteComponent() {
  return <SettingsPage />;
}
