#!/usr/bin/env bash
# 本机安装平台控制面：构建并导入镜像 → 写机密 → 应用清单 → 迁移 → 等待就绪。幂等，可重复执行。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NS=crewstation-system
NODE=desktop-control-plane
# shellcheck source=lib.sh
source "$ROOT/deploy/local/lib.sh" 2>/dev/null || true

log() { printf '\033[1;34m[install]\033[0m %s\n' "$*"; }
import_image() { # tag
  log "导入镜像 $1 到节点 containerd"
  docker save "$1" | docker exec -i "$NODE" ctr -n k8s.io images import --no-unpack=false - >/dev/null
}

if [[ "${SKIP_BUILD:-}" != "1" ]]; then
  log "构建镜像"
  docker build -q -f "$ROOT/deploy/docker/control-plane.Dockerfile" -t cs-control-plane:dev "$ROOT"
  docker build -q -f "$ROOT/deploy/docker/builder.Dockerfile" -t cs-builder:dev "$ROOT/deploy/docker"
  docker build -q -f "$ROOT/deploy/docker/console.Dockerfile" -t cs-console:dev "$ROOT"
  [[ -n "$(docker images -q cs-task-runtime:dev)" ]] || docker build -q -f "$ROOT/runtimes/task/Dockerfile" -t cs-task-runtime:dev "$ROOT"
  for img in cs-control-plane:dev cs-builder:dev cs-console:dev cs-task-runtime:dev; do import_image "$img"; done
fi

log "机密：crewstation-secrets"
DB_URL="$(kubectl -n $NS get secret postgres-credentials -o jsonpath='{.data.url}' | base64 -d)"
[[ -n "$DB_URL" ]] || { echo "postgres-credentials 缺少 url" >&2; exit 1; }
if kubectl -n $NS get secret crewstation-secrets >/dev/null 2>&1; then
  SECRET_KEY="$(kubectl -n $NS get secret crewstation-secrets -o jsonpath='{.data.CS_SECRET_KEY}' | base64 -d)"
else
  SECRET_KEY="$(openssl rand -base64 32)"
fi
GITLAB_TOKEN=""
if [[ -f "$ROOT/.local/gitlab.env" ]]; then GITLAB_TOKEN="$(grep '^CS_TEST_GITLAB_TOKEN=' "$ROOT/.local/gitlab.env" | cut -d= -f2-)"; fi
[[ -n "$GITLAB_TOKEN" ]] || log "警告：未找到 .local/gitlab.env，GitLab 令牌为空，建仓与发布不可用"
kubectl -n $NS create secret generic crewstation-secrets \
  --from-literal=CS_DATABASE_URL="$DB_URL" \
  --from-literal=CS_DATA_POSTGRES_ADMIN_URL="$DB_URL" \
  --from-literal=CS_SECRET_KEY="$SECRET_KEY" \
  --from-literal=CS_GITLAB_TOKEN="$GITLAB_TOKEN" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null

log "应用平台清单"
kubectl apply -f "$ROOT/deploy/k8s/platform/00-rbac.yaml" -f "$ROOT/deploy/k8s/platform/10-config.yaml" >/dev/null
kubectl -n $NS delete job crewstation-migrate --ignore-not-found >/dev/null
kubectl apply -f "$ROOT/deploy/k8s/platform/20-migrate-job.yaml" >/dev/null
log "等待迁移 Job"
if ! kubectl -n $NS wait --for=condition=complete job/crewstation-migrate --timeout=180s >/dev/null 2>&1; then
  kubectl -n $NS logs job/crewstation-migrate --tail=50 || true
  echo "迁移失败" >&2; exit 1
fi
for f in 30-cs-api 31-cs-auth 32-cs-controller 33-cs-session 34-cs-events 35-console 36-mcp-capabilities 37-mcp-operations 40-gateway; do kubectl apply -f "$ROOT/deploy/k8s/platform/$f.yaml" >/dev/null; done
for d in cs-api cs-auth cs-controller cs-session cs-events console mcp-capabilities mcp-operations; do
  kubectl -n $NS rollout restart deployment/$d >/dev/null 2>&1 || true
  kubectl -n $NS rollout status deployment/$d --timeout=180s
done
# 套餐与算力档位是建项目、起 Agent 的前置；装完就种上，省得第一次用的时候才发现目录是空的。
"$ROOT/deploy/local/seed-catalog.sh"

log "完成。控制台：http://console.cs.localhost/  登录：http://console.cs.localhost/auth/login"
kubectl -n $NS get pods -o wide
