#!/usr/bin/env bash
# Optional local RF1 Garage installation. System volumes are retained across reinstall and task cleanup.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/deploy/local/lib.sh"
check_environment
[[ "${KUBE_CONTEXT}" == 'docker-desktop' ]] || die "Local RF1 storage must not be installed into a production cluster"
bun run "$ROOT/deploy/local/object-storage/configure.ts"
kc apply -f "$ROOT/deploy/k8s/system/32-traefik.yaml" >/dev/null
kc -n "$SYSTEM_NS" rollout status deployment/traefik --timeout=300s
kc apply -f "$ROOT/deploy/k8s/platform/39-object-storage.yaml" >/dev/null
kc -n "$SYSTEM_NS" rollout status statefulset/garage --timeout=300s
bun run "$ROOT/deploy/local/object-storage/observation-token.ts"
if [[ "${1:-}" != '--infrastructure-only' ]]; then
  kc -n "$SYSTEM_NS" exec deployment/cs-api -- bun run apps/cs-api/src/main.ts storage-contract-enable
  if [[ -n "${CS_OBJECT_STORAGE_SESSION_FILE:-}" ]]; then
    bun run "$ROOT/deploy/local/object-storage/register.ts"
  else
    source "$ROOT/deploy/local/admin-credentials.sh"
    resolve_admin_credentials "$ROOT"
    CS_ADMIN_USERNAME="$ADMIN_USERNAME" CS_ADMIN_PASSWORD="$ADMIN_PASSWORD" bun run "$ROOT/deploy/local/object-storage/register.ts"
  fi
fi
