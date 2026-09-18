#!/usr/bin/env bash
# 往本机平台目录里种初始服务套餐与任务容器规格。幂等：PUT 是 upsert，重复执行无副作用。
# 发行版里这一步由 `crewstation install` 的初始化阶段从发行包 profiles/ 读文件完成；本机没有发行包，值直接写在这里。
# 算力档位不预置（RFC-006）：档位要指定镜像与二进制并真实测试通过才可选，由管理员在平台管理 → 算力档位里创建。
# 前置：install-platform.sh 已跑完，控制台可登录。令牌与 Cookie 只进临时文件，从不打印。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONSOLE_URL="${CS_CONSOLE_URL:-http://console.cs.localhost}"
SERVICE_PLAN="${CS_SERVICE_PLAN:-standard-small}"
TASK_PROFILE="${CS_TASK_PROFILE:-coding-medium}"

log() { printf '\033[1;34m[seed]\033[0m %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# shellcheck source=deploy/local/admin-credentials.sh
. "${ROOT}/deploy/local/admin-credentials.sh"
resolve_admin_credentials "${ROOT}" || exit 1

TMP="$(mktemp -d)"; chmod 700 "${TMP}"; trap 'rm -rf "${TMP}"' EXIT
COOKIE_JAR="${TMP}/cookies"; BODY="${TMP}/response.json"; REQ="${TMP}/request.json"

api() { # METHOD PATH [with-body] -> 打印 HTTP 状态码，响应体落在 ${BODY}
  local method="$1" path="$2"
  local args=(-sS --max-time 60 -b "${COOKIE_JAR}" -H 'accept: application/json' -o "${BODY}" -w '%{http_code}' -X "${method}")
  [ "${3:-}" = "with-body" ] && args+=(-H 'content-type: application/json' --data-binary "@${REQ}")
  curl "${args[@]}" "${CONSOLE_URL}${path}" || printf '000'
}
detail() { head -c 300 "${BODY}" 2>/dev/null || true; }

code="$(admin_login_request "${CONSOLE_URL}" "${COOKIE_JAR}" "${BODY}")"
[ "${code}" = "200" ] || die "以 ${ADMIN_USERNAME} 登录 ${CONSOLE_URL} 失败：HTTP ${code} $(detail)"
chmod 600 "${COOKIE_JAR}"
[ "$(jq -r '.user.isAdmin' "${BODY}")" = "true" ] || die "${ADMIN_USERNAME} 不是管理员，写不了平台目录"

put() { # 路径 说明 <<< JSON
  local path="$1" what="$2" code
  cat > "${REQ}"
  code="$(api PUT "${path}" with-body)"
  [ "${code}" = "200" ] || die "登记${what}失败：HTTP ${code} $(detail)"
  log "已登记${what}"
}

jq -nc --arg n "${SERVICE_PLAN}" '{name:$n,cpu:"500m",memory:"512Mi",maxReplicas:3,description:"本机默认服务套餐"}' \
  | put /v1/catalog/service-plans "服务套餐 ${SERVICE_PLAN}"
jq -nc --arg n "${TASK_PROFILE}" '{name:$n,cpu:"1",memory:"2Gi",storage:"10Gi",description:"本机默认任务容器规格"}' \
  | put /v1/catalog/task-profiles "任务容器规格 ${TASK_PROFILE}"

log "完成。算力档位请在平台管理 → 算力档位里创建、测试通过并设为默认。"
