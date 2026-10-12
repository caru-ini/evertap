# Security policy

evertap holds the root keys of every engine it runs and accepts sign-ins over the network, so we
treat security reports as the most urgent kind of issue.

## Report a vulnerability

Report it privately through GitHub:
[Report a vulnerability](https://github.com/caru-ini/evertap/security/advisories/new) on the
repository's **Security** tab. Do not open a public issue, pull request, or discussion for it.

Include what you can of:

- What an attacker can do, and from where (the same machine, the LAN, the internet)
- Steps to reproduce, or a proof of concept
- The evertap version or commit, your OS, and your Docker Engine version
- Any setting you changed from the defaults (`EVERTAP_*` variables, a proxy, or a tunnel in front)

We aim to acknowledge a report within 7 days, keep you updated in the advisory while we work on a
fix, and credit you in the advisory unless you prefer not to be named. Please give us a reasonable
time to release a fix before you disclose the issue.

## Supported versions

Only the latest release gets security fixes. Work happens on `develop`, and a fix reaches you in
the next release; upgrade by running the install script again
([Upgrade](https://evertap.dev/docs/limitations#upgrade)).

## What counts

In scope, for example:

- Acting without signing in, or with a revoked session, pairing, or API key
- A page on another site acting as a signed-in user (CSRF, cookie or token confusion)
- A paired CLI or an API key approving a pairing, creating an API key, or revoking another client
- Deleting a protected resource without turning protection off first
- Reading or changing one resource's data with another resource's credentials
- Reaching an engine's root keys, admin API, or console through evertap
- evertap publishing a port on an address other than 127.0.0.1 through Docker, or touching Docker
  containers, volumes, or networks whose names do not start with `evertap`
- Reading or writing files outside the data directory or the bundled UI

Out of scope:

- Demo mode (`EVERTAP_DEMO=1`), which has no sign-in by design and starts nothing
- Anything that needs the account that runs evertap: its Unix socket skips sign-in by design, and
  that account can already reach Docker
- Bugs in PostgreSQL, MySQL, Redis, Garage, or ProxySQL themselves. Report those
  to their own projects
- Traffic that can be read or altered on the network because evertap serves plain HTTP and plain
  database protocols when nothing in front adds TLS
