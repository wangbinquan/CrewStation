#!/usr/bin/env bash
# Shared helpers for the deploy/local scripts. Source it; do not execute it.
# Targets only the docker-desktop kind cluster (context `docker-desktop`, node container
# `desktop-control-plane`); check_environment refuses anything else. Works with macOS bash 3.2.
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYSTEM_DIR="${DEPLOY_DIR}/k8s/system"
VERIFY_DIR="${DEPLOY_DIR}/k8s/verify"

KUBE_CONTEXT="${CREWSTATION_KUBE_CONTEXT:-docker-desktop}"
NODE_CONTAINER="${CREWSTATION_NODE_CONTAINER:-desktop-control-plane}"
SYSTEM_NS="crewstation-system"
VERIFY_NS="crewstation-verify"
REGISTRY_HOST="registry.crewstation-system.svc.cluster.local:5000"
REGISTRY_NODEPORT_URL="http://127.0.0.1:30500"
TRAEFIK_INTERNAL_FQDN="traefik.${SYSTEM_NS}.svc.cluster.local"
# Host-side entry to Traefik: Docker Desktop's cloud-provider-kind publishes the LoadBalancer
# ports on localhost.
TRAEFIK_HOST_URL="${CREWSTATION_TRAEFIK_HOST_URL:-http://localhost}"

kc() { kubectl --context "${KUBE_CONTEXT}" "$@"; }
node_exec() { docker exec "${NODE_CONTAINER}" "$@"; }
log() { printf '\n==> %s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
require_tool() { command -v "$1" >/dev/null 2>&1 || die "required tool not found: $1"; }

check_environment() {
  require_tool kubectl
  require_tool docker
  require_tool jq
  require_tool curl
  kubectl config get-contexts -o name | grep -qx "${KUBE_CONTEXT}" \
    || die "kubectl context '${KUBE_CONTEXT}' not found"
  docker inspect "${NODE_CONTAINER}" >/dev/null 2>&1 \
    || die "docker container '${NODE_CONTAINER}' is not running"
  kc get nodes -o name 2>/dev/null | grep -qx "node/${NODE_CONTAINER}" \
    || die "context '${KUBE_CONTEXT}' does not contain node '${NODE_CONTAINER}'; refusing to touch another cluster"
}

# Poll until `command` succeeds or the timeout (seconds) expires.
wait_until() {
  local timeout="$1" what="$2"; shift 2
  local i=0
  until "$@"; do
    i=$((i + 2))
    [ "$i" -ge "$timeout" ] && return 1
    sleep 2
  done
  return 0
}
