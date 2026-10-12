import { z } from "zod";

import { signedInProcedure } from "../procedures.ts";
import { DATABASE_VERSIONS } from "../rules.ts";
import { extensionSchema } from "../schemas.ts";

export const extensionsRouter = {
  list: signedInProcedure
    .input(
      z
        .object({
          version: z.enum(DATABASE_VERSIONS.postgresql).default(DATABASE_VERSIONS.postgresql[0]),
        })
        .default({ version: DATABASE_VERSIONS.postgresql[0] }),
    )
    .output(z.array(extensionSchema))
    .handler(({ input, context }) => context.store.listExtensions(input.version)),
};
