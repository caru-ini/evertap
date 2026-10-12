---
title: Cloudflare Tunnel
---

When you open evertap "Anywhere, through Cloudflare", a Cloudflare Tunnel carries browsers and the
CLI to evertap. The machine running evertap connects out to Cloudflare and takes no incoming
connections, so its firewall can drop them all. You need a domain whose DNS is on Cloudflare.

evertap creates the tunnel for you, from Settings or `evertap setup`, once you approve it in
Cloudflare ([below](#let-evertap-create-the-tunnel)). A tunnel you run yourself is "Behind your own
proxy or tunnel" instead ([Run the tunnel yourself](#run-the-tunnel-yourself)).

## Let evertap create the tunnel

You give two names, approve evertap on Cloudflare's own page, and paste back the code that
evertap.dev then shows. The names are evertap's, such as `evertap.example.com`, and the one for
buckets reached from anywhere, `s3.example.com` unless you give another. evertap creates, in
Cloudflare:

- a tunnel named `evertap`, which sends evertap's name to the UI and buckets' name to evertap's
  public S3 entry, `http://127.0.0.1:9900` (`EVERTAP_PUBLIC_S3_PORT`)
- a DNS record for each name, proxied, with the comment `evertap`
- a Cache Rule that keeps Cloudflare from caching buckets' name

Then evertap starts cloudflared in Docker (`evertap-cloudflared`) and waits up to a minute for it to
connect, after cloudflared's first download. Only then does it switch to the tunnel. If cloudflared
does not connect in time, evertap stops it, stays as it was, gives the access back, and says so:
let the machine connect out to Cloudflare on TCP 7844 in its firewall, then try again. What it made
in Cloudflare stays, and the next try uses it again.

Cloudflare takes a few minutes to serve a new name everywhere, and until it does, opening it gives
an error, such as a failed SSL handshake. evertap switches without waiting for that. Settings then
says to wait a few minutes before you open the new name, and setup lets you check it again until
Cloudflare serves it. Settings shows each step while it goes.

A name you removed a short while ago can take up to half an hour to open again from your own
computer, even once evertap has switched to it: DNS caches on the way remember that it was gone.

Both names sit one level under the same domain on Cloudflare, as Cloudflare's free certificate
covers no deeper: `db.example.com` works, `db.dev.example.com` does not. Buckets' name serves
buckets reached from anywhere ([below](#buckets-reached-from-anywhere)), and refuses every request
until a bucket is.

### From Settings

1. In Settings, choose Change access, then Anywhere, through Cloudflare, and Continue.
2. Enter the name for evertap, such as `evertap.example.com`, and the name for buckets if not `s3.`
   in the same domain, and choose Continue.
3. Choose Open Cloudflare. On Cloudflare's page, choose the account that has the domain, and allow
   evertap.
4. Cloudflare sends you to evertap.dev, which shows a code. Copy it, paste it into Settings, and
   choose Create the tunnel.

If your browser came in at an address that stops working once the tunnel is in force, such as this
machine's address on your network, Settings then gives a button that opens evertap at its new name
and signs this browser in there, once, within 10 minutes. Wait a few minutes for Cloudflare first.

### With setup

On the machine running evertap, run `evertap setup`, choose "Anywhere, through Cloudflare", then
"Approve evertap in Cloudflare". Setup asks for the two names, opens Cloudflare's page in this
machine's browser, and prints its link to open on another computer, as over SSH. Paste the code
evertap.dev shows. Setup then creates the tunnel, checks that evertap's name reaches this evertap,
and ends with a one-time sign-in link.

### What you approve

Cloudflare's page names evertap and the access it asks for: Cloudflare Tunnel, Zone, and DNS edit
and read, and Cache Rules (`argotunnel.write`, `zone.read`, `dns.read`, `dns.write`,
`cache-settings.read`, `cache-settings.write`). It reaches the account you choose there, and no more
than your own role in it allows.

- evertap uses the access for that one change, in the process that makes it: the server for
  Settings, setup's own for setup. It never sends it to your browser, stores it, or logs it, and
  gives it back to Cloudflare as soon as the change is done. It asks for no refresh token, so
  nothing outlasts the change.
- If Cloudflare does not confirm it took the access back, evertap says so. Remove evertap under
  Profile → Access Management →
  [Connected applications](https://dash.cloudflare.com/profile/access-management/authorization).
- The tunnel keeps running afterwards: cloudflared runs it with the tunnel's own token, which
  giving the access back, or removing evertap from Connected applications, does not end.
- The code works only with the evertap that asked, which alone holds the PKCE verifier it is
  checked against, only once, and only for a few minutes. evertap.dev's page sends it nowhere and
  keeps nothing. Settings waits 10 minutes for the code; then approve evertap again.

What evertap keeps, in its data directory, is the tunnel's id, the token cloudflared runs it with,
the domain and the two names, and the ids of the DNS records and the Cache Rule. It keeps no
Cloudflare credential.

evertap stops before it creates anything when either name already has a DNS record of yours, even one that leads to a tunnel of your own, or when a tunnel named `evertap`
already runs in the account, likely for another evertap. It reuses only what it created before: a
stopped tunnel named `evertap`, and DNS records with the comment `evertap`, which it points at the
tunnel again. Routes you add to its tunnel in Cloudflare stay when evertap changes its own.

### With an API token instead

Approving on Cloudflare's page takes a browser, and Settings or a terminal to paste the code into.
Use a Cloudflare API token instead when:

- the machine has no terminal for setup to ask in, or
- Cloudflare stops this machine's request for the access, as it can from a data center's address,
  such as a VPS. evertap then says so and links to a new token.

In setup, choose "Anywhere, through Cloudflare", then "With an API token". Setup prints a link, and
a QR code, to Cloudflare's page for a new API token with these permissions filled in:

- Account · Cloudflare Tunnel · Edit
- Zone · DNS · Edit
- Zone · Zone · Read
- Zone · Cache Rules · Edit

If one is missing on the page, add it by hand. The page fills in All zones under Zone Resources:
change that to the domain for evertap, so the token reaches nothing else. Create the token and paste
it; what you paste does not show. Setup then asks for the two names. evertap does not keep the
token, and you can delete it in Cloudflare once setup is done.

Without a terminal, give the token in `CLOUDFLARE_API_TOKEN`:

```sh
CLOUDFLARE_API_TOKEN=<token> evertap setup --mode cloudflare --zone example.com
```

Without a terminal, the names are `evertap.` and `s3.` in the domain, or the ones the tunnel has
when setup runs again in its domain. `--zone` is needed only when the token reaches more than one
domain.

### What it needs

- Docker on Linux. cloudflared runs with the host's network to reach evertap on `127.0.0.1`. When
  evertap runs in Docker ([Run evertap in Docker](docker.md)), run setup inside its container with
  `docker exec -it evertap evertap setup`, and leave `EVERTAP_PUBLIC_URL` unset: the tunnel has
  its own address, and evertap does not start with both.
- Outgoing connections to Cloudflare on TCP 7844. evertap runs cloudflared over HTTP/2, not QUIC,
  which loses the body of an upload that does not say its length.

### Change the names

In Settings, choose Change access, then Anywhere, through Cloudflare again, and enter new names. In
setup, choose "Set it up again". Either way you approve evertap in Cloudflare again. evertap keeps
the same tunnel, routes the new names through it, points its Cache Rule at buckets' new name, and
removes the DNS records and routes it made for the old names once it has switched, so the old names
lead here until then. The same steps with the same names repair what it made.

A browser that came in at an old name signs in at the new one with the button Settings gives, as
[above](#from-settings): wait a few minutes for Cloudflare first.

Every CLI keeps the address it was given, as other tools' clients do, so one that uses an old name
no longer reaches evertap. On each laptop, run `evertap login` with the new address, such as
`evertap login https://db.example.com`. With an API key, as in CI, change `EVERTAP_URL`. Settings
says so before the change, and setup once it is done.

A new name for buckets changes their address everywhere: change `S3_PUBLIC_ENDPOINT` in each `.env`
you copied for a bucket reached from anywhere. Settings and setup say so before the change.

With a token, setup reuses the tunnel, the DNS records, and the Cache Rule, and makes none of them
twice. Without a token or an answer, setup keeps the tunnel as it is.

### The tunnel's state

`evertap doctor` and the Doctor page show a Tunnel line: connected, with how many links cloudflared
has to Cloudflare, not connected yet, or not running. On the machine running evertap, `evertap
doctor` also says why cloudflared could not start. Settings → Access shows the same state.

evertap reads the tunnel's state from its own cloudflared, on a free port of `127.0.0.1` that it
picks. A cloudflared of yours on the same machine, such as one from `cloudflared service install`,
can keep running beside it with its own tunnel, and neither the Doctor nor Settings shows that one.

### Remove the tunnel

In Settings, choose Change access and another answer. Under "The tunnel evertap runs", choose:

- Remove it from Cloudflare, then approve evertap in Cloudflare as above. evertap stops cloudflared
  and removes the DNS records, the Cache Rule, and the tunnel.
- Leave it in Cloudflare. evertap stops cloudflared and forgets the tunnel without asking Cloudflare
  for anything, then lists what stays there, each with a link to remove it in the dashboard.

When your browser came in through the tunnel, Settings says it can no longer open evertap there,
then switches and opens the new address with your browser signed in there. It removes the tunnel
from Cloudflare once that answer has gone out through it; if it cannot, the log of the machine
running evertap lists what to remove. When only that machine opens the new address, change it back
with setup there.

In setup, choose another answer. Once it is in force, setup asks whether to remove the tunnel from
Cloudflare, by approving evertap there or with an API token (from the link above, or
`CLOUDFLARE_API_TOKEN`), or to leave it, and then lists what to remove in the Cloudflare dashboard.

`evertap uninstall` removes cloudflared but leaves what evertap created in Cloudflare. It lists
those before it asks you to confirm: to remove them, stop there and choose another answer first.

## Run the tunnel yourself

1. In the Cloudflare dashboard, open Networking → Tunnels, choose Create a tunnel, and name it, such
   as `my-evertap`. Do not name it `evertap`: evertap uses that name for the tunnel it creates, and
   would take over a stopped tunnel of yours with that name, replacing its routes.
2. Run cloudflared on the machine running evertap with the command the dashboard shows, such as
   `sudo cloudflared service install <token>`, or with Docker ([below](#cloudflared-in-docker)).
3. In the tunnel's Routes, add a route for a published application: a name such as
   `evertap.example.com`, with the service URL `http://127.0.0.1:8080`.
   - Write `127.0.0.1`, not `localhost`, which can lead to `::1`, where evertap does not listen.
   - Keep the name one level under your domain, such as `evertap.example.com`. Cloudflare's free
     certificate covers one level, not `evertap.dev.example.com`.
   - If you changed `EVERTAP_PORT`, use that port.
4. On the machine running evertap, run `evertap setup`, choose "Behind your own proxy or tunnel"
   and "On this machine", and give the address, `https://evertap.example.com`. Without a terminal:

   ```sh
   evertap setup --mode network --url https://evertap.example.com
   ```

Setup ends with a one-time sign-in link to that address. If the link does not open evertap, check
the tunnel's route.

To have evertap create a tunnel instead later, first delete your tunnel's DNS record for the name
you give evertap: evertap leaves records of yours alone and stops. Your cloudflared can keep
running for anything else your tunnel serves.

### cloudflared in Docker

cloudflared in a container reaches evertap on `127.0.0.1` only with the host's network:

```sh
docker run -d --name cloudflared --restart unless-stopped --network host \
  cloudflare/cloudflared:latest tunnel --no-autoupdate --metrics 127.0.0.1:20241 \
  run --token <token>
```

Keep `--metrics 127.0.0.1:20241`, before `run`. In a container, cloudflared otherwise serves its
metrics on `0.0.0.0`, which with the host's network means every address of the machine, and the
same server shows the tunnel's configuration.

## Buckets reached from anywhere

A bucket's signed links work on any device once it is reachable from anywhere
([Signed links that work anywhere](connecting.md#signed-links-that-work-anywhere)). With the tunnel
evertap creates, buckets are served at the name you gave them: turn it on for a bucket, and that is
all.

With a tunnel you run yourself, give buckets a hostname of their own on it:

1. In the tunnel's Routes, add another published application, such as `s3.example.com`, with the
   service URL `http://127.0.0.1:9900`. If you set `EVERTAP_PUBLIC_S3_PORT`, use that port.
2. Under Caching → Cache Rules, add a rule that bypasses the cache for that hostname, as evertap
   does for its own tunnel.
3. Give evertap its address, in Settings → Change access, or with setup:

   ```sh
   evertap setup --mode network --url https://evertap.example.com --s3-url https://s3.example.com
   ```

Unlike database and bucket connections from `evertap connect`, these requests travel through
Cloudflare as plain HTTP requests, so more of its rules apply to them:

- Every answer carries `Cloudflare-CDN-Cache-Control: no-store`, so Cloudflare keeps no copy, even
  of an object stored with `Cache-Control: public`. The header does not reach browsers.
- An upload through this address is limited to 100 MB on the Free and Pro plans. Larger objects go
  up in parts, or through `evertap connect`.
- Cloudflare changes `Accept-Encoding` on its way to evertap. A tool that signs that header, such as
  rclone or Terraform, fails here; links signed for a browser do not sign it.

## Laptops

Laptops pair and connect as they do with any other answer ([Connect from your laptop](connecting.md)):

```sh
evertap login https://evertap.example.com
evertap connect
```

Database and bucket connections travel through the tunnel inside WebSockets, even from a laptop on
the same network as evertap.

## Cloudflare Access

Access is optional. evertap requires its own sign-in either way. If you put Access in front, cover
the UI only: the CLI sends evertap's token and cannot do Access's browser sign-in. In Cloudflare Zero
Trust, under Access controls → Applications, add two self-hosted applications:

1. `evertap.example.com`, with an Allow policy for the people who use evertap.
2. `evertap.example.com/api/client/*`, with a Bypass policy that includes Everyone.

The more specific path wins, so Access lets through everything the CLI uses, which is all under
`/api/client/`, `evertap connect` included.

## Limits

- Cloudflare closes a WebSocket that stays quiet for a while, about 100 seconds by most reports.
  evertap and `evertap connect` ping every 25 seconds, so open connections stay up.
- Connections still drop when Cloudflare or cloudflared restarts. Use a connection pool that checks
  connections ([Connection pools](connecting.md#connection-pools)).
- Cloudflare waits 125 seconds for an answer. Creating the first database of a version waits up to a
  minute for the download, then asks you to try again while it goes on.
- Cloudflare limits a request body to 100 MB on the Free and Pro plans. The UI uploads files in
  parts of up to 16 MiB, so files of any size fit.
- Cloudflare's
  [terms](https://www.cloudflare.com/service-specific-terms-application-services/#content-delivery-network-free-pro-or-business)
  let it limit a Free, Pro, or Business plan that serves video or a disproportionate share of
  pictures, audio, or other large files without its paid services, through a tunnel too. Database
  and bucket traffic passes through Cloudflare inside WebSockets. If you move large amounts of data,
  open evertap behind your own proxy instead.
- Bot Fight Mode has not been tested with evertap. It challenges traffic that looks automated, and
  on the Free plan no rule can skip it for one path. If `evertap login` or `evertap connect` fails
  only through the tunnel, try turning it off.
