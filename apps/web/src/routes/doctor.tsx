import { createFileRoute } from "@tanstack/react-router";

import { RouteError } from "@/components/route-error.tsx";
import { DoctorPage } from "@/features/doctor/doctor-page.tsx";

export const Route = createFileRoute("/doctor")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(context.orpc.system.doctor.queryOptions());
  },
  errorComponent: ({ error, reset }) => (
    <RouteError title="Couldn't run the checks" error={error} reset={reset} />
  ),
  component: RouteComponent,
});

function RouteComponent() {
  return <DoctorPage />;
}
