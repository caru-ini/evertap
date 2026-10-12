import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "./procedures.ts";
import { clientsRouter } from "./routers/clients.ts";
import { dataRouter } from "./routers/data.ts";
import { extensionsRouter } from "./routers/extensions.ts";
import { resourcesRouter } from "./routers/resources.ts";
import { sessionRouter } from "./routers/session.ts";
import { systemRouter } from "./routers/system.ts";

export const appRouter = {
  health: publicProcedure.handler(() => ({ ok: true })),
  resources: resourcesRouter,
  extensions: extensionsRouter,
  data: dataRouter,
  clients: clientsRouter,
  session: sessionRouter,
  system: systemRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<AppRouter>;
