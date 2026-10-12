# apps/site

Rules for evertap.dev that the code does not show. Add a rule here only if it applies to `apps/site` or `docs/` alone, cannot be read from the code, and would be costly to get wrong.

## The docs

- The pages are the repository's `docs/**/*.mdx`, written for the site: GitHub shows their text without the components, and `docs/README.md` sends readers here. The frontmatter holds `title`, `description`, and `icon`; no H1.
- Pages import nothing. They use what `app/docs/[[...slug]]/page.tsx` passes in: Fumadocs' `Cards`/`Card`, `Steps`/`Step`, `Tabs`/`Tab`, and `Callout`, and the diagrams in `components/diagrams/`. An icon, in the frontmatter or on a `Card`, is a name from `lib/icons.tsx`; an unknown one fails the build.
- A file whose name starts with `_` is not a page but a part that pages pull in with `<include>./_setup.mdx</include>`, so steps that two guides share are written once.
- Link between pages as `modes.mdx#tailscale` or `../modes.mdx`, which GitHub also follows; the docs page resolves it to `/docs/modes#tailscale`, and a link to a missing page fails the build. A `Card`'s `href` takes the same form. Anchors are GitHub's heading slugs.
- `docs/meta.json` sets the sidebar order, and a folder's own `meta.json` the order inside it. A new page goes there too.
- `scripts/install.sh` prints links into the docs (`/docs/install/linux#…`, `/docs/connecting#…`), and a released script keeps printing them, so keep those pages and headings where they are.

## Styles

- Tailwind is here only because Fumadocs UI needs it. Our own components use CSS Modules on the tokens from `@evertap/ui/globals.css`, never utility classes. `app/global.css` points Fumadocs' `--color-fd-*` and fonts at those tokens and leaves Tailwind's preflight out, since the evertap reset is that preflight.
- The introduction page follows `DESIGN.md`, display sizes included. Diagrams, its own (`app/(home)/diagrams/`) and the docs' (`components/diagrams/`), are HTML on the tokens, not images, so they follow the theme and stack on narrow screens; keep their words to labels.
- `public/brands/` copies the Garage mark from `apps/web/public/brands/`, with its license. Change both together.
- A page that names an engine shows the README's trademark notice (`components/trademarks.tsx`) and writes `Redis®`.
- `public/screenshot-light.png` and `public/screenshot-dark.png` are All resources in the demo (`EVERTAP_DEMO=1`) at 1280×800 and twice the pixel density. Retake both when the UI changes.

## Build and deploy

- `pnpm build` prerenders every page into the Worker's static assets; route handlers (`/api/search`, `/llms.txt`, `/llms-full.txt`, `/.well-known/agent-skills/`) run in the Worker.
- `/install.sh` is a `307` to the install script in the latest GitHub release (`next.config.ts`). Never `308`, which browsers remember, and never copy the script into the site.
- Deploy with `pnpm -F site run deploy`, which decrypts `.env.production` with dotenvx before `cf` runs; `cf` alone reads the ciphertext and fails. `.env.keys` is never committed; CI has `DOTENV_PRIVATE_KEY_PRODUCTION`.
- `cf`, `@cloudflare/vite-plugin` (v2), and `vite` are pinned to exact versions: the plugin is a beta and `vinext init` pins the Vite it was tested with. `compatibilityDate` in `cloudflare.config.ts` stays at or before the oldest `workerd` they install, or `pnpm dev` does not start.
