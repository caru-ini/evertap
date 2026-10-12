---
name: evertap
description: Create and manage development databases (PostgreSQL, MySQL, Redis) and S3-compatible buckets (Garage) with the evertap CLI, and put their connection details in a project's .env. Use when a project needs a database, cache, or bucket for development, or when evertap or ev.internal comes up.
---

# evertap

evertap hands out databases and buckets for development from one machine the person runs. You use
it through the `evertap` CLI, the same one the person uses. `evertap help` lists every command and
flag.

Connection details always use the host `ev.internal`, whatever the version and wherever evertap
runs. Use them exactly as evertap prints them: never swap `ev.internal` for `localhost` or an IP
address.

## Check that evertap is ready

Run `evertap status` first.

- "Signed in yes": go ahead.
- "Not signed in", or "Signed in no": ask the person to run `evertap login <url>` with the address
  they open evertap at. A person approves the sign-in in a browser; you cannot approve it yourself.

## Create and find resources

Services are `postgres`, `mysql`, `redis`, and `garage` (buckets).

```sh
evertap create postgres blog > /dev/null    # its output holds the password
evertap env blog >> .env                    # DATABASE_URL=postgres://…@ev.internal:5432/evertap_…
```

- `evertap list` shows names, services, and last use, and no secrets. Use it to see what exists.
- `evertap create <service> <name>` takes `--version <v>`, `--extension <e>` (PostgreSQL, such as
  `vector`), and `--note <text>`.
- Add `--temporary` for anything throwaway, such as a test run or an experiment. It is deleted after
  7 days without a connection.
- `evertap url <name>` prints a database's URL or a bucket's endpoint; `evertap env <name>` prints
  `.env` lines; `--json` on `list`, `get`, and `create` prints everything as JSON.
- If a database and a bucket share a name, add `--engine <service>`.
- "This service is still downloading for its first use" means the first resource of a version is
  on its way: wait a minute and run the same command again.
- Names: lowercase letters, digits, `_`, and `-` for databases; 3 to 63 lowercase letters, digits,
  and `-` for buckets. A PostgreSQL or MySQL URL names a generated user and database, not the name.
- The PostgreSQL user is a superuser in its own instance, and the MySQL user holds every privilege in
  its own, so the app can create test databases; it reaches a database it created by changing only
  the database at the end of the URL.
- A bucket's key can create more buckets with any name, such as one per test, without clashing with
  other projects. Deleting the resource deletes them too.

## Keep secrets out of the conversation

`create`, `get`, `url`, `env`, and `--json` print passwords and keys. Never let them reach your
output, a commit, or code:

- Send them straight to a file: `evertap env blog >> .env`, or `evertap create … > /dev/null`.
- Check that git ignores `.env` (`git check-ignore .env`) before writing to it.
- If `.env` already sets `DATABASE_URL`, `REDIS_URL`, or the `AWS_` names, ask before replacing
  them. Look at the names only: `cut -d= -f1 .env`.
- Read a single field without the rest: `evertap get blog --json | jq -r .engine`.

## Deleting and protection

- Run `evertap delete <name> --yes` only when the person names that resource and asks for it to be
  deleted. Its data is gone for good; evertap keeps no backups.
- A protected resource refuses deletion. Never run `evertap unprotect` unless the person asks for
  that resource to be unprotected.
- Ask the person before `evertap keep` (a temporary resource stops expiring), `evertap protect`, and
  `evertap reachable` (a bucket's signed links work on any device).

## When a connection fails

- `evertap doctor` checks Docker, each service, and whether evertap's entries answer.
- On a laptop paired with `evertap login`, apps reach `ev.internal` only while `evertap connect`
  runs. It never exits on its own:
  - Prefer asking the person to keep it running in a terminal of their own.
  - If you start it, run it in the background, do not wait for it to finish, and stop it with Ctrl+C
    or by ending its process once you are done.
  - The first time, it prints a `sudo` command that points `ev.internal` at it. Ask the person to
    run that.
- An app that runs in Docker does not reach `ev.internal`. Run the app directly on the machine.
