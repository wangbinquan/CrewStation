#!/usr/bin/env bash
# 安装本机开发角色登录器。只读管理员凭据来播种固定 OIDC 用户，不把凭据写进日志。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NS=crewstation-system
# shellcheck source=admin-credentials.sh
source "$ROOT/deploy/local/admin-credentials.sh"
resolve_admin_credentials "$ROOT"

log() { printf '\033[1;34m[dev-auth]\033[0m %s\n' "$*"; }

log "写入本机集群专用凭据"
kubectl -n "$NS" create secret generic crewstation-dev-auth \
  --from-literal=CS_ADMIN_USERNAME="$ADMIN_USERNAME" \
  --from-literal=CS_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null

log "应用开发角色登录器"
kubectl apply -f "$ROOT/deploy/local/dev-auth.yaml" >/dev/null
kubectl -n "$NS" rollout restart deployment/crewstation-dev-auth >/dev/null
if ! kubectl -n "$NS" rollout status deployment/crewstation-dev-auth --timeout=180s; then
  kubectl -n "$NS" logs deployment/crewstation-dev-auth --tail=80 >&2 || true
  exit 1
fi

log "已就绪：http://dev-auth.cs.localhost/"
