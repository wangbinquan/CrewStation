#!/usr/bin/env bash
# 本机脚本取管理员凭据的唯一实现：演示登录随 RFC-005 删除后，登录一律是用户名＋密码。
# 顺序：环境变量 → 显式无人值守安装写出的 .local/admin.env。取不到就让调用方明确失败，
# 不要拿空口令去试——那会把「没配凭据」表现成「口令不对」。
# 用法：source 本文件后调用 resolve_admin_credentials，它设置 ADMIN_USERNAME 与 ADMIN_PASSWORD。
resolve_admin_credentials() {
  local root="$1" env_file="$1/.local/admin.env"
  ADMIN_USERNAME="${CS_ADMIN_USERNAME:-}"
  ADMIN_PASSWORD="${CS_ADMIN_PASSWORD:-}"
  if [ -f "${env_file}" ]; then
    [ -n "${ADMIN_USERNAME}" ] || ADMIN_USERNAME="$(sed -n 's/^CS_BOOTSTRAP_ADMIN_USERNAME=//p' "${env_file}" | head -n 1)"
    [ -n "${ADMIN_PASSWORD}" ] || ADMIN_PASSWORD="$(sed -n 's/^CS_BOOTSTRAP_ADMIN_PASSWORD=//p' "${env_file}" | head -n 1)"
  fi
  [ -n "${ADMIN_USERNAME}" ] || ADMIN_USERNAME='platform-admin'
  if [ -z "${ADMIN_PASSWORD}" ]; then
    printf 'ERROR: 请先在浏览器创建管理员，再设置 CS_ADMIN_USERNAME 与 CS_ADMIN_PASSWORD；显式无人值守安装也可从 %s 读取。\n' "${env_file}" >&2
    return 1
  fi
}

# 用管理员口令登录并把会话 Cookie 写进 jar；响应体落在第三个参数指向的文件。
admin_login_request() {
  local console_url="$1" cookie_jar="$2" body="$3"
  curl -sS --max-time 30 -c "${cookie_jar}" -o "${body}" -w '%{http_code}' \
    -H 'accept: application/json' -X POST "${console_url}/auth/login" \
    --data-urlencode "username=${ADMIN_USERNAME}" --data-urlencode "password=${ADMIN_PASSWORD}" || printf '000'
}
