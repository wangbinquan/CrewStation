#!/usr/bin/env bash
# 本机集群的网络插件换成 Calico。幂等，可重跑；bootstrap.sh 的第一步调用它。
#
# 为什么：Docker Desktop 建集群时自带 kindnet，kindnet 用 NFQUEUE 在用户态逐包执行 NetworkPolicy。
# 本机上它给连接打「已放行」标签不生效，任务 Pod 的每个包都要进队列；每次规则同步又会丢掉队列里的包
# （kube-network-policies#402）。结果是 Runner 每十几分钟集体 90 秒收不到帧，随后几分钟连不上 cs-session
# （2026-09-23 实查，见 docs/engineering/dev-gotchas.md「本机集群的网络插件是 Calico」）。
#
# 步骤
#   1. 安装或更新 Calico：清单的版本与校验和钉死在 calico-manifest.ts，另有三处本机定制；等就绪
#   2. 删掉 kindnet 的 DaemonSet 与授权；清掉节点上它的 CNI 配置与 nftables 表
#   3. 重建仍在旧网段（节点 podCIDR，kindnet 分配）的 kube-system 与 local-path-storage 的 Pod
#   4. 旧网段上再没有别的 Pod 时，删掉 kindnet 的出站地址转换链；还有的话列出来，重建它们之后重跑本脚本
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

# 仍在旧网段上的非 hostNetwork Pod，输出「命名空间 名字」；可按命名空间过滤（整名相等）。
# 正在终止的不算：recreate_system_pods 刚删掉的 Pod 还挂着旧地址，但替身已经在新网段上了；
# 算上它们的话，第一次跑总会停在「还有旧网段的 Pod」，地址转换链要等重跑才删。
old_pods() {
  local prefix="$1"; shift
  kc get pods -A -o json | jq -r --arg p "${prefix}" --arg only "$*" '
    .items[]
    | select(.metadata.deletionTimestamp == null)
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

recreate_system_pods() {
  local prefix="$1" rows
  rows="$(old_pods "${prefix}" kube-system local-path-storage)"
  if [ -z "${rows}" ]; then echo "kube-system / local-path-storage: nothing left on the old range"; return 0; fi
  printf '%s\n' "${rows}" | while read -r ns name; do kc -n "${ns}" delete pod "${name}" --wait=false; done
  kc -n kube-system rollout status deployment/coredns --timeout=180s
  kc -n kube-system rollout status deployment/calico-kube-controllers --timeout=180s
  kc -n local-path-storage rollout status deployment/local-path-provisioner --timeout=180s
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
  require_tool bun
  TMP="$(mktemp -d)"
  trap 'rm -rf "${TMP}"' EXIT
  log "calico: install or update"
  install_calico
  log "kindnet: remove"
  remove_kindnet
  local prefix
  if prefix="$(old_prefix)"; then
    log "pods on the old range (${prefix}0/24): kube-system and local-path-storage"
    recreate_system_pods "${prefix}"
    log "kindnet masquerade chain"
    drop_kind_masquerade "${prefix}"
  fi
}

main
