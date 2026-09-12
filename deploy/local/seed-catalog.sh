#!/usr/bin/env bash
# 往本机平台目录里种初始套餐与算力档位（RFC-001）。幂等：PUT 是 upsert，重复执行无副作用。
# 发行版里这一步由 `crewstation install` 的初始化阶段从发行包 profiles/ 读文件完成；
# 本机没有发行包，值直接写在这里，与 RFC-001 design §7 的表一致。
# 前置：install-platform.sh 已跑完，控制台可登录。令牌与 Cookie 只进临时文件，从不打印。
set -euo pipefail
CONSOLE_URL="${CS_CONSOLE_URL:-http://console.cs.localhost}"
ADMIN_USERNAME="${CS_ADMIN_USERNAME:-admin}"
SERVICE_PLAN="${CS_SERVICE_PLAN:-standard-small}"
TASK_PROFILE="${CS_TASK_PROFILE:-coding-medium}"

log() { printf '\033[1;34m[seed]\033[0m %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

TMP="$(mktemp -d)"; chmod 700 "${TMP}"; trap 'rm -rf "${TMP}"' EXIT
COOKIE_JAR="${TMP}/cookies"; BODY="${TMP}/response.json"; REQ="${TMP}/request.json"

api() { # METHOD PATH [with-body] -> 打印 HTTP 状态码，响应体落在 ${BODY}
  local method="$1" path="$2"
  local args=(-sS --max-time 60 -b "${COOKIE_JAR}" -H 'accept: application/json' -o "${BODY}" -w '%{http_code}' -X "${method}")
  [ "${3:-}" = "with-body" ] && args+=(-H 'content-type: application/json' --data-binary "@${REQ}")
  curl "${args[@]}" "${CONSOLE_URL}${path}" || printf '000'
}
detail() { head -c 300 "${BODY}" 2>/dev/null || true; }

code="$(curl -sS --max-time 30 -c "${COOKIE_JAR}" -o "${BODY}" -w '%{http_code}' \
  -H 'accept: application/json' -X POST "${CONSOLE_URL}/auth/login" \
  --data-urlencode "username=${ADMIN_USERNAME}" --data-urlencode 'displayName=CrewStation Admin' || printf '000')"
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

# 算力档位：业务只引用名字，驱动与模型只有平台知道（RFC-001）。
# 本机唯一真能跑的是 stub；balanced 与 deep 先种上，等真实凭据配好即可用，起 Agent 时会报驱动不可用而不是「档位不存在」。
jq -nc '{name:"sample-stub",driver:"stub",model:"stub/echo",description:"样例与自测，不消耗真实算力"}' \
  | put /v1/catalog/compute-profiles "算力档位 sample-stub"
jq -nc '{name:"balanced",driver:"claude-code",model:"anthropic/claude-sonnet-5",description:"默认档，日常开发与业务子任务"}' \
  | put /v1/catalog/compute-profiles "算力档位 balanced"
jq -nc '{name:"deep",driver:"claude-code",model:"anthropic/claude-opus-5",description:"复杂分析与重构"}' \
  | put /v1/catalog/compute-profiles "算力档位 deep"

log "完成。平台管理 → 算力档位 可以改。"
