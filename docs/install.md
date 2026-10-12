---
title: Install
---

evertap runs on one machine: a home server, a VPS, or the computer you develop on. That machine
runs the databases and buckets in Docker. The same `evertap` command is also the CLI you use on
your laptop and in CI, which needs no Docker ([Connect from your laptop](connecting.md)).

## Requirements

On the machine that runs evertap:

- **Linux** on x64 or arm64, with **Docker Engine 24 or later**. Use 28.0 or later (28.3.3 or later
  with firewalld): older versions let other machines on your network reach what Docker publishes on
  127.0.0.1, which includes every database and bucket, without going through evertap. The Doctor
  warns about it.
- Or **macOS** on Apple silicon or Intel, with Docker Desktop, OrbStack, or Colima, to use evertap
  on that Mac itself (`local` mode, see [Choose how evertap is reached](modes.md)).
- Your user can use Docker without sudo. Add it to the `docker` group with
  `sudo usermod -aG docker $USER`, then log out and back in. Being in that group is as good as being
  root on that machine, so add only users you would trust with root.
- Disk space for the images evertap downloads: about 400 MB for each PostgreSQL version and 800 to
  900 MB for each MySQL version you use. Each MySQL database also takes about 210 MB before any
  data, as each runs a server of its own, and each MySQL version keeps one more such copy that new
  databases start from.

On your laptop and in CI: Linux or macOS on x64 or arm64. On Windows, use the CLI inside WSL.

### How Docker was installed

evertap finds Docker's socket in this order: `EVERTAP_DOCKER_SOCKET`, a `unix://` `DOCKER_HOST`,
then the usual places of Docker Engine, Docker Desktop, OrbStack, Colima, and rootless Docker. Some
installs need more:

- **Docker from Snap** cannot read files in hidden folders of your home, which includes evertap's
  data directory `~/.local/share/evertap`, so databases fail to start. Install Docker from
  docker.com's packages instead, or set `EVERTAP_DATA_DIR` to a folder that is not hidden, such as
  `~/evertap`, wherever you run `evertap` (see [Configuration](configuration.md)).
- **Rootless Docker** stops when you log out, and the databases with it. Run
  `sudo loginctl enable-linger $USER` and `systemctl --user enable docker` so it keeps running. The
  systemd service has no `XDG_RUNTIME_DIR`, so set
  `EVERTAP_DOCKER_SOCKET=/run/user/<your uid>/docker.sock` in its
  [environment file](#settings-for-the-service) before you run the install script.

The Doctor warns about both.

### Ports

| Where                       | What listens                          | Address                                                                   |
| --------------------------- | ------------------------------------- | ------------------------------------------------------------------------- |
| The machine running evertap | The UI and API                        | Port 8080 (`EVERTAP_PORT`) on the address you choose in setup             |
|                             | Databases and buckets, `network` mode | 127.0.0.1, ports 6432, 3306, 6379, 3900 (`EVERTAP_*_PORT`)                |
|                             | Databases and buckets, `cloudflare`   | The same as `network`                                                     |
|                             | Databases, buckets, and UI, `local`   | 127.77.0.1, ports 5432, 3306, 6379, 3900, and 8080                        |
|                             | Buckets reached from anywhere         | Port 9900 (`EVERTAP_PUBLIC_S3_PORT`) beside the UI, once given an address |
|                             | Each database and bucket service      | 127.0.0.1, on a port Docker picks                                         |
|                             | The CLI on the same machine           | `evertap.sock` in the data directory, readable by your user alone         |
| Your laptop                 | `evertap connect`                     | 127.77.0.1, ports 5432, 3306, 6379, 3900                                  |

Until you run `evertap setup`, the UI listens on 127.0.0.1 too, so nothing is reachable from other
machines. Databases and buckets never listen anywhere but loopback: other machines reach them
through the UI's address with `evertap connect`. The one exception is the entry for buckets reached
from anywhere, which listens beside the UI ([Security](security.md#what-listens-where)).

## Install the binary

To run evertap itself in a container instead, see [Run evertap in Docker](docker.md).

```sh
curl -fsSL https://evertap.dev/install.sh | sh
```

`evertap.dev/install.sh` leads to the script in the latest GitHub release. Before it installs
anything, it asks where it runs:

```
Where is this?
  1) The machine that runs evertap (it needs Docker)
  2) A laptop or CI that connects to evertap on another machine
```

It never guesses from the machine: a laptop can run evertap for itself, and a CI runner can have
Docker without running evertap. Then it downloads the build for your system from that release,
checks it against the release's `SHA256SUMS`, and installs it as `/usr/local/bin/evertap`, asking
for sudo if it needs it.

- On the machine that runs evertap, on Linux with systemd, it also installs and starts evertap's
  service and runs `evertap setup` ([With systemd](#with-systemd)).
- On the machine that runs evertap without systemd, such as macOS or WSL, it says how to start
  evertap ([Without systemd](#without-systemd)).
- On a laptop or in CI, it installs the binary alone and says how to
  [pair it](connecting.md#pair-the-laptop) or [use an API key](connecting.md#ci-with-an-api-key).

Give it settings on the `sh` side of the pipe:

- `EVERTAP_ROLE=host` (the machine that runs evertap) or `EVERTAP_ROLE=client` (a laptop or CI)
  answers the question. Without a terminal, as in CI, the script needs it, and stops before
  installing anything if it is not set.
- `EVERTAP_VERSION=0.1.0` installs that release instead of the latest.
- `EVERTAP_VERSION=develop` installs the newest build of the `develop` branch: what the next
  release will have, before it is released.
- `EVERTAP_INSTALL_DIR=$HOME/.local/bin` installs somewhere else.

```sh
curl -fsSL https://evertap.dev/install.sh | EVERTAP_ROLE=client EVERTAP_VERSION=0.1.0 sh
```

Run the script again to upgrade evertap, or to repair it: it asks again, and installs even the
version you have ([Upgrade](limitations.md#upgrade)).

### By hand

From the [releases page](https://github.com/caru-ini/evertap/releases), download
`evertap-<os>-<arch>.tar.gz` for your system and `SHA256SUMS`, then:

```sh
grep evertap-linux-x64.tar.gz SHA256SUMS | sha256sum -c   # on macOS: shasum -a 256 -c
tar -xzf evertap-linux-x64.tar.gz
sudo install -m 755 evertap-linux-x64/evertap /usr/local/bin/evertap
```

The archive also holds the license and the third-party notices, and on Linux the systemd unit
`evertap@.service`. To run evertap at boot without the install script, install the unit from the
same archive, and enable it for yourself (see [With systemd](#with-systemd) for why yourself):

```sh
sudo cp evertap-linux-x64/evertap@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now evertap@$USER
```

The unit runs `/usr/local/bin/evertap`; if you installed it elsewhere, change `ExecStart`. After
each upgrade by hand, restart it with `sudo systemctl restart evertap@$USER`.

With the GitHub CLI, you can check that GitHub's release workflow built the archive:

```sh
gh attestation verify evertap-linux-x64.tar.gz --repo caru-ini/evertap
```

On macOS, a file downloaded with a browser is quarantined, and macOS refuses to run it. Remove the
quarantine with `xattr -d com.apple.quarantine evertap`.

## Keep evertap running

Every connection to a database or bucket goes through the `evertap serve` process. While it is
stopped, the databases keep running in Docker but nothing reaches them.

### With systemd

On the machine that runs evertap, on Linux with systemd, the install script runs evertap as a
service. It installs the unit `evertap@.service` from the release in `/etc/systemd/system/` and
enables `evertap@<you>`, which runs `evertap serve` at boot as the user who ran the script. Run the
script as yourself, not with `sudo`: evertap keeps its data in that user's `~/.local/share/evertap`,
where `evertap setup` and the other commands you run find it.

1. Before installing anything, the script checks that your user can use Docker
   ([Requirements](#requirements)), and stops with what to do if not.
2. It installs the binary and the unit, and starts evertap or restarts it.
3. It waits up to 30 seconds for evertap to answer on this machine.
4. On a first install, it runs [`evertap setup`](#set-up-and-sign-in). Without a terminal, it says
   to run `evertap setup` with flags instead.

When you run it again, it keeps the binary it replaces as `evertap.prev` beside the new one. If the
new evertap does not answer, it puts that one back and starts it again
([Upgrade](limitations.md#upgrade)).

- Read evertap's log with `journalctl -u evertap@$USER -f`. On start, it says where it listens and
  what to do next.
- The script replaces the unit each time it runs. Make changes of your own in a drop-in, which it
  leaves alone: `sudo systemctl edit evertap@`.

#### Settings for the service

Most installs need no environment variables, since `evertap setup` saves its answers. To set one for
the service, put it in `/etc/evertap/evertap.env`, which the unit reads if it exists. Start from the
example
[`contrib/systemd/evertap.env`](https://github.com/caru-ini/evertap/blob/main/contrib/systemd/evertap.env),
remove the `#` before what you need, and restart the service:

```sh
sudo mkdir -p /etc/evertap
curl -fsSL https://raw.githubusercontent.com/caru-ini/evertap/main/contrib/systemd/evertap.env |
  sudo tee /etc/evertap/evertap.env > /dev/null
sudoedit /etc/evertap/evertap.env
sudo systemctl restart evertap@$USER
```

Set only what you need: a variable fixes its setting, and setup can no longer change it
([Configuration](configuration.md)). If you set `EVERTAP_DATA_DIR` there, set it in your shell too,
or `evertap setup`, the install script, and the other commands on that machine cannot find the
running evertap.

### Without systemd

On macOS, and on Linux without systemd such as WSL by default, the install script installs the
binary alone. Run `evertap serve` in a terminal, or in `tmux` so it outlives your session, and
restart it after an upgrade. There is no launchd job for macOS.

## Set up and sign in

On the machine running evertap, as the user that runs it, while it runs:

```sh
evertap setup
```

With systemd, the install script runs it for you on a first install.

Setup asks where you will open evertap from (see [Choose how evertap is reached](modes.md)), asks
only what that choice needs, and applies it without a restart. Then it signs in your first
browser:

- For This computer only, it opens a signed-in browser on this machine.
- For the others, it prints a one-time sign-in link and a QR code. Open the link in a browser, or
  scan the code with your phone. It signs in one browser and expires in 10 minutes.

Without a terminal, give the answers as flags, and setup asks nothing:

```sh
evertap setup --mode local                                                         # This computer only
evertap setup --mode network --listen 0.0.0.0                                      # Devices on your network
CLOUDFLARE_API_TOKEN=<token> evertap setup --mode cloudflare --zone example.com    # Anywhere, through Cloudflare
evertap setup --mode network --url https://evertap.example.com                     # Behind your own proxy or tunnel
```

Run `evertap setup` again to change your answers; it offers to keep the address you gave before.
Once you are signed in, Settings in the UI can make the same changes, as long as they keep your
browser connected.

### Signing in later

- A new browser shows a code. On a device that is signed in, open `/device` (Clients → Add a
  device) and enter it.
- `evertap signin-link`, on the machine running evertap, prints another one-time link and QR code.
  Use it when no browser is signed in anymore.
- `evertap open`, on the machine running evertap, opens a signed-in browser there.

## Check it

```sh
evertap doctor
```

The Doctor, also a page in the UI, shows the Docker version and any warnings about it, the state of
each service, whether each database and bucket entry answers, and which of your own Docker
containers want the same ports.

Next, [choose how evertap is reached](modes.md) if you have not, then
[connect from your laptop](connecting.md). Upgrading and uninstalling are in
[Limitations](limitations.md#upgrade).
