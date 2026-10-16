import type { ReleaseTarget } from '@hulala/distribution/targets'
import { downloadUrl } from '@hulala/distribution/archive'
export interface BootstrapAsset {
  installer: string; installerSha256: string; archive: string; archiveSha256: string
  installerFallback?: string; archiveFallback?: string
}
const sh = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
const ps = (value: string) => "'" + value.replaceAll("'", "''") + "'"
export function posixInstaller(assets: Partial<Record<ReleaseTarget, BootstrapAsset>>): string {
  for (const asset of Object.values(assets)) {
    for (const url of [asset!.installer, asset!.archive, asset!.installerFallback, asset!.archiveFallback]) if (url) downloadUrl(url)
    if (![asset!.installerSha256, asset!.archiveSha256].every(hash => /^[a-f0-9]{64}$/.test(hash))) throw new Error('Pinned SHA-256 is required')
  }
  const cases = Object.entries(assets).filter(([target]) => !target.startsWith('win32-')).map(([target, value]) => `  ${target}) installer=${sh(value!.installer)}; installer_sha=${sh(value!.installerSha256)}; archive=${sh(value!.archive)}; archive_sha=${sh(value!.archiveSha256)}; installer_fallback=${sh(value!.installerFallback || '')}; archive_fallback=${sh(value!.archiveFallback || '')} ;;`).join('\n')
  return `#!/bin/sh
# Download both pinned assets before invoking the installer. Never execute a partial download.
set -eu
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d ' ' -f 1
  else shasum -a 256 "$1" | cut -d ' ' -f 1; fi
}
transfer() {
  if command -v curl >/dev/null 2>&1; then
    protocol='=https'
    case "$url" in http://127.0.0.1:*|http://\\[::1\\]:*) protocol='=https,http' ;; esac
    curl --fail --location --connect-timeout 15 --max-time 600 --speed-limit 32768 --speed-time 20 --proto "$protocol" --proto-redir "$protocol" --continue-at - --output "$destination" "$url"
  else
    wget --continue --timeout=20 --tries=1 -O "$destination" "$url"
  fi
}
download() {
  destination=$1 expected=$2 primary=$3 fallback=$4
  round=1
  while [ "$round" -le 3 ]; do
    for url in "$primary" "$fallback"; do
      [ -n "$url" ] || continue
      echo "Downloading \${destination##*/} (attempt $round)..." >&2
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
      echo 'Download interrupted or unavailable; retrying with the next available source.' >&2
    done
    round=$((round + 1))
  done
  echo 'Download failed. Hulala has not been installed. Please retry the installation command.' >&2
  return 1
}
main() {
  os=$(uname -s)
  arch=$(uname -m)
  case "$os" in Darwin) os=darwin ;; Linux) os=linux ;; *) echo 'Unsupported operating system' >&2; exit 1 ;; esac
  case "$arch" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; *) echo 'Unsupported CPU architecture' >&2; exit 1 ;; esac
  if [ "$os" = linux ] && { [ -f /etc/alpine-release ] || ldd --version 2>&1 | grep -qi musl; }; then echo 'This release targets glibc Linux; musl has not been validated.' >&2; exit 1; fi
  case "$os-$arch" in
${cases}
    *) echo 'No validated package for this platform in this release.' >&2; exit 1 ;;
  esac
  if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then echo 'curl or wget is required.' >&2; exit 1; fi
  if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then echo 'A SHA-256 verification tool is required.' >&2; exit 1; fi
  work=$(mktemp -d "\${TMPDIR:-/tmp}/hulala-install.XXXXXX")
  trap 'rm -rf "$work"' EXIT
  trap 'exit 1' HUP INT TERM
  download "$work/hulala" "$installer_sha" "$installer" "$installer_fallback"
  download "$work/package.tar.gz" "$archive_sha" "$archive" "$archive_fallback"
  chmod 700 "$work/hulala"
  "$work/hulala" install --add-to-path --from "$work/package.tar.gz" --sha256 "$archive_sha" "$@"
}
main "$@"
`
}
export function windowsInstaller(asset?: BootstrapAsset): string {
  if (!asset) return "throw 'No validated Windows x64 package is included in this staged release.'\n"
  return `param([string]$InstallRoot,[string]$Bin,[switch]$AddToPath)\n$ErrorActionPreference='Stop'\nif([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64'){throw 'This release supports Windows x64 only.'}\n$work=Join-Path ([System.IO.Path]::GetTempPath()) ('hulala-install-'+[guid]::NewGuid().ToString())\nNew-Item -ItemType Directory -Path $work | Out-Null\ntry {\n  $installer=Join-Path $work 'hulala.exe'\n  Invoke-WebRequest -UseBasicParsing -Uri ${ps(asset.installer)} -OutFile $installer\n  if((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne ${ps(asset.installerSha256)}){throw 'Installer SHA-256 mismatch'}\n  $arguments=@('install','--from',${ps(asset.archive)},'--sha256',${ps(asset.archiveSha256)})\n  if($InstallRoot){$arguments+=@('--root',$InstallRoot)}\n  if($Bin){$arguments+=@('--bin',$Bin)}\n  if($AddToPath){$arguments+='--add-to-path'}\n  & $installer @arguments\n  if($LASTEXITCODE -ne 0){throw 'Hulala installation failed'}\n} finally { Remove-Item -LiteralPath $work -Recurse -Force }\n`
}
