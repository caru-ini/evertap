<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-dark.png">
    <img alt="evertap" src=".github/assets/logo-light.png" width="348">
  </picture>
</h1>

One box on your home server or VPS that hands out PostgreSQL®, MySQL®, Redis®, and S3-compatible
buckets (Garage) from a web UI and a CLI. It replaces the `db:` section of every project's
Docker Compose: nothing to write, no ports to pick, always running. Create a resource and copy its
connection details.

## What works

- All four engines run in Docker: create, delete, protection, Keep, and usage tracking. A bucket
  comes with its own key, which can also create more buckets of any name, apart from every other
  key's.
- A data browser: tables, rows, and SQL for PostgreSQL and MySQL; keys for Redis; objects in buckets.
- Connection details as a URI, `.env` lines, or the engine's own CLI (Credentials, `.env`, or the
  AWS CLI for buckets).
- Sign-in is always on: a browser signs in with a code another signed-in browser approves, or with a
  one-time link printed on the server. The CLI pairs with `evertap login`, and CI uses API keys.
- Demo mode (`EVERTAP_DEMO=1`) keeps sample data in memory, starts nothing, and has no sign-in.
- Coding agents use the CLI. `evertap skills install` gives Claude Code, Codex, Cursor, and other
  agents a skill that tells them how, and `evertap login` offers it.

Not in v0.1: MCP for agents, `evertap update` and `evertap repair`, and backups and restore
([Not in this version](https://evertap.dev/docs/limitations#not-in-this-version)).

## Install

On the machine that runs evertap, you need Linux with Docker Engine 24 or later that your user can
reach (the `docker` group), or macOS with Docker Desktop, OrbStack, or Colima. evertap finds
Docker's socket in the usual places and follows a `unix://` `DOCKER_HOST`; set
`EVERTAP_DOCKER_SOCKET` to use another. On Linux, use Docker 28 or later: before it, other machines on
your network can reach what Docker publishes on 127.0.0.1, and the Doctor warns about it.

```sh
curl -fsSL https://evertap.dev/install.sh | sh
```

The script first asks whether this is the machine that runs evertap or a laptop or CI that connects
to it, and never guesses. It installs the build for your system from the latest release as
`/usr/local/bin/evertap`, after checking it against the release's checksums. On the machine that
runs evertap, on Linux with systemd, it also starts evertap as a service at boot and runs
`evertap setup`. Without systemd, as on macOS, run `evertap serve` in a terminal. Run the script
again to upgrade. [Install](https://evertap.dev/docs/install) has the details and the requirements in full.

Until you choose how other machines reach it, evertap listens on 127.0.0.1 alone, with the UI on
`http://127.0.0.1:8080`. While it runs, choose on the same machine and as the same user:

```sh
evertap setup
```

It asks where you will open evertap from and only what that needs, applies the answer without a
restart, and ends with a one-time sign-in link and QR code for the first browser. For This computer
only it opens a signed-in browser instead. Without a terminal, give the answers as flags, such as
`evertap setup --mode network --listen 0.0.0.0` for your home network or
`evertap setup --mode network --url https://evertap.example.com` behind your own proxy.

Behind your own reverse proxy, setup prints a Caddy and an nginx configuration to paste, which pass
WebSocket upgrades, the Host header, and the caller's address on to evertap, then checks that the
address reaches this evertap and says what the proxy should change if not. A proxy run with Docker
reaches evertap on Docker's bridge (docker0, usually `172.17.0.1`), which setup offers as a place to
listen. On a machine with a public address, listening on every interface opens the sign-in page to
the internet over plain HTTP: setup and the server's log warn about it.

For Anywhere, through Cloudflare, setup or Settings creates the tunnel, its DNS records, and a Cache
Rule once you approve evertap in Cloudflare, gives the access back, and runs cloudflared in Docker
([Cloudflare Tunnel](https://evertap.dev/docs/cloudflare)).

Environment variables win over anything saved, and setup shows what they set instead of asking.
While one is set, neither setup nor Settings can change its setting, so set them only where nothing
is asked, as in [evertap's image](https://evertap.dev/docs/docker):

| Variable              | What it sets                                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EVERTAP_MODE`        | `network` for your home network or your own reverse proxy or tunnel, `cloudflare` for a Cloudflare Tunnel evertap runs, `local` for this machine alone                     |
| `EVERTAP_LISTEN_HOST` | Where the UI listens: `127.0.0.1` behind a proxy on this machine (the default), `0.0.0.0` for your home network, or Docker's bridge address behind a proxy run with Docker |
| `EVERTAP_PUBLIC_URL`  | The address browsers open evertap at, such as `https://evertap.example.com`; sign-in links point there                                                                     |

Under systemd, set them in `/etc/evertap/evertap.env`
([Settings for the service](https://evertap.dev/docs/install/linux#settings-for-the-service)).

evertap answers only to requests that name its own address, `localhost`, an IP address, or in
`network` mode its LAN name (`EVERTAP_HOST`, `evertap.local` unless set). Databases and buckets listen
on 127.0.0.1, where `evertap connect` reaches them through the UI's address. In `local` mode they
listen on `127.77.0.1` at their standard ports instead, and so does the UI, at
`http://ev.internal:8080` once that name leads there ([This machine only](#this-machine-only)).

Later, on the same machine, `evertap signin-link` prints another sign-in link and QR code, and
`evertap open` opens a signed-in browser there.

Once you are signed in, Settings shows how evertap is reached and can change that, as long as the
change keeps your browser connected. Make any other change with `evertap setup`.

It keeps its records in `~/.local/share/evertap` (`EVERTAP_DATA_DIR`) and touches only Docker
containers, volumes, and networks whose names start with `evertap`.

## Connect from your laptop

Database URLs and bucket endpoints always point at `ev.internal` on the engine's standard port,
such as `postgres://…@ev.internal:5432/…` or `http://ev.internal:3900`, so a project's `.env` stays
the same wherever evertap runs. On your laptop, install evertap with the same script, answering that
it connects to evertap on another machine. It needs no Docker there. Then run:

```sh
evertap login http://<server>:8080   # approve the code in a signed-in browser
evertap connect                      # keep it running
```

`evertap connect` prints the line to add to `/etc/hosts` (`127.77.0.1 ev.internal`) until it is
there. macOS has only `127.0.0.1` on loopback, so there `connect` first asks you to add the address
with `sudo ifconfig lo0 alias 127.77.0.1 netmask 255.255.255.255`, which lasts until a restart. If
something on your laptop already holds one of the ports (5432, 3306, 6379, 3900), `connect`
says what likely holds it and how to free it.

Presigned URLs point at `ev.internal` too. For links that must open on another device, such as in
a preview deployment or on a phone, make the bucket reachable from anywhere through an address of
buckets' own ([Connect from your laptop](https://evertap.dev/docs/connecting#signed-links-that-work-anywhere)).

## This machine only

In `local` mode, evertap runs on the machine that runs your apps, and they connect straight to
`ev.internal` with no `evertap connect`. Choosing "This computer only" in `evertap setup` points the
name at evertap's address with one sudo prompt: it adds `127.77.0.1 ev.internal` to `/etc/hosts`
and, on macOS, adds the address to the loopback with a startup job that adds it again after a
restart. Choosing another answer in setup, or `evertap uninstall`, removes them.

Something that listens on one of the standard ports on every address, such as a Compose file with
`"5432:5432"`, keeps evertap from listening there, and while evertap runs, such a Compose file
fails to start. Publish it on 127.0.0.1 instead, as `"127.0.0.1:5432:5432"`, which evertap leaves
free. The Doctor names each Docker container that clashes with evertap and what to change.

Only programs on this machine reach evertap in this mode, and not from inside a container on it:
an app that runs in Docker keeps its database in its own Compose file. Under WSL, Windows apps do
not reach an evertap running inside WSL.

## CLI

| Command                                      | What it does                                                  |
| -------------------------------------------- | ------------------------------------------------------------- |
| `evertap serve`                              | Run the server                                                |
| `evertap list` / `get` / `create` / `delete` | Manage resources; `create` prints the connection details      |
| `evertap url` / `env`                        | Print a connection URL or bucket endpoint, or `.env` lines    |
| `evertap protect` / `unprotect` / `keep`     | Guard a resource from deletion, or keep a temporary one       |
| `evertap reachable`                          | Let a bucket's signed links work on any device                |
| `evertap login` / `logout` / `status`        | Pair this machine with a server, or check which one it uses   |
| `evertap connect`                            | Carry database and bucket connections to the server           |
| `evertap doctor`                             | Check Docker, each service, and the entries                   |
| `evertap setup`                              | On the server: choose how other machines reach it             |
| `evertap open`                               | On the server: open a signed-in browser there                 |
| `evertap signin-link`                        | On the server: print a one-time link that signs a browser in  |
| `evertap uninstall`                          | Remove everything evertap made on this machine, data included |
| `evertap version` / `--version`              | Print the version                                             |

Run `evertap help` for every flag. `EVERTAP_API_KEY` and `EVERTAP_URL` let CI use the CLI without
`login`.

## Engines and their licenses

evertap does not include the engines. It pulls these images from Docker Hub the first time it needs
them, and each stays under its own license, which applies to your use of it.

| Service                            | Versions       | Image                             | License                                 |
| ---------------------------------- | -------------- | --------------------------------- | --------------------------------------- |
| PostgreSQL with pgvector           | 18, 17, 16, 15 | `pgvector/pgvector:pg<version>`   | PostgreSQL License                      |
| MySQL Community Server             | 9.7, 8.4       | `mysql:<version>`                 | GPL-2.0                                 |
| ProxySQL, in front of MySQL        | 3.0.2          | `proxysql/proxysql:3.0.2`         | GPL-3.0                                 |
| Redis                              | 8.10, 8.2      | `redis:<version>`                 | RSALv2, SSPLv1, or AGPLv3, at your pick |
| Redis                              | 7.4            | `redis:7.4`                       | RSALv2 or SSPLv1 only                   |
| Garage                             | 2.4.1          | `dxflrs/garage:v2.4.1`            | AGPL-3.0                                |
| cloudflared, for Cloudflare Tunnel | 2026.9.3       | `cloudflare/cloudflared:2026.9.3` | Apache-2.0                              |

Redis 7.4 has no OSI-approved open source license, and RSALv2 forbids offering Redis to others as a
service. Choose 8.2 or 8.10 when you need an open source license.

The first database of a version, or the first bucket, takes a few minutes while its image
downloads.

Each image is pinned by digest, so a database version runs the patch release that was newest when
your evertap was released, and pulling a newer one yourself, such as `docker pull mysql:8.4`, does
not change it. Updating evertap brings newer patch releases: when evertap starts, it replaces any of
its containers whose image or settings have changed, and keeps their data. The images they ran
stay on disk until you remove them, for example with `docker image prune -a`, which removes every
image no container uses.

## Contributing

Changes start with an issue: read [CONTRIBUTING.md](CONTRIBUTING.md) before you open a pull
request. It also covers live mode in development and the checks to run. To report a vulnerability,
follow [SECURITY.md](SECURITY.md). Everyone taking part follows the
[code of conduct](CODE_OF_CONDUCT.md), and [CHANGELOG.md](CHANGELOG.md) lists notable changes.

```sh
mise install
pnpm install
EVERTAP_DEMO=1 pnpm dev   # sample data, no Docker needed; UI on http://localhost:5173
```

- `apps/web`: the SPA (Vite, React, TanStack Router and Query)
- `apps/server`: the server (Bun, Hono, the Docker Engine API) and the CLI, built into one binary
- `packages/api`: the oRPC router and zod schemas, where the rules every interface shares live
- `packages/ui`: Base UI components styled with CSS Modules, and the design tokens

[AGENTS.md](AGENTS.md) holds the rules for contributors and coding agents, and
[DESIGN.md](DESIGN.md) the design system. Third-party notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Sponsoring

evertap is free for any use, at work included, and every feature stays free. If it saves you or
your team time, especially in a company, please consider
[sponsoring its development](https://github.com/sponsors/caru-ini).

## License

evertap is licensed under the [Apache License 2.0](LICENSE). The services it runs keep their own
licenses, listed in [Engines and their licenses](#engines-and-their-licenses).

## Trademarks

The evertap name and logo are not licensed with the code (section 6 of the license). You may use
them to refer to evertap, but not to name or brand your own product or service, or in a way that
suggests evertap made or endorses it, without permission.

evertap is an independent project. It is not affiliated with, endorsed, sponsored, supported, or
certified by the owners of the software it runs, and it uses their names only to say which software
that is.

- Postgres, PostgreSQL and the Slonik Logo are trademarks or registered trademarks of the PostgreSQL
  Community Association of Canada, and used with their permission.
- MySQL is a registered trademark of Oracle and/or its affiliates.
- Redis is a registered trademark of Redis Ltd. Any rights therein are reserved to Redis Ltd.
- Other names, including Garage and Cloudflare, may be trademarks of their respective owners.
