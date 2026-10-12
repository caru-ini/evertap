# evertap

Read this before changing anything here. It holds only what every change needs and the code does not show.

- Add a rule to this file only if it applies to more than one package, cannot be read from the code or config, and would slip past review when broken (security, data loss, a contract between packages) or is needed on every change. Otherwise it belongs in the package's own AGENTS.md. When unsure, leave it out of this file.
- Do not record status ("planned", "not yet", "done") or long rationale in any AGENTS.md. Both go stale.

## What this is

evertap is one box (a home server, a VPS, or your own computer) that hands out PostgreSQL, MySQL, Redis, and S3-compatible buckets (Garage) from a web UI and a CLI. It replaces the `db:` section of each project's Docker Compose: nothing to write, no ports to pick. One binary is both: `evertap serve` runs the server, and every other command is the CLI. It is for local development only and never deploys apps.

## Where things are

| Path                          | What                                                                                           | Read before changing it  |
| ----------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------ |
| `apps/web`                    | The SPA (Vite, React, TanStack Router and Query)                                               | `apps/web/AGENTS.md`     |
| `apps/server`                 | The server (Bun, Hono, the Docker Engine API) and the CLI                                      | `apps/server/AGENTS.md`  |
| `apps/site`                   | evertap.dev: the introduction page and the docs (vinext, Fumadocs, Cloudflare Workers)         | `apps/site/AGENTS.md`    |
| `docs`                        | The user documentation, read on GitHub and by the site                                         | `apps/site/AGENTS.md`    |
| `skills/evertap/SKILL.md`     | The agent skill: embedded in the binary for `evertap skills install`, and served by the site   |                          |
| `packages/api`                | The oRPC router, zod schemas, and rules shared by every interface                              | `packages/api/AGENTS.md` |
| `packages/ui`                 | Base UI wrappers and the logo, one CSS Module each, and the tokens in `src/styles/globals.css` |                          |
| `DESIGN.md`                   | The locked design system; lint with `bunx @google/design.md lint DESIGN.md`                    |                          |
| `.interface-design/system.md` | Interaction patterns                                                                           |                          |

## Verify a change

| Command                        | When                                                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check` / `pnpm check:ci` | oxlint and oxfmt, fixing / verifying                                                                                                                                                     |
| `pnpm check-types`             | Every change. It also generates the CSS Module types and the route tree                                                                                                                  |
| `pnpm test`                    | Every change                                                                                                                                                                             |
| `pnpm -F server test:docker`   | Changes under `apps/server/src/live/`. Runs the drivers against real containers (`evertap-test-*`); run it from one checkout at a time, since each run removes the last run's containers |
| `EVERTAP_DEMO=1 pnpm dev`      | UI work: sample data in memory, nothing started, no sign-in. Plain `pnpm dev` uses the real data directory, ports, and `evertap-*` containers                                            |
| `pnpm build`                   | Web build and the single binary at `dist/evertap`                                                                                                                                        |

Commits are conventional with a scope from `commitlint.config.ts`, such as `feat(web): …`. The subjects of `feat`, `fix`, and `perf` commits become `CHANGELOG.md` word for word at a release, so write them for people using evertap, and never edit `CHANGELOG.md` by hand. Work goes to `develop`, the default branch; `main` moves only when `pnpm release` makes a release.

## Where this repo differs from common defaults

- TypeScript 7 with `erasableSyntaxOnly` and `verbatimModuleSyntax`: relative imports carry their extension (`./x.ts`), and workspace packages are imported by name. No type assertions: oxlint bans `as` (`as const` and `satisfies` are fine).
- Base UI, not Radix: `render={<Button />}` instead of `asChild`. Read the wrapper in `packages/ui/src/components` before using a component.
- CSS Modules, no utility classes: one `x.module.css` beside each `x.tsx`, camelCase class names joined with `cx` (`@evertap/ui/lib/cx`), and the tokens in `globals.css`.
- No barrel files. Comments only for logic that is not obvious, one line where possible, in English.
- User-facing copy is English and never says container, server, image, or port. An error states the next action, not the cause. Commands shown to users are spelled `evertap`.

## Invariants

- Auth is on in every mode except the demo, and only the local Unix socket (`<data dir>/evertap.sock`) skips it. Never trust a request by its address: a user's own tunnel or Tailscale arrives from loopback or the LAN.
- `/api/rpc` takes a session cookie and oRPC's CSRF header; `/api/client/rpc` takes `Authorization: Bearer`. A cookie authenticates only a browser and a bearer token only a CLI or an API key, never the other way, or a page on another site could act as the user. A browser route outside oRPC needs the same proof: object downloads (`/api/objects`) take the cookie and a link signed by `data.objectUrl`, since a navigation cannot send the header.
- Approving a pairing, creating an API key, and revoking are for a person in the UI. Never expose `clients.*` through the CLI or MCP, or an agent can grant itself access.
- `protected` blocks only `resources.delete`. Anything other than the UI's delete dialog must call `resources.setProtected` first; that second step is what stops an agent from deleting data.
- Enforce rules (names, duplicates, protection) in the router in `packages/api`, not in the UI or a driver, so every interface gets them.
- Database URLs and bucket endpoints are always `ev.internal` on the engine's standard port (`DATABASE_HOST`, `DATABASE_PORTS`, and `STORAGE_PORTS` in `packages/api/src/rules.ts`), whatever the version or where evertap runs, so a project's `.env` never changes. A bucket reached from anywhere keeps that endpoint and adds `publicEndpoint` (`S3_PUBLIC_ENDPOINT`) for signing links only.
- Live mode creates and removes only containers, volumes, and networks whose names start with `EVERTAP_PREFIX` (`evertap`). Everything else on the host belongs to the user.
- Never publish a port through Docker on 0.0.0.0: Docker's iptables rules bypass `ufw`. Containers publish on 127.0.0.1, and evertap listens for them in-process.
- Only evertap holds the engines' root keys and admin tokens. Never expose an engine's own console or admin API.
- MCP goes over stdio through the CLI (`evertap mcp`). Never add an HTTP MCP endpoint, so there is one authorization path and no secret in an agent's settings.
- Do not edit the vendored skills under `.claude/skills/` (linked from `.agents/skills/`); updates replace them. Their license notices live in `THIRD_PARTY_NOTICES.md`.
- Not building: app deploys, git integration, domains and SSL, project or environment hierarchies, SSH, terminals, raw logs, Tailscale or WireGuard setup, declarative config files. When unsure, do not add.
