# apps/web

Rules for the SPA that the code does not show. Add a rule here only if it applies to `apps/web` alone, cannot be read from the code, and would be costly to get wrong. How a screen behaves is product design, not a rule for this file.

## Structure

- `routes/` stay thin: loaders, pending and error components, and the feature page they render. `routeTree.gen.ts` is generated.
- A feature never imports another feature (oxlint bans `@/features/*` inside `features/**`). Shared pieces go to `components/` or `lib/`.
- `lib/orpc.ts` holds the RPC client and the per-procedure defaults (silent errors, polling). It sends oRPC's CSRF header and sends any `UNAUTHORIZED` to `/signin`.
- `lib/use-now.ts` is the one clock per screen.
- Connection formats come from `@evertap/api/connections`, shared with the CLI. Their labels and masking live in `lib/resource-connections.ts`.
- An inline script in `index.html` is a bare `<script>` with no attributes: the server's CSP allows exactly those, by hash. `pnpm dev` sends no CSP, so check such a change on a build (`pnpm build`).

## Base UI

- `DropdownMenuLabel` must sit inside a group.
- Positioning props go on `*Content`.
- `onOpenChange` receives `(open, eventDetails)`.

## Styles

- Cascade layers are `reset, base, ui`, declared in `index.html` so load order cannot reorder them. `packages/ui` styles sit in `@layer ui`; app modules are unlayered and always win.
- An app class that overrides a ui component's property also overrides its `:hover`, `[data-popup-open]`, and `[aria-expanded]` rules for it. Restate those states, or prefer the component's `variant` and `size` props.
- `sr-only` is the one global class.
- Use `background-color`, not the `background` shorthand, which resets `background-clip`.
- Use `var(--text-sm--line-height)` and `var(--text-xs--line-height)` instead of a `calc()` ratio, which minifiers round.
- Dark mode is `:global(.dark) &`.

## Copy

- In the demo, show "Demo data — changes reset on restart. Connection details are examples." and never imply that a demo operation provisions a real service.
- Passwords and secret access keys stay masked on screen; copying returns the real value.
