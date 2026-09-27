#!/bin/sh
# 构建时下载并校验第三方二进制。三个参数：HTTPS URL、预期 SHA-256、最终绝对路径。
set -eu
url=${1:?HTTPS URL is required}
expected=${2:?SHA-256 is required}
target=${3:?absolute destination is required}
case "$url" in https://*) ;; *) echo 'HTTPS URL required' >&2; exit 1 ;; esac
printf '%s\n' "$expected" | grep -Eq '^[0-9a-f]{64}$' || { echo 'invalid SHA-256' >&2; exit 1; }
case "$target" in /*) ;; *) echo 'absolute destination required' >&2; exit 1 ;; esac
download=$(mktemp)
trap 'rm -f "$download"' EXIT
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' "$url" --output "$download"
actual=$(sha256sum "$download")
actual=${actual%% *}
[ "$actual" = "$expected" ] || { echo 'SHA-256 mismatch' >&2; exit 1; }
install -m 0755 "$download" "$target"
