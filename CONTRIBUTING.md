# Contributing to evertap

Thanks for your interest. Please read how contributions work here before you write code: a pull
request that skips the first two steps may be closed without review.

## How a change gets in

1. **Open an issue first.** Describe the bug, with what `evertap --version` prints and your OS, or
   what you want to change and why. Search the existing issues before you open one.
2. **Wait for a maintainer to agree.** A maintainer replies on the issue and, if the change fits,
   agrees on the approach and assigns it to you. Ask on the issue if you want to take it.
3. **Open a pull request** against `develop` that links the issue (`Closes #123`) and keeps to what
   was agreed.
4. **Review and approval.** A maintainer reviews it, may ask for changes, and merges it once
   approved.

Pull requests without an issue a maintainer agreed to may be closed without review. This keeps
review time for changes the project will take, and saves you from writing code that cannot be
merged.

evertap is licensed under the [Apache License 2.0](LICENSE). Unless you say otherwise, what you
contribute is licensed under it too, as section 5 of the license sets out.

To report a vulnerability, do not open an issue. Follow [SECURITY.md](SECURITY.md) instead.

Some things are out of scope on purpose: app deploys, git integration, domains and SSL, project or
environment hierarchies, SSH, terminals, raw logs, Tailscale or WireGuard setup, and declarative
config files. Proposals for them will be declined.

You may use AI tools, but you are responsible for what you submit: read every line, run the checks
yourself, and be ready to explain any part of the change in review.

## Set up

You need [mise](https://mise.jdx.dev), or node 24, pnpm 12, and bun 1.4 installed yourself. Docker
is only needed for live mode and the driver tests.

```sh
mise install
pnpm install   # also installs the git hooks (lefthook)
```

On Windows, `.agents/skills` holds symbolic links. Clone with `git clone -c core.symlinks=true …`
(symbolic links need Developer Mode or an administrator shell), or they check out as plain text
files.

## Run it

```sh
EVERTAP_DEMO=1 pnpm dev   # UI on http://localhost:5173
```

Demo mode keeps sample data in memory, starts nothing, needs no Docker, and has no sign-in. Use it
for UI work.

Plain `pnpm dev` is live mode: it uses Docker, your real data directory (`~/.local/share/evertap`),
the same ports, and the same `evertap-*` containers as an evertap you run yourself, so do not run
both at once. To sign in, start it with the Vite URL as the public URL, then print a sign-in link
from `apps/server`:

```sh
EVERTAP_PUBLIC_URL=http://localhost:5173 pnpm dev
cd apps/server && bun src/main.ts signin-link
```

Without `EVERTAP_PUBLIC_URL`, the link points at `http://127.0.0.1:8080`, which in development
serves no UI or an old build.

## Build the binary

To run your change the way people run a release, or on a system with no release build, build the
single binary and use it as [Install](docs/install.md) describes:

```sh
pnpm build              # the web build and the single binary at dist/evertap
./dist/evertap serve    # the UI on http://127.0.0.1:8080, for this machine only
./dist/evertap setup    # in another terminal, while it runs
```

It needs Docker as an installed evertap does ([Requirements](docs/install.md#requirements)), and
uses the same data directory, ports, and `evertap-*` containers as live mode and an installed
evertap, so run one of them at a time.

## Check your change

| Command                        | When                                                  |
| ------------------------------ | ----------------------------------------------------- |
| `pnpm check` / `pnpm check:ci` | oxlint and oxfmt, fixing / verifying                  |
| `pnpm check-types`             | Every change                                          |
| `pnpm test`                    | Every change                                          |
| `pnpm -F server test:docker`   | Changes under `apps/server/src/live/`                 |
| `pnpm build`                   | The web build and the single binary at `dist/evertap` |

`test:docker` runs the drivers against real containers named `evertap-test-*`, and each run first
removes the containers the last run left. Run it from one checkout at a time on a machine.

## Code and commits

- [AGENTS.md](AGENTS.md) holds the rules every change follows, and `apps/web`, `apps/server`, and
  `packages/api` have their own `AGENTS.md`. They are written for people and coding agents alike.
- UI changes follow [DESIGN.md](DESIGN.md).
- Commits follow [Conventional Commits](https://www.conventionalcommits.org) with a scope from
  `commitlint.config.ts`: `web`, `server`, `site`, `api`, `ui`, `config`, `deps`, or `repo`.
  Documentation and CI use `repo`, as in `docs(repo): …` and `ci(repo): …`. The commit hook checks
  this.
- The subjects of `feat`, `fix`, and `perf` commits become the release's section of
  [CHANGELOG.md](CHANGELOG.md) word for word, so write them for people using evertap, as in
  `fix(web): keep the sidebar open after a reload`. Do not edit CHANGELOG.md by hand.

## Branches and releases

- `develop` is the default branch, and every change goes there. `main` moves only when a release is
  made, to the commit on `develop` it was made from.
- Every push to `develop` publishes a build of it: the `develop-build` prerelease, which
  `curl -fsSL https://evertap.dev/install.sh | EVERTAP_VERSION=develop sh` installs, and the
  `ghcr.io/caru-ini/evertap:develop` image. Its version is the next release's with
  `-dev.<commits since the last release>+<commit>`, such as `0.2.0-dev.14+a1b2c3d`. evertap.dev is
  deployed from `develop` too, when a push changes the site or `docs/`.
- A maintainer releases with `pnpm release` on `develop`. It pins the newest database images, takes
  the next version from the commits since the last release (until 1.0, `feat` or a breaking change
  raises the minor version and `fix` or `perf` the patch version; `site` and the other types are
  left out), writes that version's section of CHANGELOG.md with [git-cliff](https://git-cliff.org),
  commits and tags it, and once you confirm, pushes `develop`, `main`, and the tag. The tag builds
  the binaries and publishes the GitHub release and the container image. `pnpm release --dry-run`
  only prints the version and the section.

## Code of conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
