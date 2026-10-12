---
title: Reverse proxies
---

In `network` mode, evertap can sit behind a reverse proxy you run, which serves it over HTTPS at an
address such as `https://evertap.example.com`. evertap itself serves plain HTTP and leaves
certificates to the proxy. One hostname is enough: the UI, the API, and the database and bucket
connections from `evertap connect` all use it. Only buckets reached from anywhere need a second
([below](#buckets-reached-from-anywhere)).

## Set it up

Run `evertap setup` on the machine running evertap, choose "Behind your own proxy or tunnel", and
then where the proxy runs:

- **On this machine**: evertap listens on `127.0.0.1:8080`.
- **In Docker**: evertap listens on Docker's bridge address, usually `172.17.0.1:8080`, where a
  proxy in a container reaches the machine. This keeps the UI off your other networks, which
  listening on every interface would not.

Then give the address the proxy serves evertap at. Without a terminal:

```sh
evertap setup --mode network --url https://evertap.example.com                       # proxy on this machine
evertap setup --mode network --listen 172.17.0.1 --url https://evertap.example.com   # proxy in Docker
```

Setup then prints a Caddy and an nginx configuration for those answers, waits while you put one in
place, and checks the address: it sends a one-time value through the proxy and tells you whether it
reached this evertap, and what to change if not. In the UI, Settings → Access shows the same
configurations and a button to check again.

## What the proxy has to do

The generated configurations already do all of this:

- **Pass WebSocket upgrades on**, with the `Upgrade` and `Connection` headers. `evertap connect`
  carries every database and bucket connection over a WebSocket.
- **Pass the `Host` header on as it came.** evertap answers only to the address you gave in setup.
- **Add the caller's address to `X-Forwarded-For`.** evertap takes the last entry, and only from a
  proxy on loopback or on a Docker bridge. Without it, evertap sees every caller as one, and one of
  them can hold up everyone's sign-in.
- **Send `X-Forwarded-Proto: https`**, so sign-in cookies travel over HTTPS only, and a site on
  another subdomain of your domain cannot set them.
- **Allow request bodies of 17 MiB.** The UI uploads files in parts of up to 16 MiB.
- **Wait up to 5 minutes for an answer.** The first database of a version waits for its download.
- **Keep the path as it came.** Serve evertap at the root of its own hostname, not under a path.

evertap pings every WebSocket every 25 seconds, so a proxy's idle timeout, such as nginx's 60
seconds, does not close them.

## Caddy

Caddy gets a certificate on its own, and passes the Host header and WebSocket upgrades by default.
For `https://evertap.example.com` and evertap on `127.0.0.1:8080`, setup prints:

```caddyfile
https://evertap.example.com {
	reverse_proxy 127.0.0.1:8080 {
		# A reload closes open WebSockets, evertap connect's too, unless given time to end
		stream_close_delay 5m
	}
}
```

## nginx

```nginx
# In nginx's http block, such as in /etc/nginx/conf.d/evertap.conf
map $http_upgrade $evertap_connection {
    default upgrade;
    ""      close;
}

server {
    listen 443 ssl;
    server_name evertap.example.com;

    # Where certbot keeps the certificate; change both paths if it comes from elsewhere
    ssl_certificate     /etc/letsencrypt/live/evertap.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/evertap.example.com/privkey.pem;

    # The UI uploads files in parts of up to 16 MiB
    client_max_body_size 17m;

    location / {
        # No path after the address, so each request's path passes as it came
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $evertap_connection;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Creating the first database of a version waits for its download
        proxy_read_timeout 5m;
    }
}
```

Use `$http_host`, not `$host`, which drops the port, and leave `proxy_pass` without a path after the
address.

## Buckets reached from anywhere

A bucket's signed links work on any device only through an address of buckets' own, such as
`https://s3.example.com` ([Signed links that work anywhere](connecting.md#signed-links-that-work-anywhere)).
Serve it from a second hostname on the proxy, pointed at evertap's bucket entry. That entry listens
on port 9900 (`EVERTAP_PUBLIC_S3_PORT`) beside the UI: on `127.0.0.1` when the UI listens there or on
every interface, and on Docker's bridge address for a proxy run with Docker. It listens only once
buckets have an address.

Give the address in Settings → Change access, or with setup:

```sh
evertap setup --mode network --url https://evertap.example.com --s3-url https://s3.example.com
```

Setup then prints the configuration below for that address, and Settings shows it under Buckets
reached from anywhere. A bucket's page shows it for `s3.example.com` until an address is given.

- **Use a hostname of its own.** The path and the `Host` header are part of each request's
  signature, so serve buckets at the root of their own hostname, and pass both on as they came.
- **Pass bodies of any size on as they arrive.** An object goes up in one request of up to 5 GiB.
- The entry answers only for buckets that are reachable from anywhere, and refuses every request
  without a valid signature. It tells a CDN not to keep its answers, with
  `Cloudflare-CDN-Cache-Control: no-store`.

```caddyfile
https://s3.example.com {
	reverse_proxy 127.0.0.1:9900
}
```

```nginx
# Buckets reached from anywhere, at an address of their own
server {
    listen 443 ssl;
    server_name s3.example.com;

    # Where certbot keeps the certificate; change both paths if it comes from elsewhere
    ssl_certificate     /etc/letsencrypt/live/s3.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/s3.example.com/privkey.pem;

    # An object goes up in one request of up to 5 GiB, passed on as it arrives
    client_max_body_size 0;
    proxy_request_buffering off;

    location / {
        # Signatures cover the path and the Host, so both pass as they came
        proxy_pass http://127.0.0.1:9900;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        # A large copy can take a while before its answer
        proxy_read_timeout 5m;
    }
}
```

Setup's check covers evertap's own address, not this one.

## A proxy run with Docker

Choose "In Docker" for where the proxy runs, and point the proxy at the address setup shows, such as
`172.17.0.1:8080`. Setup offers it when Docker has its default bridge (`docker0`), as Docker Engine
on Linux does. A proxy on one of your Compose networks reaches that address too.

If the check says your proxy cannot reach evertap even though it points at that address, a firewall
on the machine may be dropping connections from Docker's networks. See
[Limitations](limitations.md#not-tested-yet).

## Traefik

evertap prints no Traefik configuration, and has not been tested behind it. Traefik passes the Host
header, `X-Forwarded-For`, `X-Forwarded-Proto`, and WebSocket upgrades by default. Its entry points
stop reading a request after 60 seconds by default, body included, so a file part sent over a slow
connection can be cut off; raise `respondingTimeouts.readTimeout` on the entry point if uploads
fail. Run `evertap setup` to check the address once Traefik serves it.

## Tailscale Serve

Tailscale Serve gives the machine an HTTPS address in your tailnet,
`https://<machine>.<tailnet>.ts.net`. Have it serve evertap's local address, in the background and
across restarts:

```sh
tailscale serve --bg 8080
```

Then run `evertap setup`, choose "Behind your own proxy or tunnel" and "On this machine", and give
that address.
Serve keeps the Host header, passes WebSocket upgrades on, and sets `X-Forwarded-For` and
`X-Forwarded-Proto`, but evertap has not been tested behind it: setup's check tells you whether all
of that arrives. Serve has one hostname per machine, which is all evertap needs, unless buckets are
to be reached from anywhere.
`tailscale serve --https=443 off` stops it.

## Certificates evertap does not trust

The CLI checks the proxy's certificate. If it comes from your own authority, such as Caddy's
`tls internal`, the CLI says this machine does not trust it: set `NODE_EXTRA_CA_CERTS` to that
authority's certificate in every shell that runs `evertap`.
