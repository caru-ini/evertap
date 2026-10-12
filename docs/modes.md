---
title: Choose how evertap is reached
---

Until you choose, evertap listens on 127.0.0.1 alone, and no other machine can reach it.
`evertap setup` on the machine running evertap, and Settings → Change access in the UI, ask one
question: where will you open evertap from? Each answer shows the address you will open evertap at
before you pick it. None of them changes connection details: apps connect to `ev.internal` on each
engine's standard port whatever you choose, so a project's `.env` stays the same
([Connect from your laptop](connecting.md)).

|                          | This computer only                     | Devices on your network                  | Anywhere, through Cloudflare                                | Behind your own proxy or tunnel                                           |
| ------------------------ | -------------------------------------- | ---------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| For                      | evertap on the computer you develop on | A home server reached over your LAN      | A machine reached from anywhere, with no open ports         | A home server or VPS behind Caddy, nginx, Tailscale Serve, or cloudflared |
| You provide              | Your password for sudo, once           | Nothing                                  | A domain on Cloudflare, and approving evertap there once    | Your proxy or tunnel, and the address it serves                           |
| The UI's address         | `http://ev.internal:8080`              | `http://<this machine's address>:8080`   | The name you give it, such as `https://evertap.example.com` | Your proxy's, such as `https://evertap.example.com`                       |
| Apps reach databases     | Directly                               | Through `evertap connect` on each laptop | Through `evertap connect` on each laptop                    | Through `evertap connect` on each laptop                                  |
| The first sign-in        | Setup opens a signed-in browser        | Setup prints a one-time link and QR code | Setup prints a one-time link and QR code                    | Setup prints a one-time link and QR code                                  |
| `--mode`, `EVERTAP_MODE` | `local`                                | `network`, listening on every interface  | `cloudflare`                                                | `network`, listening on 127.0.0.1 or Docker's bridge                      |

Sign-in is required whatever you choose, wherever a request comes from ([Security](security.md)).

## Which one to pick

- **evertap runs on the computer where you run your apps**, and only you use it: This computer
  only.
- **A home server, and your devices are on the same network**: Devices on your network. It serves
  plain HTTP on your network.
- **You use Tailscale**: Devices on your network, at the machine's Tailscale address, or Behind your
  own proxy or tunnel with Tailscale Serve for HTTPS ([below](#tailscale)).
- **A VPS**: Behind your own proxy or tunnel, with HTTPS from Caddy or nginx
  ([Reverse proxies](proxies.md)), or Anywhere, through Cloudflare. Do not choose Devices on your
  network on a VPS: that opens the sign-in page to the internet over plain HTTP, and setup and the
  log warn about it.
- **A machine that takes no incoming connections**, such as one behind a router you do not control,
  and you want it reachable from anywhere: Anywhere, through Cloudflare
  ([Cloudflare Tunnel](cloudflare.md)).

## This computer only

Apps on this computer connect to `ev.internal` directly. There is no `evertap connect` and nothing
to sign in from elsewhere.

Choosing it in setup points `ev.internal` at evertap's own loopback address, `127.77.0.1`, with one
sudo prompt:

- It adds `127.77.0.1 ev.internal` to `/etc/hosts`.
- On macOS, which has only 127.0.0.1 on loopback, it adds `127.77.0.1` to `lo0`, and a startup job
  (`/Library/LaunchDaemons/evertap.loopback.plist`) that adds it again after a restart.

If sudo fails, setup saves nothing and prints the changes to make by hand. Choosing another answer
in setup, or `evertap uninstall`, removes them again.

evertap then listens on `127.77.0.1`: databases and buckets on their standard ports (5432, 3306,
6379, 3900) and the UI on 8080. That address is apart from 127.0.0.1, so a database you run
yourself on `127.0.0.1:5432` keeps working beside evertap. Something that listens on every address
does not:

- A program or a Compose file with `"5432:5432"` that is running keeps evertap from listening on
  that port.
- While evertap runs, such a Compose file fails to start.

Publish it on 127.0.0.1 instead, as `"127.0.0.1:5432:5432"`. Setup and the Doctor name each Docker
container that clashes with evertap.

Only programs on this computer reach evertap then, and not from inside a container on it:
an app that runs in Docker keeps its database in its own Compose file. Under WSL, Windows apps do not
reach an evertap running inside WSL.

## Devices on your network

evertap listens on every interface (`0.0.0.0`), and browsers open it at this machine's address on
your network, such as `http://192.168.1.20:8080`, which setup and Settings show beside the answer.
To open evertap at another address, such as the machine's name on your network or on Tailscale,
give it under "Use another address" in Settings, or with setup:
`evertap setup --mode network --listen 0.0.0.0 --url http://evertap.local:8080`.

To listen on one address of this machine instead, such as its Tailscale address, pass it as a flag:
`evertap setup --mode network --listen 100.101.102.103`.

### The names evertap answers to

evertap answers only to requests that name the address you gave in setup, `localhost`, an IP
address, or its name on your network (`EVERTAP_HOST`, `evertap.local` unless set). Any other name
gets "evertap does not answer to this address". This stops a web page that points its own name at
your machine from talking to evertap. If you open evertap at a name, give that name as its address
([above](#devices-on-your-network)). evertap does not announce `evertap.local` itself; it only
answers to it when something on your network resolves it.

### Plain HTTP on your network

Without a proxy, evertap serves plain HTTP. Anyone who can watch the traffic on that network can
read the sign-in cookies and the token `evertap login` saves, and act as you. `evertap login` warns
about this. Use it on a network you trust, or over Tailscale, which encrypts the traffic, or behind
a proxy with HTTPS.

If this machine has an address the internet routes to, listening on every interface opens the
sign-in page there too. Setup, Settings, and the log warn about it. Block that port in your firewall,
or choose Behind your own proxy or tunnel, with HTTPS.

### Tailscale

evertap does not set up Tailscale; install it yourself. Then, on the machine running evertap, either:

- Listen on its Tailscale address, and open evertap there:
  `evertap setup --mode network --listen <its 100.x address>`. Tailscale encrypts the traffic, and
  the UI is not open on your other networks. To open evertap at its MagicDNS name, add
  `--url http://<name>:8080`. If evertap starts before Tailscale has its address, it stops with an
  error; the systemd unit starts it again 5 seconds later.
- Or put Tailscale Serve in front for HTTPS, and choose Behind your own proxy or tunnel, on this
  machine, with the address Serve gives, `https://<machine>.<tailnet>.ts.net`
  ([Reverse proxies](proxies.md#tailscale-serve)).

## Anywhere, through Cloudflare

evertap creates a Cloudflare Tunnel, its DNS records, and the rest once you approve it in
Cloudflare, from Settings or setup, and runs cloudflared and opens at the name you give it, such as
`https://evertap.example.com`. It gives the access back right after and keeps no Cloudflare
credential. evertap keeps the UI on 127.0.0.1, so the machine needs no open ports. The CLI goes
through the tunnel too, even on the same network. See [Cloudflare Tunnel](cloudflare.md).

## Behind your own proxy or tunnel

Setup and Settings ask where it runs, which decides where evertap listens for it:

| Where it runs   | evertap listens on                                                                      |
| --------------- | --------------------------------------------------------------------------------------- |
| On this machine | `127.0.0.1`                                                                             |
| In Docker       | Docker's bridge address, usually `172.17.0.1` (`docker0`), offered where Docker has one |

Then give the address it serves evertap at, such as `https://evertap.example.com`. Setup prints a
Caddy and an nginx configuration for your answers and checks that the address reaches this evertap,
and Settings shows the same under Your proxy ([Reverse proxies](proxies.md)). "In Docker" is for
Docker Engine on Linux, where Docker's bridge is an address of the machine itself. For a cloudflared
you run, see [Run the tunnel yourself](cloudflare.md#run-the-tunnel-yourself).

Without a terminal:

```sh
evertap setup --mode network --url https://evertap.example.com                       # on this machine
evertap setup --mode network --listen 172.17.0.1 --url https://evertap.example.com   # in Docker
```

## Changing it later

- Run `evertap setup` again on the machine running evertap. The change applies without a restart. If
  something cannot listen at the new address, evertap keeps the old settings and says why.
- Or, in the UI, open Settings → Access. It shows where evertap is opened from, the address, and
  which values environment variables fix. Change access asks the same question and shows the new
  address before anything changes.
- When a change leaves your browser without its way in, such as switching away from the address
  you opened evertap at, Settings says so before it switches, then opens the new address with your
  browser signed in there, once. When only the machine running evertap opens the new address (This
  computer only), or evertap cannot tell it, Settings says so and switches without that: to change
  it back, run `evertap setup` on the machine running evertap.
- A Cloudflare Tunnel evertap creates has to connect first: if not in time, evertap does not switch
  to it. Cloudflare then takes a few minutes to serve a new name, so instead of opening it, Settings
  says to wait a few minutes and gives a button that signs your browser in there
  ([Cloudflare Tunnel](cloudflare.md)).
- Every CLI keeps the address it was given. When the address changes, each laptop that used the
  old one has to run `evertap login` with the new one, and CI has to change `EVERTAP_URL`. Settings
  says so before the change, and setup once it is done ([Connect from your laptop](connecting.md)).
- `EVERTAP_MODE`, `EVERTAP_PUBLIC_URL`, and `EVERTAP_LISTEN_HOST` win over what setup saved, and
  setup and Settings show them instead of asking ([Configuration](configuration.md)).
