/**
 * Render the `install.sh` that ships beside a Hulala release.
 *
 * The archive carries the client, the embedded Host, and the bundled editor
 * binaries (`bin/nvim`, plus `bin/ime` on macOS), but no JavaScript runtime. A
 * machine without Node.js 24.9+ is offered an install from the package manager
 * it already has, or a SHA-256 verified standalone archive in
 * `<state root>/runtime/node`; the launcher reads that pointer, so nothing is
 * added to a shell profile. The script then downloads and verifies the release
 * archive for the detected platform, unpacks it, copies those binaries into
 * `<state root>/bin` as real files, and hands the extracted package to its own
 * `bin/hulala install`. That installer owns the versioned layout
 * (`versions/<id>`, `active.json`, `installation.json`) and the `<bin>/hulala`
 * launcher, so `hulala update` can replace exactly this installation later. The
 * install path never creates a symlink, and nothing the editor needs is read out
 * of the version directory once it has been published.
 *
 * Rendered by `scripts/release/installScript.ts`; kept as a pure function so the
 * generated shell can be checked without building four archives.
 *
 * @module hulala/release/install-script-template
 */

/**
 * The `nodejs.org/dist/<line>` release line the installer downloads when the
 * machine has no usable Node.js. It is the line Hulala builds and tests against,
 * not "whatever is newest": `latest` follows Node.js Current, which is an odd
 * major that is not an LTS. Bump it deliberately, together with the release CI
 * `node-version` and the `engines` floor taken from `@deepseek-ai/dsh`.
 */
export const DEFAULT_NODE_LINE = 'latest-v24.x'

/** Values baked into one release's installer. */
export interface InstallScriptOptions {
  /** Stable release version, e.g. `0.1.8`. */
  readonly version: string
  /**
   * `case` arms mapping `<os>-<arch>` to the archive name, its SHA-256 and the
   * per-target runtime pack (`archive`, `archive_sha`, `runtime_pack_url`,
   * `runtime_pack_sha`).
   */
  readonly cases: string
  /** URL and digest of the release's npm lock, shared by every target. */
  readonly lock: string
  readonly lockSha256: string
  /** Base URL of the primary download (the R2 gateway). */
  readonly downloadBase: string
  /** Base URL of the GitHub release used as the fallback. */
  readonly githubBase: string
  /** `nodejs.org/dist` release line, defaulting to {@link DEFAULT_NODE_LINE}. */
  readonly nodeLine?: string
}

/**
 * Render the installer for one release.
 * @param options - version, platform cases and download bases.
 * @returns the complete POSIX shell installer.
 */
export function renderInstallScript(options: InstallScriptOptions): string {
  const { version, cases, downloadBase, githubBase, lock, lockSha256, nodeLine = DEFAULT_NODE_LINE } = options
  return `#!/bin/sh
# Install the Hulala terminal client and its embedded Host.
#
#   curl -fsSL https://hulala.ai/install.sh | sh
#
# The download is verified against a pinned SHA-256 before anything is
# unpacked. The client runs on Node; the archive already contains the Host.
set -eu
version='${version}'
runtime_lock_url='${lock}'
runtime_lock_sha='${lockSha256}'
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
# Node is the only thing Hulala needs from the machine. The archive carries the
# Host but no JavaScript runtime, so a machine without a usable Node gets one
# here: from the package manager it already has, or as a verified standalone
# download inside the state root. Nothing is installed system-wide without the
# user answering a prompt, and no shell profile is edited either way.
node_requirement='Hulala needs Node.js 24.9 or newer.'
# A machine behind a desktop proxy (Clash, Surge, V2Ray) usually has no proxy
# environment variables: curl and npm read the environment, not the operating
# system's proxy settings. Detect the system proxy once and export it for every
# download this installer makes. An environment proxy always wins, and a PAC file
# is reported instead of guessed at.
detect_system_proxy() {
  if [ -n "\${HTTPS_PROXY:-}\${https_proxy:-}\${ALL_PROXY:-}\${all_proxy:-}" ]; then return 0; fi
  node_proxy_host=''
  node_proxy_port=''
  case "$(uname -s)" in
    Darwin)
      node_scutil=$(scutil --proxy 2>/dev/null) || return 0
      if printf '%s\\n' "$node_scutil" | grep -q 'ProxyAutoConfigEnable : 1'; then
        echo 'A proxy auto-configuration (PAC) file is set; this installer reads the shell environment only. Export HTTPS_PROXY if the download fails.' >&2
        return 0
      fi
      if [ "$(printf '%s\\n' "$node_scutil" | awk '/HTTPSEnable :/ { print $3; exit }')" = '1' ]; then
        node_proxy_host=$(printf '%s\\n' "$node_scutil" | awk '/HTTPSProxy :/ { print $3; exit }')
        node_proxy_port=$(printf '%s\\n' "$node_scutil" | awk '/HTTPSPort :/ { print $3; exit }')
      elif [ "$(printf '%s\\n' "$node_scutil" | awk '/HTTPEnable :/ { print $3; exit }')" = '1' ]; then
        node_proxy_host=$(printf '%s\\n' "$node_scutil" | awk '/HTTPProxy :/ { print $3; exit }')
        node_proxy_port=$(printf '%s\\n' "$node_scutil" | awk '/HTTPPort :/ { print $3; exit }')
      fi
      ;;
    Linux)
      if command -v gsettings >/dev/null 2>&1 && [ "$(gsettings get org.gnome.system.proxy mode 2>/dev/null)" = "'manual'" ]; then
        node_proxy_host=$(gsettings get org.gnome.system.proxy.https host 2>/dev/null | tr -d "'")
        node_proxy_port=$(gsettings get org.gnome.system.proxy.https port 2>/dev/null)
        if [ -z "$node_proxy_host" ]; then
          node_proxy_host=$(gsettings get org.gnome.system.proxy.http host 2>/dev/null | tr -d "'")
          node_proxy_port=$(gsettings get org.gnome.system.proxy.http port 2>/dev/null)
        fi
      fi
      ;;
  esac
  case "$node_proxy_host" in ''|*[!0-9A-Za-z._-]*) return 0 ;; esac
  case "$node_proxy_port" in ''|*[!0-9]*) return 0 ;; esac
  node_proxy="http://$node_proxy_host:$node_proxy_port"
  http_proxy=$node_proxy https_proxy=$node_proxy HTTP_PROXY=$node_proxy HTTPS_PROXY=$node_proxy
  npm_config_proxy=$node_proxy npm_config_https_proxy=$node_proxy
  export http_proxy https_proxy HTTP_PROXY HTTPS_PROXY npm_config_proxy npm_config_https_proxy
  echo "Using the system proxy $node_proxy" >&2
}
# Where the standalone Node archive may come from. nodejs.org first; the Chinese
# mirrors are the same bytes behind the same checksums, which is what makes them
# safe to accept as a transport fallback. HULALA_NODE_BASE overrides the list.
node_bases() {
  if [ -n "\${HULALA_NODE_BASE:-}" ]; then printf '%s\\n' "$HULALA_NODE_BASE"; fi
  printf '%s\\n' 'https://nodejs.org/dist' 'https://npmmirror.com/mirrors/node' 'https://mirrors.tuna.tsinghua.edu.cn/nodejs-release' 'https://mirrors.cloud.tencent.com/nodejs-release'
}
# The floor is DeepSeek Harness's own engines field (@deepseek-ai/dsh), because
# the Host boots it in process; do not lower it below what DSH declares.
node_version_is_new_enough() {
  node_seen=\${1#v}
  node_major=\${node_seen%%.*}
  node_rest=\${node_seen#*.}
  node_minor=\${node_rest%%.*}
  node_minor=\${node_minor%%[!0-9]*}
  [ -n "$node_minor" ] || node_minor=0
  case "$node_major$node_minor" in ''|*[!0-9]*) return 1 ;; esac
  if [ "$node_major" -gt 24 ]; then return 0; fi
  if [ "$node_major" -lt 24 ]; then return 1; fi
  if [ "$node_minor" -ge 9 ]; then return 0; fi
  return 1
}
node_is_usable() {
  node_seen=$("$1" --version 2>/dev/null) || return 1
  case "$node_seen" in v[0-9]*) ;; *) return 1 ;; esac
  node_version_is_new_enough "$node_seen"
}
# The Node this installer put in the shared data directory, if any. Its bin/node
# is a real script (never a symlink) that follows the version the CURRENT pointer
# names.
node_bin_root() {
  [ -f "$node_root/CURRENT" ] || return 0
  node_name=$(cat "$node_root/CURRENT" 2>/dev/null) || return 0
  case "$node_name" in ''|.*|*[!0-9A-Za-z._-]*) return 0 ;; esac
  [ -x "$node_root/bin/node" ] || return 0
  printf '%s/bin' "$node_root"
}
use_node_bin() {
  PATH=$1:$PATH
  export PATH
}
detect_node_install_method() {
  case "$(uname -s)" in
    Darwin)
      if command -v brew >/dev/null 2>&1; then printf 'homebrew'; else printf 'standalone'; fi ;;
    Linux)
      if command -v apt-get >/dev/null 2>&1 && command -v apt-cache >/dev/null 2>&1 && apt_node_is_new_enough; then printf 'apt'
      elif command -v apk >/dev/null 2>&1 && apk_node_is_new_enough; then printf 'apk'
      else printf 'standalone'; fi ;;
    *) printf 'standalone' ;;
  esac
}
apt_node_is_new_enough() {
  node_candidate=$(apt-cache policy nodejs 2>/dev/null | awk '/Candidate:/ { print $2; exit }')
  [ -n "$node_candidate" ] && [ "$node_candidate" != '(none)' ] && node_version_is_new_enough "$node_candidate"
}
apk_node_is_new_enough() {
  node_candidate=$(apk search -x nodejs 2>/dev/null | awk -F- '/^nodejs-/ { print $2; exit }')
  [ -n "$node_candidate" ] && node_version_is_new_enough "$node_candidate"
}
# The installer runs inside a piped shell (curl ... | sh), so prompts go to the
# terminal itself and never to stdin, which holds this script.
install_node_interactive() {
  node_method=$(detect_node_install_method)
  case "$node_method" in
    homebrew) node_label='Homebrew' ;;
    apt) node_label='apt-get' ;;
    apk) node_label='apk' ;;
    *) node_label='a verified Node.js download inside the Hulala state directory' ;;
  esac
  if ! ( : <>/dev/tty ) 2>/dev/null; then
    # Piped or container installs: never guess, and never touch a machine
    # silently. The caller prints the requirement and how to satisfy it.
    return 1
  fi
  exec 3<>/dev/tty
  printf '%s Install it now with %s? [Y/n] ' "$node_requirement" "$node_label" >&3
  node_answer=''
  # Enter accepts the default; a closed terminal is not consent to install.
  if ! IFS= read -r node_answer <&3; then node_answer='n'; fi
  exec 3>&-
  case "$node_answer" in n|N|no|NO) return 1 ;; esac
  echo "Installing Node.js with $node_label..." >&2
  install_node "$node_method" || return 1
  # The package manager replaced a binary this shell may have looked up already.
  hash -r 2>/dev/null || true
  if node_is_usable node; then return 0; fi
  node_installed=$(node_bin_root)
  [ -n "$node_installed" ] || return 1
  use_node_bin "$node_installed"
}
install_node() {
  case "$1" in
    homebrew) install_node_with_homebrew ;;
    apt) install_node_with_apt ;;
    apk) install_node_with_apk ;;
    *) install_node_standalone ;;
  esac
}
install_node_with_homebrew() {
  if brew list node >/dev/null 2>&1; then brew upgrade node; else brew install node; fi
}
install_node_with_apt() {
  if [ "$(id -u)" -eq 0 ]; then
    apt-get update && apt-get install -y nodejs
  elif command -v sudo >/dev/null 2>&1; then
    echo 'This asks for your administrator password.' >&2
    sudo sh -c 'apt-get update && apt-get install -y nodejs'
  else
    apt-get install -y nodejs
  fi
}
install_node_with_apk() {
  if [ "$(id -u)" -eq 0 ]; then apk add --update-cache nodejs
  elif command -v sudo >/dev/null 2>&1; then sudo apk add --update-cache nodejs
  else apk add --update-cache nodejs; fi
}
# One download and no administrator: nodejs.org publishes the archive and its
# SHA-256 in the same directory, so the digest is checked before anything is
# unpacked.
fetch() {
  node_url=$1 node_target=$2
  if command -v curl >/dev/null 2>&1; then
    node_protocol='=https'
    case "$node_url" in http://127.0.0.1:*|http://\[::1\]:*) node_protocol='=https,http' ;; esac
    curl --silent --show-error --fail --location --connect-timeout 15 --max-time 600 --proto "$node_protocol" --proto-redir "$node_protocol" --output "$node_target" "$node_url"
  elif command -v wget >/dev/null 2>&1; then
    wget --quiet --timeout=30 --tries=2 -O "$node_target" "$node_url"
  else
    echo 'curl or wget is required to download Node.js.' >&2
    return 1
  fi
}
install_node_standalone() {
  case "$(uname -s)" in
    Darwin) node_platform='darwin' ;;
    Linux) node_platform='linux' ;;
    *) echo 'Node.js cannot be installed automatically on this operating system; install Node, then run this command again.' >&2; return 1 ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) node_arch='arm64' ;;
    x86_64|amd64) node_arch='x64' ;;
    *) echo 'Node.js cannot be installed automatically on this CPU architecture; install Node, then run this command again.' >&2; return 1 ;;
  esac
  node_line=\${HULALA_NODE_LINE:-${nodeLine}}
  node_work=$(mktemp -d "\${TMPDIR:-/tmp}/hulala-node.XXXXXX") || return 1
  # The checksum file decides what a valid archive is, so it is taken from
  # nodejs.org when reachable; a mirror's own copy is a corruption check only and
  # says so.
  node_sums=''
  for node_mirror in $(node_bases); do
    if fetch "$node_mirror/$node_line/SHASUMS256.txt" "$node_work/SHASUMS256.txt"; then node_sums=$node_mirror; break; fi
  done
  if [ -z "$node_sums" ]; then
    echo "Could not read Node.js $node_line checksums from nodejs.org or a mirror." >&2
    rm -rf "$node_work"
    return 1
  fi
  if [ "$node_sums" != 'https://nodejs.org/dist' ]; then
    if [ -n "\${HULALA_NODE_BASE:-}" ] && [ "$node_sums" = "$HULALA_NODE_BASE" ]; then
      echo "Using the configured Node.js source $node_sums and its checksum file." >&2
    else
      echo "nodejs.org was unreachable; using the $node_sums mirror and its checksum file." >&2
    fi
  fi
  node_suffix="-$node_platform-$node_arch.tar.gz"
  node_file=$(awk -v suffix="$node_suffix" 'index($2, "node-v") == 1 && length($2) >= length(suffix) && substr($2, length($2) - length(suffix) + 1) == suffix { print $2; exit }' "$node_work/SHASUMS256.txt")
  if [ -z "$node_file" ]; then
    echo "No Node.js build is published for $node_platform-$node_arch." >&2
    rm -rf "$node_work"
    return 1
  fi
  node_name=\${node_file%.tar.gz}
  node_expected=$(awk -v file="$node_file" '$2 == file { print $1; exit }' "$node_work/SHASUMS256.txt")
  if [ -z "$node_expected" ]; then
    echo "The Node.js checksum file lists no digest for $node_file." >&2
    rm -rf "$node_work"
    return 1
  fi
  node_downloaded=''
  for node_mirror in $(node_bases); do
    echo "Downloading Node.js $node_name from $node_mirror..." >&2
    if fetch "$node_mirror/$node_line/$node_file" "$node_work/$node_file" && [ "$(sha256 "$node_work/$node_file")" = "$node_expected" ]; then
      node_downloaded=$node_mirror
      break
    fi
    rm -f "$node_work/$node_file"
    echo 'Download interrupted or the archive did not match its SHA-256; trying the next source.' >&2
  done
  if [ -z "$node_downloaded" ]; then
    echo 'The Node.js download did not match its published SHA-256; discarding it.' >&2
    rm -rf "$node_work"
    return 1
  fi
  mkdir -p "$node_root" || { rm -rf "$node_work"; return 1; }
  rm -rf "$node_root/$node_name"
  if ! tar -xzf "$node_work/$node_file" -C "$node_root"; then rm -rf "$node_work"; return 1; fi
  # The archive also carries npm, corepack, headers and man pages. Hulala runs one
  # binary, and the rest would only put symlinks and disk in the state root.
  rm -rf "$node_root/$node_name/include" "$node_root/$node_name/share" "$node_root/$node_name/lib/node_modules" "$node_root/$node_name/CHANGELOG.md" "$node_root/$node_name/README.md"
  rm -f "$node_root/$node_name/bin/npm" "$node_root/$node_name/bin/npx" "$node_root/$node_name/bin/corepack"
  printf '%s\\n' "$node_name" > "$node_root/CURRENT.tmp" && mv -f "$node_root/CURRENT.tmp" "$node_root/CURRENT"
  # One runtime is enough: an older build this installer unpacked is dead weight.
  for node_entry in "$node_root"/*; do
    [ -d "$node_entry" ] || continue
    [ "$node_entry" = "$node_root/$node_name" ] || rm -rf "$node_entry"
  done
  rm -rf "$node_work"
  echo "Node.js installed in $node_root/$node_name (also at $node_root/bin/node)." >&2
}
check_node() {
  if node_is_usable node; then return 0; fi
  installed=$(node_bin_root)
  if [ -n "$installed" ]; then use_node_bin "$installed"; return 0; fi
  if install_node_interactive; then return 0; fi
  echo 'Hulala runs on Node.js 24.9 or newer. Install Node, then run this command again.' >&2
  exit 1
}
preflight() {
  echo 'Checking platform and installation directory permissions...' >&2
  state_root=\${HULALA_HOME:-"$HOME/.hulala"}
  # Node.js is a user-level runtime other software may want too, so it lives in
  # the XDG data directory (pi does the same with ~/.local/share/pi-node), not
  # inside Hulala's private state root.
  node_root=\${HULALA_NODE_HOME:-\${XDG_DATA_HOME:-"$HOME/.local/share"}/hulala-node}
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
  detect_system_proxy
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
# The archive carries the code, not its dependency tree: the install command
# fetches the tree from the release's npm lock, or from the runtime pack when npm
# or the registry is unreachable.
release_command() {
  package=$1
  runtime_auth="--runtime-lock-url $runtime_lock_url --runtime-lock-sha256 $runtime_lock_sha --runtime-pack-url $runtime_pack_url --runtime-pack-sha256 $runtime_pack_sha"
  if [ -n "$command_bin" ]; then
    "$package/bin/hulala" install --from "$package" --root "$install_root" --bin "$command_bin" --version "$version" $runtime_auth
  else
    "$package/bin/hulala" install --from "$package" --root "$install_root" --version "$version" $runtime_auth
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
  # The install command ends with the one line the user has to type ("Start it
  # with: hulala"), so the update hint goes first.
  echo 'Update Hulala later with: hulala update' >&2
  release_command "$package"
  install_binaries "$package"
  ensure_unzip || true
}
main "$@"
`
}
