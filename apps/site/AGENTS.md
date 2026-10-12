# apps/site

Rules for evertap.dev that the code does not show. Add a rule here only if it applies to `apps/site` or `docs/` alone, cannot be read from the code, and would be costly to get wrong.

## The docs

- The pages are the repository's `docs/*.md`, so they read the same on GitHub. Keep them plain Markdown with only `title` in the frontmatter and no H1; never use Fumadocs components (`<Steps>`, `<Tabs>`, `<Callout>`) there. Components are for the introduction page only.
- Link between pages as `modes.md#tailscale`, which GitHub follows; the docs page resolves it to `/docs/modes#tailscale`, and a link to a missing page fails the build. Anchors are GitHub's heading slugs.
- `docs/meta.json` sets the sidebar order. A new page goes there too.

## Styles

- Tailwind is here only because Fumadocs UI needs it. Our own components use CSS Modules on the tokens from `@evertap/ui/globals.css`, never utility classes. `app/global.css` points Fumadocs' `--color-fd-*` and fonts at those tokens and leaves Tailwind's preflight out, since the evertap reset is that preflight.
- The introduction page follows `DESIGN.md`, display sizes included. Its diagrams (`app/(home)/diagrams/`) are HTML on the tokens, not images, so they follow the theme and stack on narrow screens; keep their words to labels.
- `public/brands/` copies the Garage mark from `apps/web/public/brands/`, with its license. Change both together.
- A page that names an engine shows the README's trademark notice (`components/trademarks.tsx`) and writes `Redis®`.
- `public/screenshot-light.png` and `public/screenshot-dark.png` are All resources in the demo (`EVERTAP_DEMO=1`) at 1280×800 and twice the pixel density. Retake both when the UI changes.

## Build and deploy

- `pnpm build` prerenders every page into the Worker's static assets; route handlers (`/api/search`, `/llms.txt`, `/llms-full.txt`, `/.well-known/agent-skills/`) run in the Worker.
- `/install.sh` is a `307` to the install script in the latest GitHub release (`next.config.ts`). Never `308`, which browsers remember, and never copy the script into the site.
- Deploy with `pnpm -F site run deploy`, which decrypts `.env.production` with dotenvx before `cf` runs; `cf` alone reads the ciphertext and fails. `.env.keys` is never committed; CI has `DOTENV_PRIVATE_KEY_PRODUCTION`.
- `cf`, `@cloudflare/vite-plugin` (v2), and `vite` are pinned to exact versions: the plugin is a beta and `vinext init` pins the Vite it was tested with. `compatibilityDate` in `cloudflare.config.ts` stays at or before the oldest `workerd` they install, or `pnpm dev` does not start.
