#!/usr/bin/env bash
# source 后调用 prepare_initial_admin ROOT NAMESPACE CONSOLE_URL。
# 默认交给浏览器；只有 CS_BOOTSTRAP_ADMIN=1 才用于 CI／显式无人值守播种。
prepare_initial_admin() {
  local root="$1" namespace="$2" console_url="$3" mode token encoded_token auth_pod
  ADMIN_SETUP_PENDING=0
  mode="$(curl -fsS --max-time 30 "${console_url}/auth/status" | jq -er '.mode | select(. == "bootstrap" or . == "ready")')" || {
    printf 'ERROR: 无法读取初始化状态，请检查 cs-auth 与网关；未尝试创建管理员。\n' >&2
    return 1
  }
  if [[ "$mode" == "ready" ]]; then
    log "管理员已创建，保留现有账号。登录：${console_url}/auth/login"
    return 0
  fi
  if [[ "${CS_BOOTSTRAP_ADMIN:-}" != "1" ]]; then
    ADMIN_SETUP_PENDING=1
    token="$(kubectl -n "$namespace" get secret crewstation-secrets -o jsonpath='{.data.CS_BOOTSTRAP_TOKEN}' | base64 -d)"
    [[ -n "$token" ]] || { printf 'ERROR: 安装引导令牌缺失。\n' >&2; return 1; }
    encoded_token="$(jq -rn --arg token "$token" '$token | @uri')"
    log "首次使用请创建管理员账号（没有默认用户名或初始密码）："
    printf '%s/auth/bootstrap#token=%s\n' "$console_url" "$encoded_token"
    log "创建后用自选账号密码登录；初始化链接仅在创建首位管理员前有效。"
    return 0
  fi
  local username="${CS_BOOTSTRAP_ADMIN_USERNAME:-platform-admin}"
  local email="${CS_BOOTSTRAP_ADMIN_EMAIL:-admin@demo.invalid}"
  local password="${CS_BOOTSTRAP_ADMIN_PASSWORD:-}"
  [[ -n "$password" ]] || password="$(openssl rand -hex 24)"
  auth_pod="$(kubectl -n "$namespace" get pod -l app.kubernetes.io/name=cs-auth -o jsonpath='{.items[0].metadata.name}')"
  # 不吞失败：数据库、输入或竞争错误都不能当作「已存在」。
  kubectl -n "$namespace" exec "$auth_pod" -- bun apps/cs-auth/src/main.ts bootstrap-admin \
    --username "$username" --display-name "平台管理员" --email "$email" --password "$password" || return 1
  (umask 077; mkdir -p "$root/.local"; printf 'CS_BOOTSTRAP_ADMIN_USERNAME=%s\nCS_BOOTSTRAP_ADMIN_PASSWORD=%s\n' "$username" "$password" > "$root/.local/admin.env")
  chmod 600 "$root/.local/admin.env"
  log "按 CS_BOOTSTRAP_ADMIN=1 创建管理员 ${username}（凭据写入 .local/admin.env），引导令牌已退役"
}
