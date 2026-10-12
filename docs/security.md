---
title: Security
---

evertap is for development data, not production. It still holds the root keys of every database
and bucket service it runs, and it takes sign-ins over the network, so this page sets out what it
exposes and what it trusts. To report a vulnerability, follow
[SECURITY.md](https://github.com/caru-ini/evertap/blob/main/SECURITY.md).

## What listens where

On the machine running evertap:

| What                                  | `network` and `cloudflare`                  | `local`                              | Before setup |
| ------------------------------------- | ------------------------------------------- | ------------------------------------ | ------------ |
| The UI and API (`EVERTAP_PORT`, 8080) | The address chosen in setup                 | `127.77.0.1`                         | `127.0.0.1`  |
| Database and bucket entries           | `127.0.0.1`: 6432, 3306, 6379, 3900         | `127.77.0.1`: 5432, 3306, 6379, 3900 | `127.0.0.1`  |
| The services in Docker                | `127.0.0.1`, on ports Docker picks          | The same                             | The same     |
| ProxySQL, in front of MySQL           | Unix sockets in the data directory          | The same                             | The same     |
| The CLI's socket                      | `evertap.sock` in the data directory        | The same                             | The same     |
| Buckets reached from anywhere (9900)  | Beside the UI, once buckets have an address | None                                 | None         |

- Only the UI ever listens where other machines can connect, and only in `network` mode when you
  choose such an address. In `cloudflare` mode, other machines reach it through your tunnel.
  Databases and buckets are reached from other machines only through the UI's address, by a
  signed-in `evertap connect`.
- The one exception is a bucket you make reachable from anywhere, through the address you give
  buckets ([Signed links that work anywhere](connecting.md#signed-links-that-work-anywhere)). Its
  entry listens beside the UI, on its own port, so evertap tells its requests apart by where they
  arrive, not by a Host header anyone can send. It reads which key signed a request where Garage
  reads it: a presigned link's query before any Authorization header, and a form upload's own
  fields, by part, up to its file. It answers only requests signed with the key of a bucket switched
  on, and refuses one that names more than one key or a form it cannot read plainly, so no request
  can name one key to evertap and another to Garage. Garage then checks the signature, so a request
  reaches that key's buckets alone. It listens on another address of the machine only when you chose
  one for the UI; for every interface it stays on `127.0.0.1`.
- evertap never asks Docker to publish on `0.0.0.0`. Docker's firewall rules bypass `ufw`, so a port
  Docker published there would be open whatever `ufw` says.
- Docker Engine before 28.0, and 28.2 to 28.3.2 once firewalld reloads, lets other machines on the
  same network reach what Docker publishes on `127.0.0.1`. The Doctor warns about it; update Docker.
- Listening on every interface of a machine with an address the internet routes to opens the
  sign-in page to the internet over plain HTTP. Setup, Settings, and the log warn about it.
- The engines' own admin APIs, such as Garage's, are never published. evertap alone holds their
  keys.
- A PostgreSQL database's user is a superuser in a PostgreSQL instance of its own, so it can also
  run programs there, and a MySQL database's user holds every privilege in a MySQL instance of its
  own. The instances share one Docker network on which they cannot reach one another, nor the other
  services evertap runs in Docker. evertap manages each with a superuser of its own, whose password
  differs in every one and which no connection through the entry can log in as.
- ProxySQL, which takes MySQL logins, runs on the host's network so that it can reach each MySQL
  instance where Docker publishes it. It listens on no port, only on Unix sockets in
  `mysql/sockets` in the data directory, which the user running evertap alone can enter, so no one
  else on the machine can take its place or log in to it. It sends a statement to another
  database's instance when a comment names that one's route (`/* ;hostgroup=2 */`), but that
  instance refuses the login, as it holds no user but its own.

On a laptop, `evertap connect` listens on `127.77.0.1` alone unless you pass `--host`.

## Signing in

Every request that arrives over the network needs a sign-in, in every mode and from every address,
including `127.0.0.1`: a tunnel or proxy on the same machine arrives from there too. Only two things
skip it:

- The CLI on the machine running evertap, over `evertap.sock`. The data directory is readable by
  the user running evertap alone, and so is the socket in it.
- Demo mode (`EVERTAP_DEMO=1`), which has no real data and no sign-in.

evertap has no passwords. There are two kinds of sign-in:

| Who                       | How it signs in                                                                                                  | What it sends                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| A browser                 | A signed-in browser approves the code it shows, or a one-time link from `evertap signin-link` or `evertap setup` | A session cookie                |
| A paired CLI, or a script | `evertap login`, approved in a signed-in browser; or an API key created in the UI                                | `Authorization: Bearer <token>` |

- A cookie works only on the UI's API, which also needs a header that only evertap's own pages send,
  so another site cannot act as you. A token works only on the CLI's API. Neither works on the
  other's.
- The session cookie is `HttpOnly` and `SameSite=Strict`. Over HTTPS it is also `Secure` and a
  `__Host-` cookie, so a site on another subdomain of your domain cannot set or replace it. A
  browser stays signed in for 30 days after its last request.
- Codes and sign-in links expire after 10 minutes, and a link works once. The approval page shows
  the request's address, the machine's name, and when it was made: approve only a code you just
  saw yourself.
- Approving sign-ins, creating API keys, and revoking are for a person in the UI. A paired CLI or an
  API key can do everything else, but cannot add or remove clients, so a leaked token cannot grant
  itself more access.
- A protected resource cannot be deleted. From the CLI or the API, protection has to be turned off
  first, as a separate step (`evertap unprotect`).
- evertap keeps tokens and API keys only as SHA-256 hashes. An API key is shown once, when it is
  created.
- Clients in the UI lists every browser, CLI, and API key, with where it was last used from.
  Revoking one ends it at once; its open database connections close within about a minute.
- While sign-ins wait for approval, each address can hold 5 of them, so one caller cannot keep
  everyone else from signing in. `evertap signin-link` is never limited.

The CLI saves its token in `~/.config/evertap/config.json`, readable by your user alone. Anyone with
that file acts as you. `evertap logout` revokes it.

## Addresses and names evertap trusts

- evertap never trusts a request because of where it comes from.
- It answers only to requests that name its own address, `localhost`, an IP address, or in `network`
  mode its name on your network. A web page that points its own hostname at your machine is turned
  away.
- In `network` and `cloudflare` mode, a request from loopback or from a Docker bridge network comes
  from a proxy, a tunnel, or a container on this machine, so evertap takes the caller's address from
  the last entry of `X-Forwarded-For`. The network the database instances share does not count, as
  their users can run programs there. From anywhere else, and in `local` mode, it takes the
  connection's own address. A proxy on this machine must add the address it saw to
  `X-Forwarded-For`, not pass on what the caller sent, or callers can pretend to be someone else
  ([Reverse proxies](proxies.md)).

## Plain HTTP

evertap serves plain HTTP and leaves HTTPS to a proxy or a tunnel. Over plain HTTP, anyone who can
watch the traffic can read sign-in cookies and tokens and act as you. Use plain HTTP only on a
network you trust, or one Tailscale encrypts. `evertap login` warns when the address is `http://`
and not on loopback.

## What the data directory holds

The data directory, `~/.local/share/evertap` unless `EVERTAP_DATA_DIR` says otherwise, is readable
by the user running evertap alone (mode `0700`). Inside, in plain text:

- `evertap.db`: every database password and bucket key evertap handed out, the root and admin keys
  of every service, the token hashes, and the settings. Before an upgrade changes its format, a copy
  is kept beside it as `evertap.db.v<version>-<time>.bak`, with the same contents.
- `mysql/proxysql.cnf`: ProxySQL's admin password.
- `mysql/sockets/`: ProxySQL's sockets for MySQL logins and for its admin interface (mode `0700`).
- `garage/garage.toml`: Garage's admin token and secret.
- `cloudflared/token`, with a Cloudflare Tunnel evertap created: the token cloudflared runs the tunnel
  with, also kept in the settings in `evertap.db`. Anyone holding it can serve the tunnel's names.

evertap keeps no Cloudflare credential. The access you approve in Cloudflare, or an API token you
give setup, stays in the process that makes the change, the server for Settings or setup's own, for
that one change. evertap never writes it to disk or a log, or sends it to your browser, and gives
approved access back to Cloudflare as soon as the change is done
([Cloudflare Tunnel](cloudflare.md#what-you-approve)).

Treat a backup or a copy of the data directory as you would those passwords. The data itself is in
Docker volumes whose names start with `evertap`, which a backup of the data directory does not
include.

Anyone who can use Docker on that machine can read the same secrets from the containers, and can do
anything else as root. Add to the `docker` group only users you would trust with root.

## What evertap connects to

evertap has no telemetry and no account, and sends nothing about your data or your machine. On its
own, it connects to:

- Docker Hub, through Docker, to download the engines' images the first time it needs them, pinned
  by digest.
- GitHub, soon after it starts and then once a day, to see whether a newer release is out. It sends
  one request for `https://github.com/caru-ini/evertap/releases/latest` and reads which release
  GitHub redirects it to. GitHub sees your IP address and the User-Agent `evertap`, nothing else.
  When a newer release is out, the UI, the Doctor, `evertap doctor`, and the log say so, with how to
  [upgrade](limitations.md#upgrade). The demo and evertap run from source never check. Set
  `EVERTAP_UPDATE_CHECK=0` to turn it off ([Configuration](configuration.md#evertap-serve)).
- Cloudflare, for a tunnel evertap created: the cloudflared that evertap runs for it keeps its links
  to Cloudflare open ([Cloudflare Tunnel](cloudflare.md)). While you create, move, or remove that
  tunnel, Settings' server or setup also calls Cloudflare's API, and its OAuth endpoints to turn the
  code you paste into access and to give the access back.
