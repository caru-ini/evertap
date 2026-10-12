import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createQueryClient, orpc } from "./lib/orpc.ts";
import { routeTree } from "./routeTree.gen.ts";

const queryClient = createQueryClient();

const router = createRouter({
  routeTree,
  context: { orpc, queryClient },
  defaultPreload: "intent",
  defaultPendingMs: 200,
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
  interface StaticDataRouteOption {
    /** Drops the reading column's width limit, for pages built around wide tables. */
    wide?: boolean;
  }
}

// index.html's spinner stays up until the fonts arrive, so the first paint doesn't reflow when
// they swap in; a slow box gets the app after a second anyway.
await Promise.race([
  Promise.all(
    [
      "400 1em Figtree",
      "500 1em Figtree",
      "600 1em Figtree",
      "700 1em Figtree",
      "400 1em 'JetBrains Mono'",
    ].map((font) => document.fonts.load(font)),
  ),
  new Promise((resolve) => setTimeout(resolve, 1000)),
]).catch(() => {});

const rootElement = document.getElementById("app");
if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
