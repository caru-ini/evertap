# packages/api

Rules for the router, the schemas, and the shared rules that the code does not show. Add a rule here only if it applies to `packages/api` alone, cannot be read from the code, and would be costly to get wrong.

- `src/rules.ts` has no dependencies: the web bundle imports it, so keep zod and server code out of it.
- Pick the narrowest procedure in `src/procedures.ts`: `publicProcedure` only for asking to sign in or pair, `signedInProcedure` for resources, data, and system, `personProcedure` for `clients.*` and `system.settings`, and `localProcedure` for what only the machine running evertap may do (`session.link`).
- A resource is temporary when `expiresAt` is set; the time is the marker, not a flag. Only the API sets it (`resources.create({ temporary: true })`), `resources.keep` clears it, and protecting a temporary resource keeps it.
- Clients have one permission level. Do not add scopes, roles, or a chosen expiry.
- Tokens are stored as SHA-256 hashes and looked up by hash. Never store or log a token itself.
