#!/usr/bin/env bash
# 在本机集群上建起两个内置接入容器项目：GitLab 事件生产者与参考 API 代理。
# 每个项目：管理员代建 → 等开通链跑完 → 写生产配置与密钥 → 把 integrations/ 下的源码推进它的仓库 → 触发发布到待命（preview）槽。
# 幂等，可重复执行：项目已存在就复用，源码与仓库一致就不提交，该提交已发布过就不再发。
# 前置：deploy/local/bootstrap.sh 与 deploy/local/install-platform.sh 已跑过，.local/gitlab.env 存在。
# 令牌、Cookie、密钥只进变量与 0600 的临时文件，从不打印。
# 变量一律写成 ${NAME}：中文标点紧跟 $NAME 时，bash 3.2 会把它当成变量名的一部分。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONSOLE_URL="${CS_CONSOLE_URL:-http://console.cs.localhost}"
SERVICE_PLAN_ID="${CS_SERVICE_PLAN_ID:-01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10}"
BRANCH="${CS_BRANCH:-main}"
# 集群内访问 GitLab 的地址；与 deploy/k8s/platform/10-config.yaml 的 CS_GITLAB_URL 一致。
IN_CLUSTER_GITLAB="${CS_IN_CLUSTER_GITLAB_URL:-http://host.docker.internal:8929}"
PROVISION_TIMEOUT="${CS_PROVISION_TIMEOUT:-180}"
RELEASE_TIMEOUT="${CS_RELEASE_TIMEOUT:-300}"

log() { printf '\033[1;34m[integrations]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[integrations]\033[0m %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"; }

TMP="$(mktemp -d)"; chmod 700 "${TMP}"; trap 'rm -rf "${TMP}"' EXIT
COOKIE_JAR="${TMP}/cookies"          # 会话 Cookie 只落在这里
CRED_FILE="${TMP}/git-credentials"   # git 凭据只落在这里
BODY="${TMP}/response.json"          # 最近一次响应体
REQ="${TMP}/request.json"            # 最近一次请求体；走文件而不是命令行，免得凭据出现在 ps 里

# api METHOD PATH [with-body]  -> 打印 HTTP 状态码，响应体落在 ${BODY}
api() {
  local method="$1" path="$2"
  local args=(-sS --max-time 60 -b "${COOKIE_JAR}" -H 'accept: application/json' -o "${BODY}" -w '%{http_code}' -X "${method}")
  if [ "${3:-}" = "with-body" ]; then
    args+=(-H 'content-type: application/json' --data-binary "@${REQ}")
  fi
  # 连不上时 curl 什么也不打印且返回非零：统一报成 000，由调用方给出可读的失败说明。
  curl "${args[@]}" "${CONSOLE_URL}${path}" || printf '000'
}

detail() { head -c 300 "${BODY}" 2>/dev/null || true; }

# shellcheck source=deploy/local/admin-credentials.sh
. "${ROOT}/deploy/local/admin-credentials.sh"
resolve_admin_credentials "${ROOT}" || exit 1

login() {
  local code
  code="$(admin_login_request "${CONSOLE_URL}" "${COOKIE_JAR}" "${BODY}")"
  [ "${code}" = "200" ] || die "以 ${ADMIN_USERNAME} 登录 ${CONSOLE_URL} 失败：HTTP ${code} $(detail)"
  chmod 600 "${COOKIE_JAR}"
  ADMIN_USER_ID="$(jq -r '.user.id' "${BODY}")"
  [ "$(jq -r '.user.isAdmin' "${BODY}")" = "true" ] || die "${ADMIN_USERNAME} 不是管理员，建不了项目"
  log "已登录 $(jq -r '.user.name' "${BODY}")，用户 ${ADMIN_USER_ID}"
}

# 套餐与算力档位在全新集群上是空的，而建项目会校验套餐存在。种目录只有一处实现：seed-catalog.sh。
ensure_service_plan() {
  local code
  code="$(api GET /v1/catalog/service-plans)"
  if [ "${code}" = "200" ] && jq -e --arg n "${SERVICE_PLAN_ID}" '.items[]? | select(.id==$n)' "${BODY}" >/dev/null; then
    log "服务套餐 ${SERVICE_PLAN_ID} 已存在"
    return 0
  fi
  log "平台目录是空的，先跑 seed-catalog.sh"
  "${ROOT}/deploy/local/seed-catalog.sh"
}

read_gitlab_env() {
  local file="${ROOT}/.local/gitlab.env"
  [ -f "${file}" ] || die "缺少 ${file}，其中需要 CS_TEST_GITLAB_URL 与 CS_TEST_GITLAB_TOKEN"
  GITLAB_URL="$(grep '^CS_TEST_GITLAB_URL=' "${file}" | cut -d= -f2- | sed 's#/*$##')"
  GITLAB_TOKEN="$(grep '^CS_TEST_GITLAB_TOKEN=' "${file}" | cut -d= -f2-)"
  [ -n "${GITLAB_URL}" ] && [ -n "${GITLAB_TOKEN}" ] \
    || die "${file} 里的 CS_TEST_GITLAB_URL 或 CS_TEST_GITLAB_TOKEN 是空的"
  # git 凭据走 credential store 文件，远端 URL 里不带任何密码，因此 git 的输出里也不会有。
  printf 'http://crewstation:%s@%s\n' "${GITLAB_TOKEN}" "${GITLAB_URL#http://}" > "${CRED_FILE}"
  chmod 600 "${CRED_FILE}"
}

# webhook 密钥留在 .local/（已被 .gitignore 忽略）：脚本不打印它，配 GitLab webhook 时从这个文件里取。
ensure_webhook_secret() {
  WEBHOOK_SECRET_FILE="${ROOT}/.local/gitlab-webhook-secret"
  mkdir -p "${ROOT}/.local"
  if [ ! -s "${WEBHOOK_SECRET_FILE}" ]; then
    openssl rand -hex 24 > "${WEBHOOK_SECRET_FILE}"
    chmod 600 "${WEBHOOK_SECRET_FILE}"
    log "已生成 webhook 密钥并写入 ${WEBHOOK_SECRET_FILE}，未打印其内容"
  fi
  WEBHOOK_SECRET="$(cat "${WEBHOOK_SECRET_FILE}")"
}

# ensure_project SLUG NAME KIND -> PROJECT_ID
ensure_project() {
  local slug="$1" name="$2" kind="$3" code
  code="$(api GET /v1/projects)"
  [ "${code}" = "200" ] || die "列项目失败：HTTP ${code} $(detail)"
  PROJECT_ID="$(jq -r --arg s "${slug}" '(.items[]? | select(.slug==$s) | .id) // empty' "${BODY}")"
  if [ -n "${PROJECT_ID}" ]; then
    log "  项目 ${slug} 已存在，复用 ${PROJECT_ID}"
    return 0
  fi
  jq -nc --arg s "${slug}" --arg n "${name}" --arg k "${kind}" --arg o "${ADMIN_USER_ID}" \
    '{slug:$s,name:$n,kind:$k,ownerUserId:$o,template:(if $k=="EventProducer" then "01a0bf5d-8f4b-7004-9cf7-0eb8bf66ffbc" else "01a0bf5d-8f4b-7003-9dbe-4adc78f388e9" end)}' > "${REQ}"
  code="$(api POST /v1/projects with-body)"
  [ "${code}" = "201" ] || die "建项目 ${slug} 失败：HTTP ${code} $(detail)"
  PROJECT_ID="$(jq -r '.id' "${BODY}")"
  log "  已建项目 ${slug}，kind=${kind}，负责人 ${ADMIN_USER_ID}，项目 ${PROJECT_ID}"
}

# wait_active PROJECT_ID -> SERVICE_ID；开通链是异步的：建命名空间 → 建仓 → 供数据 → 配路由 → 首个发布。
wait_active() {
  local project="$1" waited=0 state
  while :; do
    [ "$(api GET "/v1/projects/${project}")" = "200" ] || die "查项目 ${project} 失败：$(detail)"
    state="$(jq -r '.state' "${BODY}")"
    if [ "${state}" = "active" ]; then
      SERVICE_ID="$(jq -r '.serviceId // empty' "${BODY}")"
      [ -n "${SERVICE_ID}" ] || die "项目 ${project} 已 active 但没有 serviceId"
      log "  开通完成，服务 ${SERVICE_ID}"
      return 0
    fi
    if [ "${state}" = "failed" ]; then
      die "项目 ${project} 开通失败：$(jq -r '.message // "无说明"' "${BODY}")；修好后可 POST /v1/projects/${project}/provision 重试"
    fi
    [ "${waited}" -lt "${PROVISION_TIMEOUT}" ] \
      || die "等项目 ${project} 开通超时，已等 ${PROVISION_TIMEOUT} 秒，最后状态 ${state}"
    sleep 3
    waited=$((waited + 3))
  done
}

# set_config PROJECT_ID NAME 值所在的变量名 IS_SECRET —— 值经环境变量进 jq，不进命令行参数
set_config() {
  local project="$1" name="$2" value_var="$3" is_secret="$4" code kind='配置项'
  [ "${is_secret}" = "true" ] && kind='密钥'
  local definition item version method='POST' endpoint="/v1/projects/${project}/config/production"
  [ "$(api GET "/v1/projects/${project}/config-definitions")" = "200" ] || die "查询配置定义失败"
  definition="$(jq -r --arg n "${name}" '[.items[]? | select(.bindingName==$n)] | first | .id // empty' "${BODY}")"
  [ "$(api GET "${endpoint}")" = "200" ] || die "查询生产配置失败"
  item="$(jq -r --arg d "${definition}" '[.items[]? | select(.definitionId==$d)] | first | .id // empty' "${BODY}")"
  version="$(jq -r --arg i "${item}" '[.items[]? | select(.id==$i)] | first | .version // 0' "${BODY}")"
  if [ -n "${item}" ]; then method='PUT'; endpoint="${endpoint}/${item}"; fi
  CS_CONFIG_VALUE="${!value_var}" jq -nc --arg n "${name}" --arg d "${definition}" --argjson v "${version}" --argjson s "${is_secret}" \
    '{name:$n,bindingName:$n,env:"production",value:$ENV.CS_CONFIG_VALUE,isSecret:$s} + (if $d!="" then {definitionId:$d} else {} end) + (if $v>0 then {expectedVersion:$v} else {} end)' > "${REQ}"
  chmod 600 "${REQ}"
  code="$(api "${method}" "${endpoint}" with-body)"
  [ "${code}" = "200" ] || [ "${code}" = "201" ] || die "写生产配置 ${name} 失败：HTTP ${code} $(detail)"
  log "  生产 ${kind} ${name} 已写入，值未打印"
}

# 所有 git 调用都走这里：
# - 忽略本机的全局与系统 git 配置。开发机上常见针对该 GitLab 主机的 credential.<url>.username／helper，
#   会抢在我们的凭据之前作答，导致明明令牌有效也认证失败；
# - 凭据只从 0600 的 credential store 文件来，既不进命令行参数也不进远端 URL；
# - 关掉终端交互：认证不上就直接失败，不挂在那里等输入。
git_cs() {
  GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_TERMINAL_PROMPT=0 \
    git -c credential.helper="store --file=${CRED_FILE}" \
        -c user.name='CrewStation Bot' -c user.email='bot@crewstation.invalid' "$@"
}

# push_source SERVICE_ID SOURCE_DIR -> PUSHED_SHA
push_source() {
  local service="$1" src="$2" path branch remote work
  [ "$(api GET "/v1/services/${service}/repository")" = "200" ] || die "查仓库绑定失败：$(detail)"
  path="$(jq -r '.pathWithNamespace' "${BODY}")"
  branch="$(jq -r --arg d "${BRANCH}" '.defaultBranch // $d' "${BODY}")"
  # 平台记的 httpUrl 用的是集群内地址；本机 git 走 .local/gitlab.env 里的地址。
  remote="${GITLAB_URL}/${path}.git"
  work="${TMP}/$(printf '%s' "${path}" | tr '/' '-')"
  git_cs clone --quiet --branch "${branch}" "${remote}" "${work}" || die "克隆 ${remote} 失败"
  # 项目 Manifest 已绑定独立资源 UUID；旧源码通过显式升级接口生成当前格式。
  jq -n --rawfile content "${work}/crewstation.yaml" '{content:$content}' > "${REQ}"
  [ "$(api POST "/v1/services/${service}/manifest-upgrade" with-body)" = "200" ] || die "项目 Manifest 升级失败：$(detail)"
  jq -r '.content' "${BODY}" > "${TMP}/project-manifest.yaml"
  # 同步实现代码，保留此项目的资源绑定。
  find "${work}" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
  tar -C "${src}" --exclude=node_modules --exclude=.git -cf - . | tar -C "${work}" -xf -
  cp "${TMP}/project-manifest.yaml" "${work}/crewstation.yaml"
  git_cs -C "${work}" add -A
  if git_cs -C "${work}" diff --cached --quiet; then
    log "  源码与仓库一致，不产生新提交"
  else
    git_cs -C "${work}" commit -qm "chore: sync $(basename "${src}") from integrations/"
    git_cs -C "${work}" push -q origin "HEAD:refs/heads/${branch}" || die "推送 ${path} 的 ${branch} 失败"
    log "  已推送源码到 ${path} 的 ${branch}"
  fi
  PUSHED_SHA="$(git_cs -C "${work}" rev-parse HEAD)"
}

# release SERVICE_ID SHA：该提交已有未失败的发布就跳过，发布进行中（409）也算已处理。
release() {
  local service="$1" short="${2:0:7}" code
  RELEASE_ID=""
  code="$(api GET "/v1/services/${service}/releases")"
  if [ "${code}" = "200" ] && jq -e --arg s "${short}" \
      '.items[]? | select((.commitSha|startswith($s)) and .status!="failed")' "${BODY}" >/dev/null; then
    log "  提交 ${short} 已有发布 $(jq -r --arg s "${short}" \
      'first(.items[]? | select(.commitSha|startswith($s))) | "\(.tag) \(.status)"' "${BODY}")，跳过"
    return 0
  fi
  jq -nc --arg b "${BRANCH}" '{branch:$b,version:"patch",message:"bootstrap-integrations.sh"}' > "${REQ}"
  code="$(api POST "/v1/services/${service}/releases" with-body)"
  case "${code}" in
    202)
      RELEASE_ID="$(jq -r '.id' "${BODY}")"
      log "  已触发发布 $(jq -r '.tag' "${BODY}") 到待命槽，发布 ${RELEASE_ID}"
      ;;
    409) warn "  已有发布在进行中，本次跳过：$(detail)" ;;
    *)   die "触发发布失败：HTTP ${code} $(detail)" ;;
  esac
}

# wait_release RELEASE_ID：只等、只报告；构建慢不算脚本失败，构建失败才算。
wait_release() {
  local id="$1" waited=0 status
  [ -n "${id}" ] || return 0
  while :; do
    [ "$(api GET "/v1/releases/${id}")" = "200" ] || die "查发布 ${id} 失败：$(detail)"
    status="$(jq -r '.status' "${BODY}")"
    if [ "${status}" = "ready" ]; then
      log "  发布 $(jq -r '.tag' "${BODY}") 已就绪于 $(jq -r '.slot // "待命槽"' "${BODY}")"
      return 0
    fi
    if [ "${status}" = "failed" ]; then
      die "发布 ${id} 失败：$(jq -r '.message // "无说明"' "${BODY}")"
    fi
    if [ "${waited}" -ge "${RELEASE_TIMEOUT}" ]; then
      warn "  发布 ${id} 仍处于 ${status}，已等 ${RELEASE_TIMEOUT} 秒；工作台的发布页可继续看"
      return 0
    fi
    sleep 5
    waited=$((waited + 5))
  done
}

bootstrap_event_producer() {
  log "1/2 GitLab 事件生产者，kind: EventProducer"
  ensure_project gitlab-event-producer 'GitLab 事件生产者' EventProducer
  wait_active "${PROJECT_ID}"
  set_config "${PROJECT_ID}" GITLAB_WEBHOOK_SECRET_TOKEN WEBHOOK_SECRET true
  push_source "${SERVICE_ID}" "${ROOT}/integrations/gitlab-event-producer"
  release "${SERVICE_ID}" "${PUSHED_SHA}"
  wait_release "${RELEASE_ID}"
  PRODUCER_SERVICE="${SERVICE_ID}"
}

bootstrap_api_proxy() {
  log "2/2 参考 API 代理，kind: APIProxy"
  ensure_project reference-api-proxy '参考 API 代理' APIProxy
  wait_active "${PROJECT_ID}"
  set_config "${PROJECT_ID}" GITLAB_BASE_URL IN_CLUSTER_GITLAB false
  set_config "${PROJECT_ID}" GITLAB_TOKEN GITLAB_TOKEN true
  push_source "${SERVICE_ID}" "${ROOT}/integrations/reference-api-proxy"
  release "${SERVICE_ID}" "${PUSHED_SHA}"
  wait_release "${RELEASE_ID}"
  PROXY_SERVICE="${SERVICE_ID}"
}

# service_field SERVICE_ID 字段名 兜底值
service_field() {
  if [ "$(api GET "/v1/services/$1")" = "200" ]; then
    jq -r --arg f "$2" --arg d "$3" '.[$f] // $d' "${BODY}"
  else
    printf '%s' "$3"
  fi
}

print_next_steps() {
  local producer_host proxy_host
  producer_host="$(service_field "${PRODUCER_SERVICE}" serviceHost '<service>.<serviceDomain>')"
  proxy_host="$(service_field "${PROXY_SERVICE}" previewHost 'preview.reference-api-proxy.<userDomain>')"
  cat <<EOF

完成。两个接入容器都已构建到待命（preview）槽，等负责人切流后接生产流量。

接下来：
  1. 在本机测试 GitLab ${GITLAB_URL} 的项目或群组 Webhooks 页新建 webhook：
       URL          http://${producer_host}/hooks/gitlab
       Secret token 取自 ${WEBHOOK_SECRET_FILE}，本脚本不打印它
       事件         Push / Tag push / Merge request / Pipeline / Issues
  2. 工作台的事件页确认事件类型目录里出现 gitlab.*，发布登记后才有。
  3. 工作台的接口目录确认 test-gitlab 的 8 个操作已登记，并按需设定开放策略。
  4. 两个项目的负责人在工作台切流 preview → prod。参考代理的预览地址 http://${proxy_host}/
EOF
}

main() {
  need curl; need jq; need git; need tar; need openssl
  log "控制台 ${CONSOLE_URL}，管理员 ${ADMIN_USERNAME}"
  login
  ensure_service_plan
  read_gitlab_env
  ensure_webhook_secret
  bootstrap_event_producer
  bootstrap_api_proxy
  print_next_steps
}

main "$@"
