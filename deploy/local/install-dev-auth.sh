#!/usr/bin/env bash
# 安装本机开发角色登录器。只读管理员凭据来播种固定 OIDC 用户，不把凭据写进日志。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NS=crewstation-system
# shellcheck source=admin-credentials.sh
source "$ROOT/deploy/local/admin-credentials.sh"
resolve_admin_credentials "$ROOT"

log() { printf '\033[1;34m[dev-auth]\033[0m %s\n' "$*"; }

# 播种状态与就绪分开问：/readyz 只代表 IdP 端口在服务。
seed_field() {
  kubectl -n "$NS" exec deploy/crewstation-dev-auth -- \
    bun -e "const s = await (await fetch('http://127.0.0.1:7460/status.json')).json(); console.log(s.$1 ?? '');" \
    2>/dev/null | tr -d '\r\n' || true
}

# 路由前缀与客户端口令一次生成、此后一直沿用：平台里那条 dev-roles Provider 记的就是它们。
# 每次重启现摇，等于每次重启都要重新注册一次，而重新注册又要管理员密码登录——本机的密码登录平时是关的，
# 于是一次滚镜像就能把登录整条锁死（docs/engineering/dev-gotchas.md）。
ROUTE_ID=""; CLIENT_SECRET=""
if kubectl -n "$NS" get secret crewstation-dev-auth >/dev/null 2>&1; then
  ROUTE_ID="$(kubectl -n "$NS" get secret crewstation-dev-auth -o jsonpath='{.data.CS_DEV_AUTH_ROUTE_ID}' | base64 -d)"
  CLIENT_SECRET="$(kubectl -n "$NS" get secret crewstation-dev-auth -o jsonpath='{.data.CS_DEV_AUTH_CLIENT_SECRET}' | base64 -d)"
fi
[ -n "$ROUTE_ID" ] || ROUTE_ID="$(openssl rand -hex 8)"
[ -n "$CLIENT_SECRET" ] || CLIENT_SECRET="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"

log "写入本机集群专用凭据"
kubectl -n "$NS" create secret generic crewstation-dev-auth \
  --from-literal=CS_ADMIN_USERNAME="$ADMIN_USERNAME" \
  --from-literal=CS_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  --from-literal=CS_DEV_AUTH_ROUTE_ID="$ROUTE_ID" \
  --from-literal=CS_DEV_AUTH_CLIENT_SECRET="$CLIENT_SECRET" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null

log "应用开发角色登录器"
kubectl apply -f "$ROOT/deploy/local/dev-auth.yaml" >/dev/null
kubectl -n "$NS" rollout restart deployment/crewstation-dev-auth >/dev/null
if ! kubectl -n "$NS" rollout status deployment/crewstation-dev-auth --timeout=180s; then
  kubectl -n "$NS" logs deployment/crewstation-dev-auth --tail=80 >&2 || true
  exit 1
fi

# 安装时密码登录必定是开的（首位管理员刚建好），所以播种失败是真问题，要当场报出来而不是让它静静降级。
log "等待角色播种"
SEED_STATUS=""
for _ in $(seq 1 60); do
  SEED_STATUS="$(seed_field status)"
  [ "$SEED_STATUS" = ready ] && break
  sleep 2
done
if [ "$SEED_STATUS" != ready ]; then
  printf 'ERROR: 开发 IdP 已在服务，但角色播种未完成（status=%s）：%s\n' "${SEED_STATUS:-unknown}" "$(seed_field error)" >&2
  printf '       角色账号、平台角色与 Provider 注册都要管理员密码登录；确认密码登录已开启后，打开 http://dev-auth.cs.localhost/ 点「重新准备」。\n' >&2
  exit 1
fi

log "已就绪：http://dev-auth.cs.localhost/"
