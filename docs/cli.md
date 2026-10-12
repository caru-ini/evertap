---
title: CLI
---

One `evertap` binary is both the server (`evertap serve`) and the CLI. `evertap help` lists every
command with its flags. Errors go to standard error with the next step to take, and the exit status
is 1.

The CLI talks to the evertap on the same machine over its socket, which needs no sign-in, or to the
one `evertap login` paired it with, or to `EVERTAP_URL` with `EVERTAP_API_KEY` in CI
([Configuration](configuration.md#the-cli)).

## Resources

A resource is a database or a bucket. Commands that take `<name>` also take the resource's id.
Names are unique per service, so if a database and a bucket share one, add `--engine <service>`.

Services are `postgres` (also `postgresql` or `pg`), `mysql`, `redis`, and `garage` for buckets.

| Command                                                                                                       | What it does                                                 |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `evertap list [--engine <service>] [--json]`                                                                  | List resources, most recently used first                     |
| `evertap get <name> [--engine <service>] [--json]`                                                            | Show a resource and its connection details                   |
| `evertap create <service> <name> [--version <v>] [--extension <e>]... [--note <text>] [--temporary] [--json]` | Create a database or bucket and print its connection details |
| `evertap url <name> [--engine <service>]`                                                                     | Print a database's connection URL, or a bucket's endpoint    |
| `evertap env <name> [--engine <service>]`                                                                     | Print the connection details as `.env` lines                 |
| `evertap delete <name> [--engine <service>] [--yes]`                                                          | Delete a resource and its data                               |
| `evertap protect <name> [--engine <service>]`                                                                 | Protect a resource from deletion                             |
| `evertap unprotect <name> [--engine <service>]`                                                               | Allow a resource to be deleted again                         |
| `evertap keep <name> [--engine <service>]`                                                                    | Keep a temporary resource, so it no longer expires           |
| `evertap reachable <name> [--off] [--engine <service>]`                                                       | Let a bucket's signed links work anywhere, or stop that      |

### create

```sh
evertap create postgres blog
evertap create postgres search --version 17 --extension vector --note "search prototype"
evertap create redis cache
evertap create garage photos
```

- `--version` picks the major version, newest by default: PostgreSQL 18, 17, 16, or 15; MySQL 9.7 or
  8.4; Redis 8.10, 8.2, or 7.4. Buckets have none. A version cannot be changed after creation.
- `--extension` adds a PostgreSQL extension, such as `vector`, and can be repeated.
- `--note` sets the one-line note shown in lists.
- `--temporary` makes a resource that is deleted after 7 days without a connection. Each connection
  moves that to 7 days later. `keep` or `protect` makes it permanent. The UI never makes temporary
  resources.
- `--json` prints the resource as JSON, connection details included.

Names:

- PostgreSQL, MySQL, and Redis: a lowercase letter first, then lowercase letters, digits, `_`, or
  `-`, up to 63 characters. The name is only a label: the URL names a user and database evertap
  generates.
- Buckets: 3 to 63 lowercase letters, digits, or `-`, starting and ending with a letter or digit.
  The name is the first bucket's; its key can create more with any name
  ([Buckets](connecting.md#buckets)).

The first database of a version, or the first bucket, waits while its image downloads. If that takes
over a minute, `create` asks you to try again in a minute while the download goes on. Each MySQL
database starts a server of its own: the first of a version takes about 20 seconds to create, and
later ones about 4.

### reachable

`reachable` makes a bucket's signed links work on any device, through the address buckets have of
their own, and prints the `S3_PUBLIC_ENDPOINT` to sign them with; `--off` undoes it. Objects still
need a signature ([Signed links that work anywhere](connecting.md#signed-links-that-work-anywhere)).
It is refused in `local` mode, until buckets have an address, and for a bucket that shares its name
with a bucket on the other service, which an earlier evertap allowed.

### delete

`delete` asks you to type the name to confirm; `--yes` skips that, and is required without a
terminal. A protected resource cannot be deleted: run `evertap unprotect <name>` first. Deleting
removes the data for good; evertap keeps no backups.

## Pairing and status

| Command                                                      | What it does                                                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `evertap login <url>`                                        | Pair this machine with evertap; a person approves the code in a browser ([Connect](connecting.md)) |
| `evertap logout`                                             | Revoke this machine's token and forget the address                                                 |
| `evertap status`                                             | Show which evertap this CLI uses and whether it is signed in                                       |
| `evertap connect [--host <address>] [--engine <service>]...` | Carry database and bucket connections from this machine to evertap; keep it running                |
| `evertap doctor`                                             | Check Docker, each service, and the entries                                                        |

`evertap doctor` works from anywhere. On the machine running evertap it also shows the Docker socket,
the data directory, and why a service failed to start, which it leaves out over the network.

## Coding agents

Coding agents use the same CLI. The evertap skill tells them how: check `evertap status` first,
write connection details to `.env` without showing passwords, make throwaway resources temporary,
and delete or unprotect only what you name.

| Command                                                 | What it does                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| `evertap skills install [--agent <agent>]... [--force]` | Install the skill for the coding agents found on this machine |
| `evertap skills remove [--agent <agent>]... [--force]`  | Remove the skill                                              |

`install` lists where it writes first. It always writes `~/.agents/skills/evertap`, which many
agents read, and adds the skill to each of these agents whose directory exists, such as `~/.claude`
for Claude Code:

| Agent          | `--agent`        | Skill directory              |
| -------------- | ---------------- | ---------------------------- |
| Many agents    | `universal`      | `~/.agents/skills`           |
| Claude Code    | `claude-code`    | `~/.claude/skills`           |
| Codex          | `codex`          | `~/.codex/skills`            |
| Cursor         | `cursor`         | `~/.cursor/skills`           |
| Gemini CLI     | `gemini-cli`     | `~/.gemini/skills`           |
| GitHub Copilot | `github-copilot` | `~/.copilot/skills`          |
| OpenCode       | `opencode`       | `~/.config/opencode/skills`  |
| Windsurf       | `windsurf`       | `~/.codeium/windsurf/skills` |

`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, and `XDG_CONFIG_HOME` move those directories as they move the
agents' own. `--agent` writes for the agents you name instead, found or not. Nothing is written
inside your projects. `evertap skills update` is the same as `install`.

The skill is part of the `evertap` binary, so it matches the CLI you run and installs offline.
evertap records what it wrote in `~/.config/evertap/skills.json`. After an upgrade, the next
command you run rewrites those copies with the new skill, except the ones you changed since, and
says so once; `install --force` replaces those too. `remove` deletes the copies it wrote and keeps
the ones you changed, unless you add `--force`. An agent that is already running may need a restart
to see a change.

`evertap login` offers to install the skill once, in a terminal, after pairing.

evertap.dev serves the same skill for the [skills CLI](https://github.com/vercel-labs/skills). It
follows the newest evertap, which can be ahead of your CLI:

```sh
npx skills add https://evertap.dev
```

## On the machine running evertap

These run as the user that runs `evertap serve`, over its socket.

| Command                                                                                                                           | What it does                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `evertap serve`                                                                                                                   | Run evertap on this machine                                                                           |
| `evertap setup [--mode local\|network\|cloudflare] [--url <address>] [--listen <address>] [--zone <domain>] [--s3-url <address>]` | Choose where you open evertap from, then sign a browser in ([Install](install.md#set-up-and-sign-in)) |
| `evertap open`                                                                                                                    | Open evertap in a browser on this machine, signed in                                                  |
| `evertap signin-link`                                                                                                             | Print a one-time link and QR code that signs a browser in                                             |
| `evertap uninstall [--yes]`                                                                                                       | Remove everything evertap made on this machine, every database's data included                        |

`setup` asks questions in a terminal. With any flag, or without a terminal, it asks nothing and
takes the flags, the answers saved before, and the defaults. `--mode` takes `local` for This
computer only, `cloudflare` for Anywhere, through Cloudflare, and `network` for the other two:
listening on every interface (`--listen 0.0.0.0`) for Devices on your network, and on `127.0.0.1`
or Docker's bridge with `--url` for Behind your own proxy or tunnel ([Choose how evertap is
reached](modes.md)). For a Cloudflare Tunnel it creates,
setup in a terminal asks for the names of evertap and buckets and opens Cloudflare's page to
approve evertap, then waits for the code evertap.dev shows; without a terminal, it takes an API
token from `CLOUDFLARE_API_TOKEN` and the domain from `--zone`
([Cloudflare Tunnel](cloudflare.md#let-evertap-create-the-tunnel)). `--s3-url` gives buckets reached
from anywhere their address behind your proxy or your own tunnel; setup keeps the one saved before
without it, and never asks for one. A tunnel evertap creates serves them at the name you give it for
buckets.

`uninstall` lists what it will remove and asks you to type `uninstall`: evertap's Docker containers,
volumes, and network, its files in the data directory, this machine's sign-in, the agent skill it
installed, the `ev.internal` line in the hosts file, and on macOS the loopback alias and its startup
job. A copy of the skill you changed stays. Stop `evertap serve` first. A Cloudflare Tunnel that
evertap created stays in Cloudflare, and `uninstall` lists what to remove there
([Cloudflare Tunnel](cloudflare.md#remove-the-tunnel)). On a laptop, it signs out and removes the
agent skill and the `ev.internal` line. It does not remove the `evertap` binary or its systemd unit
([Limitations](limitations.md#uninstall)).

## Other

| Command                         | What it does      |
| ------------------------------- | ----------------- |
| `evertap version` / `--version` | Print the version |
| `evertap help`                  | List the commands |
