import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { SignInPage } from "@/features/session/sign-in-page.tsx";

const searchSchema = z.object({
  /** Where to go once signed in; only paths inside the app. */
  next: z
    .string()
    .regex(/^\/(?!\/)/)
    .optional(),
});

export const Route = createFileRoute("/signin")({
  validateSearch: searchSchema,
  component: RouteComponent,
});

function RouteComponent() {
  const { next } = Route.useSearch();
  return <SignInPage next={next} />;
}
