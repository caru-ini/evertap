import { Toaster } from "@evertap/ui/components/sonner";
import { TooltipProvider } from "@evertap/ui/components/tooltip";
import type { QueryClient } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, redirect, useLocation } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { CreateResourceDialog } from "@/features/resources/components/create-resource-dialog.tsx";
import { AppShell } from "@/features/shell/app-shell.tsx";
import { closeCreateResource, useCreateResource } from "@/lib/create-resource.ts";
import type { orpc } from "@/lib/orpc.ts";
import { useTheme } from "@/lib/theme.ts";

import "../styles.css";

export type RouterContext = {
  orpc: typeof orpc;
  queryClient: QueryClient;
};

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ context, location }) => {
    if (location.pathname === "/signin") {
      return;
    }
    const session = await context.queryClient.ensureQueryData(
      context.orpc.session.get.queryOptions(),
    );
    if (!session.signedIn) {
      throw redirect({ to: "/signin", search: { next: location.href } });
    }
  },
  component: RootLayout,
});

function RootLayout() {
  const theme = useTheme();
  const creating = useCreateResource();
  // Signing in comes before the app: no sidebar for pages that would only fail.
  const bare = useLocation({ select: (location) => location.pathname === "/signin" });

  return (
    <TooltipProvider>
      {bare ? (
        <Outlet />
      ) : (
        <AppShell>
          <Outlet />
        </AppShell>
      )}
      <CreateResourceDialog
        open={creating.open}
        onOpenChange={(open) => {
          if (!open) closeCreateResource();
        }}
        initialEngine={creating.engine}
      />
      <Toaster theme={theme} position="bottom-right" />
      {import.meta.env.DEV ? <TanStackRouterDevtools position="bottom-right" /> : null}
    </TooltipProvider>
  );
}
