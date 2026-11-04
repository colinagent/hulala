/**
 * Render the `install.sh` that ships beside a Hulala release.
 *
 * The archive carries the client, the embedded Host, and the bundled editor
 * binaries (`bin/nvim`, plus `bin/ime` on macOS). The script downloads and
 * verifies the archive for the detected platform, unpacks it, copies those
 * binaries into `<state root>/bin` as real files, and hands the extracted
 * package to its own `bin/hulala install`. That installer owns the versioned
 * layout (`versions/<id>`, `active.json`, `installation.json`) and the
 * `<bin>/hulala` launcher, so `hulala update` can replace exactly this
 * installation later. The install path never creates a symlink, and nothing the
 * editor needs is read out of the version directory once it has been published.
 *
 * Rendered by `scripts/release/installScript.ts`; kept as a pure function so the
 * generated shell can be checked without building four archives.
 *
 * @module hulala/release/install-script-template
 */

/** Values baked into one release's installer. */
export interface InstallScriptOptions {
  /** Stable release version, e.g. `0.1.8`. */
  readonly version: string
  /** `case` arms mapping `<os>-<arch>` to the archive name and its SHA-256. */
  readonly cases: string
  /** Base URL of the primary download (the R2 gateway). */
  readonly downloadBase: string
  /** Base URL of the GitHub release used as the fallback. */
  readonly githubBase: string
}

/**
 * Render the installer for one release.
 * @param options - version, platform cases and download bases.
 * @returns the complete POSIX shell installer.
 */
export function renderInstallScript(options: InstallScriptOptions): string {
  const { version, cases, downloadBase, githubBase } = options
  return `#!/bin/sh
# Install the Hulala terminal client and its embedded Host.
#
#   curl -fsSL https://hulala.ai/install.sh | sh
#
# The download is verified against a pinned SHA-256 before anything is
# unpacked. The client runs on Node; the archive already contains the Host.
set -eu
version='${version}'
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d ' ' -f 1
  else shasum -a 256 "$1" | cut -d ' ' -f 1; fi
}
transfer() {
  if command -v curl >/dev/null 2>&1; then
    protocol='=https'
    case "$url" in http://127.0.0.1:*|http://\\[::1\\]:*) protocol='=https,http' ;; esac
    curl --silent --show-error --fail --location --connect-timeout 15 --max-time 900 --speed-limit 32768 --speed-time 20 --proto "$protocol" --proto-redir "$protocol" --continue-at - --output "$destination" "$url" 2>"$work/download-error"
  elif command -v wget >/dev/null 2>&1; then
    wget --quiet --continue --timeout=20 --tries=1 -O "$destination" "$url" 2>"$work/download-error"
  else
    echo 'curl or wget is required to install Hulala.' >&2
    exit 1
  fi
}
download() {
  destination=$1 expected=$2 primary=$3 fallback=$4
  round=1
  while [ "$round" -le 3 ]; do
    for url in "$primary" "$fallback"; do
      [ -n "$url" ] || continue
      source_name='official source'
      [ "$url" != "$fallback" ] || source_name='GitHub mirror'
      echo "Downloading from $source_name (attempt $round)..." >&2
      result=0
      transfer || result=$?
      if [ "$result" -eq 33 ] || [ "$result" -eq 36 ]; then
        # This source cannot resume; retry it once from zero.
        rm -f "$destination"
        result=0
        transfer || result=$?
      fi
      if [ "$result" -eq 0 ]; then
        if [ "$(sha256 "$destination")" = "$expected" ]; then return 0; fi
        echo 'SHA-256 mismatch; discarding download.' >&2
        rm -f "$destination"
      fi
      echo 'Download interrupted or unavailable; trying the next source.' >&2
    done
    round=$((round + 1))
  done
  echo 'Download failed. Hulala has not been installed. Please retry the installation command.' >&2
  return 1
}
check_writable() {
  if ! mkdir -p "$1" 2>/dev/null; then
    echo "Cannot create directory: $1" >&2
    echo 'The current account cannot write here. Check directory ownership with your administrator; do not run this installer with sudo.' >&2
    exit 1
  fi
  probe=$(mktemp -d "$1/.hulala-write-check.XXXXXX") || { echo "Directory is not writable: $1. Installation stopped before downloading." >&2; exit 1; }
  rmdir "$probe"
}
check_node() {
  command -v node >/dev/null 2>&1 || { echo 'Hulala runs on Node.js 22.13 or newer. Install Node, then run this command again.' >&2; exit 1; }
  node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  node_minor=$(node -p 'process.versions.node.split(".")[1]' 2>/dev/null || echo 0)
  if [ "$node_major" -lt 22 ] || { [ "$node_major" -eq 22 ] && [ "$node_minor" -lt 13 ]; }; then
    echo "Hulala needs Node.js 22.13 or newer; this is $(node --version)." >&2
    exit 1
  fi
}
preflight() {
  echo 'Checking platform and installation directory permissions...' >&2
  state_root=\${HULALA_HOME:-"$HOME/.hulala"}
  install_root=\${HULALA_INSTALL_ROOT:-"$state_root/runtime/client"}
  command_bin=\${HULALA_BIN:-}
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --root|--bin)
        key=$1; shift
        [ "$#" -gt 0 ] || { echo "Missing value for $key" >&2; exit 1; }
        if [ "$key" = --root ]; then install_root=$1; else command_bin=$1; fi ;;
    esac
    shift
  done
  check_writable "$state_root"
  check_writable "$install_root"
  if [ -n "$command_bin" ]; then check_writable "$command_bin"; fi
  check_node
}
# Publish the archive's bundled binaries as real files in the state root, so
# every part of Hulala finds the same nvim and helpers and nothing there is a
# symlink.
install_binaries() {
  package=$1
  bin_root="$state_root/bin"
  mkdir -p "$bin_root"
  for binary in "$package"/bin/*; do
    [ -f "$binary" ] || continue
    name=$(basename "$binary")
    if [ "$name" = hulala ]; then continue; fi
    cp -f "$binary" "$bin_root/$name"
    chmod 755 "$bin_root/$name"
  done
}
# EPUB reading in the editor shells out to unzip; the client itself does not
# need it. Installing packages from a piped script is the risky part, so every
# step here is best effort, the caller ignores the result, and a machine without
# sudo or without network just gets the command to run by hand.
ensure_unzip() {
  if command -v unzip >/dev/null 2>&1; then return 0; fi
  echo 'unzip is missing; EPUB reading in the editor needs it. Trying to install it...' >&2
  runner=''
  if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then runner='sudo'; else
      echo 'Install unzip yourself to read EPUB files (for example: sudo apt-get install unzip).' >&2
      return 1
    fi
  fi
  if command -v apt-get >/dev/null 2>&1; then
    $runner apt-get update >/dev/null 2>&1 || true
    $runner apt-get install -y unzip && return 0
  elif command -v dnf >/dev/null 2>&1; then $runner dnf install -y unzip && return 0
  elif command -v yum >/dev/null 2>&1; then $runner yum install -y unzip && return 0
  elif command -v pacman >/dev/null 2>&1; then $runner pacman -S --noconfirm unzip && return 0
  elif command -v zypper >/dev/null 2>&1; then $runner zypper --non-interactive install unzip && return 0
  elif command -v apk >/dev/null 2>&1; then $runner apk add --no-cache unzip && return 0
  elif command -v brew >/dev/null 2>&1; then brew install unzip && return 0
  fi
  echo 'Could not install unzip automatically. Install it to read EPUB files.' >&2
  return 1
}
# Hand the extracted package to the install command it ships. That command
# writes the immutable version directory, the receipt and the real launcher
# script, so the update command replaces exactly this installation instead of a
# private directory layout the updater does not know.
release_command() {
  package=$1
  if [ -n "$command_bin" ]; then
    "$package/bin/hulala" install --from "$package" --root "$install_root" --bin "$command_bin" --version "$version"
  else
    "$package/bin/hulala" install --from "$package" --root "$install_root" --version "$version"
  fi
}
main() {
  preflight "$@"
  os=$(uname -s)
  arch=$(uname -m)
  case "$os" in Darwin) os=darwin ;; Linux) os=linux ;; *) echo 'Unsupported operating system. Hulala installs on macOS and Linux.' >&2; exit 1 ;; esac
  case "$arch" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; *) echo 'Unsupported CPU architecture.' >&2; exit 1 ;; esac
  if [ "$os" = linux ] && { [ -f /etc/alpine-release ] || ldd --version 2>&1 | grep -qi musl; }; then
    echo 'This release targets glibc Linux; musl has not been validated.' >&2
    exit 1
  fi
  case "$os-$arch" in
${cases}
  *) echo "Unsupported platform: $os-$arch" >&2; exit 1 ;;
  esac
  work=$(mktemp -d "\${TMPDIR:-/tmp}/hulala-install.XXXXXX")
  trap 'rm -rf "$work"' EXIT INT TERM
  download "$work/$archive" "$archive_sha" '${downloadBase}/'"$archive" '${githubBase}/'"$archive"
  echo 'Unpacking...' >&2
  package="$work/package"
  mkdir -p "$package"
  tar -xzf "$work/$archive" -C "$package" --strip-components=1
  release_command "$package"
  install_binaries "$package"
  ensure_unzip || true
  echo "Hulala $version installed. Its own binaries stay in $state_root/bin." >&2
  echo 'Install future updates with: hulala update' >&2
}
main "$@"
`
}
