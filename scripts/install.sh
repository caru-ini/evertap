#!/bin/sh
# Installs evertap from its GitHub release:
#   curl -fsSL https://evertap.dev/install.sh | sh
# It first asks whether this is the machine that runs evertap or one that connects to it;
# EVERTAP_ROLE=host or EVERTAP_ROLE=client answers without a terminal. Where evertap runs under
# systemd, it also installs and starts the service, so running it again upgrades or repairs evertap
# and puts the previous binary back if the new one does not start.
# EVERTAP_VERSION=0.1.0 installs that release instead of the latest, EVERTAP_VERSION=develop the
# newest build of the develop branch, and EVERTAP_INSTALL_DIR puts the binary somewhere other than
# /usr/local/bin.
set -eu

repo="caru-ini/evertap"
version="${EVERTAP_VERSION:-}"
dir="${EVERTAP_INSTALL_DIR:-/usr/local/bin}"
role="${EVERTAP_ROLE:-}"
unit="/etc/systemd/system/evertap@.service"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fail "Install curl, then run this again"

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) fail "Run this on Linux or macOS" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) fail "There is no evertap build for $(uname -m). Build it from source: https://github.com/$repo/blob/main/CONTRIBUTING.md#build-the-binary" ;;
esac
# A shell running under Rosetta reports x86_64 on Apple silicon.
if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" = 1 ]; then
  arch=arm64
fi

# curl | sh hands the script itself to sh as its input, so answers come from the terminal.
tty=""
if [ -t 1 ] && (: </dev/tty) 2>/dev/null; then
  tty=1
fi

# Never guessed from the machine: a laptop can run evertap, and a CI runner can have Docker.
if [ -z "$role" ]; then
  [ -n "$tty" ] || fail "Say where this is with EVERTAP_ROLE, then run this again:
  On the machine that runs evertap:  curl -fsSL https://evertap.dev/install.sh | EVERTAP_ROLE=host sh
  On a laptop or in CI:              curl -fsSL https://evertap.dev/install.sh | EVERTAP_ROLE=client sh"
  printf 'Where is this?\n'
  printf '  1) The machine that runs evertap (it needs Docker)\n'
  printf '  2) A laptop or CI that connects to evertap on another machine\n'
  while [ -z "$role" ]; do
    printf 'Choose 1 or 2: '
    read -r answer </dev/tty || fail "
Nothing was installed. Run this again and choose 1 or 2"
    case "$answer" in
      1) role=host ;;
      2) role=client ;;
    esac
  done
fi
case "$role" in
  host | client) ;;
  *) fail "Set EVERTAP_ROLE to host on the machine that runs evertap, or to client on a laptop or in CI" ;;
esac

# Where evertap runs under systemd, the script installs and restarts its service. Without systemd,
# as on macOS or in WSL by default, it says how to run evertap instead.
service=""
if [ "$role" = host ] && [ "$os" = linux ] && [ -d /run/systemd/system ]; then
  service=1
fi
user="$(id -un)"

# Checked before anything is installed, as evertap cannot start without Docker. The service reaches
# it where its environment file says, or at Docker Engine's socket; evertap serve run by hand finds
# it from this shell's environment, in the same order as evertap does.
socket=""
if [ -n "$service" ]; then
  grep -qs '^[[:space:]]*EVERTAP_DOCKER_SOCKET=.' /etc/evertap/evertap.env || socket=/var/run/docker.sock
elif [ "$role" = host ]; then
  socket="${EVERTAP_DOCKER_SOCKET:-}"
  case "${DOCKER_HOST:-}" in
    unix:///*) [ -n "$socket" ] || socket="${DOCKER_HOST#unix://}" ;;
  esac
  if [ -z "$socket" ]; then
    socket=/var/run/docker.sock
    for found in /var/run/docker.sock "$HOME/.docker/run/docker.sock" "$HOME/.docker/desktop/docker.sock" \
      "$HOME/.orbstack/run/docker.sock" "$HOME/.colima/default/docker.sock" ${XDG_RUNTIME_DIR:+"$XDG_RUNTIME_DIR/docker.sock"}; do
      if [ -e "$found" ]; then
        socket="$found"
        break
      fi
    done
  fi
fi
if [ -n "$socket" ] && ! curl -fsS --max-time 5 --unix-socket "$socket" -o /dev/null http://localhost/_ping 2>/dev/null; then
  if [ "$os" = darwin ]; then
    fail "Start Docker Desktop, OrbStack, or Colima, then run this again. If its socket is somewhere else, set EVERTAP_DOCKER_SOCKET to it"
  elif [ ! -S "$socket" ] && [ -n "$service" ]; then
    fail "Install Docker Engine and start it (https://docs.docker.com/engine/install/), then run this again. With rootless Docker, set EVERTAP_DOCKER_SOCKET in /etc/evertap/evertap.env first: https://evertap.dev/docs/install/linux#how-docker-was-installed"
  elif [ ! -S "$socket" ]; then
    fail "Start Docker, or install Docker Engine (https://docs.docker.com/engine/install/), then run this again"
  elif [ ! -w "$socket" ]; then
    fail "Let $user use Docker with sudo usermod -aG docker $user, log out and back in, then run this again"
  elif [ -n "$service" ]; then
    fail "Start Docker with sudo systemctl start docker, then run this again"
  else
    fail "Start Docker, then run this again"
  fi
fi
# The script finds the service's socket in the data directory, as the CLI does.
if [ -n "$service" ] && [ -z "${EVERTAP_DATA_DIR:-}" ] && grep -qs '^[[:space:]]*EVERTAP_DATA_DIR=.' /etc/evertap/evertap.env; then
  fail "Set EVERTAP_DATA_DIR in your shell as in /etc/evertap/evertap.env, then run this again"
fi

case "$version" in
  "") url="https://github.com/$repo/releases/latest/download" ;;
  # The prerelease's tag is not named develop, which would clash with the branch in git.
  develop) url="https://github.com/$repo/releases/download/develop-build" ;;
  *) url="https://github.com/$repo/releases/download/v${version#v}" ;;
esac
name="evertap-$os-$arch"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

printf 'Downloading %s\n' "$name"
curl -fsSL --proto '=https' --tlsv1.2 -o "$tmp/$name.tar.gz" "$url/$name.tar.gz" ||
  fail "Could not download $url/$name.tar.gz. Check the version and your connection, then run this again"
curl -fsSL --proto '=https' --tlsv1.2 -o "$tmp/SHA256SUMS" "$url/SHA256SUMS" ||
  fail "Could not download $url/SHA256SUMS. Run this again"

expected="$(awk -v file="$name.tar.gz" '$2 == file { print $1 }' "$tmp/SHA256SUMS")"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$name.tar.gz" | awk '{ print $1 }')"
else
  actual="$(shasum -a 256 "$tmp/$name.tar.gz" | awk '{ print $1 }')"
fi
[ -n "$expected" ] && [ "$actual" = "$expected" ] ||
  fail "The download does not match the release's checksum. Run this again"

tar -xzf "$tmp/$name.tar.gz" -C "$tmp"
# The unit comes from the same archive as the binary, so the two never differ in version.
if [ -n "$service" ] && [ ! -f "$tmp/$name/evertap@.service" ]; then
  fail "This release has no systemd unit. Install a newer one with EVERTAP_VERSION, or leave it unset for the latest"
fi

installed=""
[ -e "$dir/evertap" ] && installed=1

sudo=""
if ! { mkdir -p "$dir" 2>/dev/null && [ -w "$dir" ]; }; then
  command -v sudo >/dev/null 2>&1 ||
    fail "Cannot write to $dir. Run this as a user who can, or set EVERTAP_INSTALL_DIR to a directory you own"
  printf 'Installing to %s needs sudo\n' "$dir"
  sudo="sudo"
  $sudo mkdir -p "$dir"
fi
if [ -n "$service" ] && [ -z "$sudo" ] && [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || fail "Run this as root, or as a user who can use sudo"
  printf 'Installing the evertap service needs sudo\n'
  sudo="sudo"
fi

if [ -n "$service" ] && [ -n "$installed" ]; then
  $sudo cp -p "$dir/evertap" "$dir/evertap.prev"
fi
$sudo install -m 755 "$tmp/$name/evertap" "$dir/evertap"
new="$("$dir/evertap" --version 2>/dev/null || echo unknown)"
printf 'Installed evertap %s to %s\n' "$new" "$dir/evertap"

case ":$PATH:" in
  *":$dir:"*) evertap="evertap" ;;
  *)
    evertap="$dir/evertap"
    printf 'Add %s to your PATH to run evertap by name\n' "$dir"
    ;;
esac

if [ "$role" = client ]; then
  if [ -n "$installed" ]; then
    printf 'If evertap connect is running, restart it to use this version\n'
  else
    printf 'Pair this machine with evertap: %s login <the address you open evertap at>\n' "$evertap"
    printf 'In CI, set EVERTAP_URL and EVERTAP_API_KEY instead: https://evertap.dev/docs/connecting#ci-with-an-api-key\n'
  fi
  exit 0
fi

if [ -z "$service" ]; then
  if [ -n "$installed" ]; then
    printf 'If evertap serve is running, restart it to use this version\n'
  else
    # setup needs evertap serve running, which a fresh install does not have yet.
    printf 'Start evertap with %s serve, in a terminal or in tmux so it keeps running, then run %s setup beside it\n' "$evertap" "$evertap"
    printf 'Steps: https://evertap.dev/docs/install\n'
  fi
  exit 0
fi

data="${EVERTAP_DATA_DIR:-$HOME/.local/share/evertap}"
log="${sudo:+sudo }journalctl -u evertap@$user -n 50"

# The same check as `evertap uninstall`'s: the socket answers only while evertap serve runs.
answers() {
  tries=0
  until curl -fsS --max-time 2 --unix-socket "$data/evertap.sock" -o /dev/null http://localhost/api/health 2>/dev/null; do
    tries=$((tries + 1))
    [ "$tries" -lt 30 ] || return 1
    sleep 1
  done
}

if [ -e "$unit" ]; then
  cp "$unit" "$tmp/unit.prev"
fi
sed "s|^ExecStart=/usr/local/bin/evertap |ExecStart=$dir/evertap |" "$tmp/$name/evertap@.service" >"$tmp/evertap@.service"
if [ -e "$tmp/unit.prev" ] && ! cmp -s "$tmp/unit.prev" "$tmp/evertap@.service"; then
  printf 'Replacing %s. Changes of your own belong in a drop-in, which this leaves alone: sudo systemctl edit evertap@\n' "$unit"
fi
$sudo install -m 644 "$tmp/evertap@.service" "$unit"

# evertap's first start creates its records, where setup keeps its answers.
first=""
[ -e "$data/evertap.db" ] || first=1
# The copies evertap keeps of its records before an upgrade changes their format.
before="$(for file in "$data"/evertap.db.*.bak; do printf '%s\n' "$file"; done)"
$sudo systemctl daemon-reload
$sudo systemctl enable --quiet "evertap@$user"
printf 'Starting evertap as evertap@%s\n' "$user"
$sudo systemctl restart "evertap@$user" || true

if ! answers; then
  [ -n "$installed" ] || fail "evertap did not start. See why with: $log"
  old="$("$dir/evertap.prev" --version 2>/dev/null || true)"
  printf 'evertap %s did not start. Putting %s back\n' "$new" "${old:-the previous version}"
  $sudo systemctl stop "evertap@$user"
  $sudo install -m 755 "$dir/evertap.prev" "$dir/evertap"
  if [ -e "$tmp/unit.prev" ]; then
    $sudo install -m 644 "$tmp/unit.prev" "$unit"
  fi
  # A new version that changed the records' format leaves them unreadable to the old one. Each
  # failed start can copy them again, so the oldest new copy is the one from before this run.
  copy=""
  for file in "$data"/evertap.db.*.bak; do
    [ -e "$file" ] || continue
    printf '%s\n' "$before" | grep -qxF "$file" && continue
    if [ -z "$copy" ] || [ "$file" -ot "$copy" ]; then
      copy="$file"
    fi
  done
  if [ -n "$copy" ]; then
    cp "$copy" "$data/evertap.db"
    rm -f "$data/evertap.db-wal" "$data/evertap.db-shm"
    printf 'Put back %s from %s\n' "$data/evertap.db" "$copy"
  fi
  $sudo systemctl daemon-reload
  $sudo systemctl start "evertap@$user" || true
  answers || fail "The previous evertap did not start either. See why with: $log"
  fail "evertap ${old:-the previous version} is running again. To see why $new did not start: $log"
fi
printf 'evertap %s is running. Its log: %s\n' "$new" "${sudo:+sudo }journalctl -u evertap@$user -f"

[ -n "$first" ] || exit 0
if [ -n "$tty" ]; then
  "$dir/evertap" setup </dev/tty
else
  printf 'Next, run %s setup on this machine to choose how evertap is reached. Without a terminal, give it flags: https://evertap.dev/docs/install/linux#set-up-and-sign-in\n' "$evertap"
fi
