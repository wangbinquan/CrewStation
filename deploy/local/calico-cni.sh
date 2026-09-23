#!/usr/bin/env bash
# 本机集群的网络插件换成 Calico。幂等，可重跑；bootstrap.sh 的第一步调用它，install-platform.sh 先用 --check 判断要不要调它。
#
# 用法：calico-cni.sh            迁移（已经迁完时各步都是空操作）
#       calico-cni.sh --check    只检查、不改：0 已是 Calico 且旧网段上没有 Pod；10 需要迁移（原因打在标准输出）；其他为出错
#
# 为什么：Docker Desktop 建集群时自带 kindnet，kindnet 用 NFQUEUE 在用户态逐包执行 NetworkPolicy。
# 本机上它给连接打「已放行」标签不生效，任务 Pod 的每个包都要进队列；每次规则同步又会丢掉队列里的包
# （kube-network-policies#402）。结果是 Runner 每十几分钟集体 90 秒收不到帧，随后几分钟连不上 cs-session
# （2026-09-23 实查，见 docs/engineering/dev-gotchas.md「本机集群的网络插件是 Calico」）。
#
# 步骤
#   1. 安装或更新 Calico：清单的版本与校验和钉死在 calico-manifest.ts，另有三处本机定制；等就绪
#   2. 删掉 kindnet 的 DaemonSet 与授权；清掉节点上它的 CNI 配置与 nftables 表
#   3. 重建仍在旧网段（节点 podCIDR，kindnet 分配）上的全部 Pod（rebuild-old-range-pods.ts）：
#      有控制器的按依赖分四批删掉重建；任务 Pod 以管理员身份走集群管理的运维操作，开发会话按「管理员重启工作区」
#      换新容器、保留工作卷，会话里的 CLI 要重开
#   4. 旧网段上再没有 Pod 时，删掉 kindnet 的出站地址转换链；还有的话列出来，处理掉之后重跑本脚本
#
# Docker Desktop 重置 Kubernetes 集群后 kindnet 会回来，重跑 bootstrap.sh（或本脚本）即可。
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
ROOT="$(cd "${DEPLOY_DIR}/.." && pwd)"

# 旧网段：kindnet 的 host-local 从节点 podCIDR 分配。只处理 kind 默认的 /24。
old_prefix() {
  local cidr
  cidr="$(kc get node "${NODE_CONTAINER}" -o jsonpath='{.spec.podCIDR}')"
  case "${cidr}" in
    *.0/24) printf '%s.' "${cidr%.0/24}" ;;
    *) warn "node podCIDR ${cidr:-<none>} is not a /24; skipping old-range detection"; return 1 ;;
  esac
}

# 仍在旧网段上、还在用网络的非 hostNetwork Pod，输出「命名空间 名字」；可按命名空间过滤（整名相等）。
# 正在终止的不算：刚删掉的 Pod 还挂着旧地址，但替身已经在新网段上了；算上它们的话，第一次跑总会停在
# 「还有旧网段的 Pod」。已经结束的也不算：Completed 的 Job Pod 状态里可能还留着地址，却不再用网络。
# 与 rebuild-old-range-pods.ts 的 oldRangePods 同一套判定。
old_pods() {
  local prefix="$1"; shift
  kc get pods -A -o json | jq -r --arg p "${prefix}" --arg only "$*" '
    .items[]
    | select(.metadata.deletionTimestamp == null)
    | select((.status.phase // "") | IN("Running", "Pending"))
    | select((.spec.hostNetwork // false) | not)
    | select((.status.podIP // "") | startswith($p))
    | select($only == "" or (.metadata.namespace | IN($only | split(" ")[])))
    | "\(.metadata.namespace) \(.metadata.name)"'
}

install_calico() {
  local manifest="${TMP}/calico.yaml"
  bun "${ROOT}/deploy/local/calico-manifest.ts" > "${manifest}"
  kc apply --server-side --force-conflicts -f "${manifest}" >/dev/null
  kc -n kube-system rollout status daemonset/calico-node --timeout=300s
  kc -n kube-system rollout status deployment/calico-kube-controllers --timeout=300s
  echo "calico: $(kc -n kube-system get daemonset calico-node -o jsonpath='{.spec.template.spec.containers[0].image}'), pool $(kc get ippools.crd.projectcalico.org default-ipv4-ippool -o jsonpath='{.spec.cidr}')"
}

remove_kindnet() {
  if kc -n kube-system get daemonset kindnet >/dev/null 2>&1; then
    kc -n kube-system delete daemonset kindnet --wait=true --timeout=120s
    kc -n kube-system delete serviceaccount kindnet --ignore-not-found
    kc delete clusterrolebinding kindnet --ignore-not-found
    kc delete clusterrole kindnet --ignore-not-found
  else
    echo "kindnet DaemonSet: absent"
  fi
  # DaemonSet 删了以后，它在节点上留下的 CNI 配置与策略表还在；排队规则带 bypass，没人监听时放行，但留着就是隐患。
  node_exec sh -c 'rm -f /etc/cni/net.d/10-kindnet.conflist; if nft list table inet kindnet-network-policies >/dev/null 2>&1; then nft delete table inet kindnet-network-policies; fi'
  echo "node CNI configs: $(node_exec ls /etc/cni/net.d | tr '\n' ' ')"
}

# 退出码 2 表示还有留下的 Pod：不算失败，drop_kind_masquerade 会列出来并保留地址转换链。
rebuild_old_range_pods() {
  local prefix="$1" status=0
  bun "${ROOT}/deploy/local/rebuild-old-range-pods.ts" --prefix "${prefix}" --context "${KUBE_CONTEXT}" || status=$?
  if [ "${status}" -ne 0 ] && [ "${status}" -ne 2 ]; then return "${status}"; fi
}

# 只读：kindnet 还在、calico-node 没全部就绪，或旧网段上还有 Pod，都算要迁移。原因写成一行。
check_only() {
  local reasons="" ready prefix rows
  if kc -n kube-system get daemonset kindnet >/dev/null 2>&1; then reasons="${reasons} kindnet DaemonSet 还在；"; fi
  ready="$(kc -n kube-system get daemonset calico-node -o jsonpath='{.status.numberReady}/{.status.desiredNumberScheduled}' 2>/dev/null || true)"
  if [ -z "${ready}" ] || [ "${ready%%/*}" = "0" ] || [ "${ready%%/*}" != "${ready##*/}" ]; then reasons="${reasons} calico-node 没有全部就绪（${ready:-不存在}）；"; fi
  if prefix="$(old_prefix)"; then
    rows="$(old_pods "${prefix}")"
    if [ -n "${rows}" ]; then reasons="${reasons} $(printf '%s\n' "${rows}" | wc -l | tr -d ' ') 个 Pod 还用着旧地址（${prefix}0/24）；"; fi
  fi
  if [ -z "${reasons}" ]; then echo "network plugin: Calico; nothing on the old range"; return 0; fi
  echo "network plugin needs migration:${reasons}"
  return 10
}

drop_kind_masquerade() {
  local prefix="$1" rows
  rows="$(old_pods "${prefix}")"
  if [ -n "${rows}" ]; then
    warn "these pods still use kindnet addresses and its masquerade rule; recreate them, then re-run this script:"
    printf '%s\n' "${rows}" | sed 's/^/    /' >&2
    return 0
  fi
  node_exec sh -c 'iptables-save -t nat | grep -e "^-A POSTROUTING .*-j KIND-MASQ-AGENT" | sed "s/^-A /-D /" | while read -r rule; do eval "iptables -t nat ${rule}"; done
    if iptables -t nat -S KIND-MASQ-AGENT >/dev/null 2>&1; then iptables -t nat -F KIND-MASQ-AGENT; iptables -t nat -X KIND-MASQ-AGENT; fi'
  echo "kindnet masquerade chain: removed (egress from the Calico pool is masqueraded by Calico natOutgoing)"
}

main() {
  check_environment
  if [ "${1:-}" = "--check" ]; then
    local status=0
    check_only || status=$?
    return "${status}"
  fi
  require_tool bun
  TMP="$(mktemp -d)"
  trap 'rm -rf "${TMP}"' EXIT
  log "calico: install or update"
  install_calico
  log "kindnet: remove"
  remove_kindnet
  local prefix
  if prefix="$(old_prefix)"; then
    log "pods on the old range (${prefix}0/24): rebuild them all"
    rebuild_old_range_pods "${prefix}"
    log "kindnet masquerade chain"
    drop_kind_masquerade "${prefix}"
  fi
}

main "$@"
