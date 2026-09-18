#!/usr/bin/env bash
# 把任务容器镜像作为「平台底座」推进集群内镜像仓库（RFC-006 §7.1）：crewstation/task-runtime:<标签>。
# 管理员据此 FROM 构建自己的档位镜像；档位保存时按仓库清单摘要固定。幂等：同一内容重复推送不产生新摘要。
# 做法：镜像已由 install-platform.sh 导入节点 containerd，这里在节点上打标签并经 NodePort 推到仓库（纯 HTTP，仅本机）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
source "$ROOT/deploy/local/lib.sh"
TAG="${CS_BASE_IMAGE_TAG:-dev}"
SOURCE="docker.io/library/cs-task-runtime:dev"
TARGET="127.0.0.1:30500/crewstation/task-runtime:${TAG}"

node_exec ctr -n k8s.io images inspect "${SOURCE}" >/dev/null 2>&1 \
  || die "节点 containerd 里没有 ${SOURCE}：先跑 install-platform.sh（不要带 CS_SKIP_TASK_RUNTIME=1）"
node_exec ctr -n k8s.io images tag --force "${SOURCE}" "${TARGET}" >/dev/null
node_exec ctr -n k8s.io images push --plain-http "${TARGET}" >/dev/null
# 摘要经节点回环地址向仓库查清单取得（仓库的 NodePort 只在节点上可达）。
DIGEST="$(node_exec curl -fsS -I \
  -H 'Accept: application/vnd.oci.image.index.v1+json' -H 'Accept: application/vnd.oci.image.manifest.v1+json' -H 'Accept: application/vnd.docker.distribution.manifest.v2+json' \
  "http://127.0.0.1:30500/v2/crewstation/task-runtime/manifests/${TAG}" 2>/dev/null | tr -d '\r' | awk -F': ' 'tolower($1)=="docker-content-digest"{print $2}' || true)"
log "平台底座已推送：${REGISTRY_HOST}/crewstation/task-runtime:${TAG}${DIGEST:+ @ ${DIGEST}}"
