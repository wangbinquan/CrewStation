#!/usr/bin/env bash
# Points the kind node's containerd at the in-cluster registry without cluster DNS.
#
# The kubelet pulls images through containerd, which runs on the node and cannot resolve
# `registry.crewstation-system.svc.cluster.local`. containerd's per-registry configuration
# (`config_path = "/etc/containerd/certs.d"` in /etc/containerd/config.toml) lets us map that host
# to the registry Service's NodePort on the node's loopback (127.0.0.1:30500). containerd reads
# hosts.toml lazily on every pull, so no restart is needed; the probe at the end proves it and only
# restarts containerd if the file was ignored.
#
# Idempotent: rewrites the file only when its content differs. Usage: node-registry-hosts.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

HOSTS_DIR="/etc/containerd/certs.d/${REGISTRY_HOST}"
HOSTS_FILE="${HOSTS_DIR}/hosts.toml"
DESIRED="$(cat <<TOML
server = "${REGISTRY_NODEPORT_URL}"

[host."${REGISTRY_NODEPORT_URL}"]
  capabilities = ["pull", "resolve", "push"]
  skip_verify = true
TOML
)"

write_hosts_toml() {
  local current
  current="$(node_exec sh -c "cat '${HOSTS_FILE}' 2>/dev/null" || true)"
  if [ "${current}" = "${DESIRED}" ]; then
    echo "unchanged: ${HOSTS_FILE}"
  else
    printf '%s\n' "${DESIRED}" | docker exec -i "${NODE_CONTAINER}" sh -c "mkdir -p '${HOSTS_DIR}' && cat > '${HOSTS_FILE}'"
    echo "written: ${HOSTS_FILE}"
  fi
  echo "--- ${HOSTS_FILE}"
  node_exec cat "${HOSTS_FILE}"
}

# Pull a tag that does not exist. If containerd honours hosts.toml the error comes from
# 127.0.0.1:30500 ("not found"); if it fell back to DNS the error is a lookup failure.
probe_pull() {
  local ref="${REGISTRY_HOST}/crewstation/hosts-toml-probe:does-not-exist"
  local out
  out="$(node_exec crictl pull "${ref}" 2>&1 || true)"
  if printf '%s' "${out}" | grep -qiE 'no such host|lookup registry\.crewstation-system'; then
    warn "containerd ignored hosts.toml (tried DNS); restarting containerd on ${NODE_CONTAINER}"
    node_exec systemctl restart containerd
    sleep 3
    out="$(node_exec crictl pull "${ref}" 2>&1 || true)"
  fi
  echo "--- probe pull of a non-existent tag (expected: 'not found' answered by ${REGISTRY_NODEPORT_URL})"
  printf '%s\n' "${out}" | tail -n 1
  if printf '%s' "${out}" | grep -qi 'connection refused'; then
    warn "hosts.toml is honoured but ${REGISTRY_NODEPORT_URL} is not answering: is the registry Service up?"
    return 1
  fi
  if printf '%s' "${out}" | grep -qiE 'not found|notfound'; then
    echo "probe: containerd resolves ${REGISTRY_HOST} through ${REGISTRY_NODEPORT_URL} (no restart needed)"
    return 0
  fi
  warn "probe result unclear; see output above"
  return 1
}

main() {
  check_environment
  log "containerd hosts.toml for ${REGISTRY_HOST} on node ${NODE_CONTAINER}"
  write_hosts_toml
  probe_pull
}

main "$@"
