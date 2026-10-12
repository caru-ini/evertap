# Changelog

Notable changes to evertap are listed here, and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). After 0.1.0,
[git-cliff](https://git-cliff.org) writes each release's section from the subjects of its
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

## [0.1.1](https://github.com/caru-ini/evertap/compare/v0.1.0...v0.1.1) - 2026-10-12

### Bug Fixes

- _(server)_ Show PostgreSQL's errors and run multi-statement SQL again

## [0.1.0](https://github.com/caru-ini/evertap/releases/tag/v0.1.0) - 2026-10-12

### Added

- PostgreSQL, MySQL, Redis, and Garage resources in Docker: create, delete, protect, keep, and
  usage tracking.
- Each PostgreSQL, MySQL, and Redis database runs an instance of its own. Its user is a superuser in
  PostgreSQL and holds every privilege in MySQL, so apps and frameworks can create and drop
  databases, such as Prisma's shadow database and test databases, and create roles, triggers, and
  stored functions. Each connection keeps a session of its own, and Redis takes every command.
- Buckets from Garage. A bucket comes with its own key, which can create more buckets with any name,
  apart from every other key's; deleting the bucket resource deletes them too. Buckets use the
  region `us-east-1`, their `.env` lines keep the AWS SDKs' default checksums from failing, ACL
  requests succeed and change nothing, and buckets an app creates allow browsers from any origin,
  as the first one does.
- A data browser: tables, rows, and SQL for PostgreSQL and MySQL; keys for Redis; objects in
  buckets.
- Connection details as a URI, `.env` lines, or the engine's own CLI.
- Sign-in: browser sign-in approved from another signed-in browser, which shows the requester's
  name and IP address, or by a one-time link; CLI pairing with `evertap login`; and API keys
  for CI. Over HTTPS, sign-in cookies carry a `__Host-` name, so another subdomain cannot set them,
  and the UI sends security headers and a Content Security Policy.
- The `evertap` CLI, including `connect` to carry database and bucket connections from a laptop, and
  `uninstall` to remove everything evertap made on a machine.
- `evertap setup`, run on the machine hosting evertap: it asks where you will open evertap from
  (this computer only, devices on your network, anywhere through Cloudflare, or behind your own
  proxy or tunnel), or takes flags, applies the answer without a restart, and ends with a sign-in
  link and QR code.
  Until then, evertap listens on 127.0.0.1 alone. `evertap open` opens a signed-in browser on that
  machine.
- Behind your own reverse proxy, `evertap setup` prints Caddy and nginx configurations and checks
  that the public address reaches this evertap. A proxy run with Docker can reach evertap on
  Docker's bridge, and evertap takes the caller's address from it as from a proxy on 127.0.0.1.
  Listening on every interface of a machine with a public address prints a warning.
- Anywhere, through Cloudflare: from Settings or `evertap setup`, you name evertap and its buckets'
  address and approve evertap on Cloudflare's own page, or paste an API token from a link that fills
  in its permissions. evertap creates the tunnel, its DNS records, and a Cache Rule, runs cloudflared
  in Docker, switches to the tunnel only once it connects, and hands Cloudflare's access back when
  done, keeping no Cloudflare credential. The Doctor and Settings show the tunnel's state, and
  choosing another answer can remove what evertap made. A tunnel you run yourself works too, as
  behind your own proxy or tunnel.
- Demo mode (`EVERTAP_DEMO=1`) with sample data in memory.
- Database images pinned by digest: updating evertap brings newer patch releases of each version
  and keeps the data. Before an update changes the format of evertap's records, evertap keeps a copy
  of them.
- A daily check for a newer release: the UI's sidebar, the Doctor, `evertap doctor`, and the log say
  when one is out and how to upgrade, and on a laptop, `evertap doctor` and `evertap connect` say
  when the CLI is older than the evertap it uses. `EVERTAP_UPDATE_CHECK=0` turns the check off.
- Settings in the UI: where evertap is opened from, where databases and buckets listen, and what
  environment variables fix. Change access asks the same question as setup and shows the new address
  first; when the change leaves the browser without its way in, it opens the new address with the
  browser signed in there.
- Release binaries for Linux and macOS (x64 and arm64) with SHA-256 checksums and build
  provenance, and an install script (`curl -fsSL https://evertap.dev/install.sh | sh`) that verifies
  the checksum. It first asks whether the machine runs evertap or connects to one, and never
  guesses; without a terminal, `EVERTAP_ROLE=host` or `EVERTAP_ROLE=client` answers. On the machine
  that runs evertap under systemd, it installs and starts the service, waits for it to answer, and
  runs `evertap setup` the first time. Running it again upgrades or repairs evertap, and puts the
  previous version back if the new one does not start.
- The Apache License 2.0, included in each release archive.
- A container image for Linux (amd64 and arm64), published to the GitHub Container Registry with
  each release, and a guide to running it with Docker Compose (`docs/docker.md`): configured by
  environment variables alone, with Docker's socket, the data directory at the same path as on the
  host, and the host's network.
- Local mode setup: `evertap setup` points `ev.internal` at evertap with one sudo prompt, adding
  the hosts entry and, on macOS, a loopback alias that comes back after a restart. Choosing another
  mode in setup, or `evertap uninstall`, removes them.
- The Doctor names Docker containers that publish where evertap listens and says what to change
  in their Compose file: a running one keeps evertap from listening, and a stopped one cannot start
  while evertap runs. In `local` mode it also checks that `ev.internal` leads to evertap.
- evertap finds the Docker socket of Docker Desktop, OrbStack, Colima, and rootless Docker, and
  follows a `unix://` `DOCKER_HOST`.
- Buckets reached from anywhere: a switch per bucket, on its page, as `evertap reachable`, and in
  the API, makes its signed links work on any device, such as a preview deployment or a phone,
  through an address of buckets' own: `s3.<domain>` with the tunnel setup creates, or one your
  proxy or own tunnel serves. A separate entry answers for
  switched-on buckets only, still needs a signature on every request, and tells a CDN not to keep
  its answers. The bucket's endpoint stays at `ev.internal`; its `.env` gains `S3_PUBLIC_ENDPOINT`
  for signing links. Setup takes the address as `--s3-url` and prints a Caddy and an nginx
  configuration for it.
- Agent skills: `evertap skills install` writes the evertap skill to `~/.agents/skills` and to the
  skill directories of the coding agents it finds (Claude Code, Codex, Cursor, and others), and
  `evertap skills remove` takes it out. The skill is part of the binary, so it matches the CLI and
  installs offline; installed copies are refreshed when the CLI is updated, except ones you have
  edited. `evertap login` offers to install it once. evertap.dev serves the same skill at
  `/.well-known/agent-skills/`, so `npx skills add https://evertap.dev` installs it too.
