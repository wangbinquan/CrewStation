#!/usr/bin/env bash
# Idempotent bootstrap of the local CrewStation platform infrastructure on the docker-desktop kind
# cluster. Safe to re-run: every step is an apply, a create-if-absent, or a no-op when already done.
#
# Order
#   1. Network plugin: Calico instead of Docker Desktop's kindnet (deploy/local/calico-cni.sh)
#   2. Namespace crewstation-system
#   3. Secret postgres-credentials (random password, created only if absent, never printed)
#   4. Traefik CRDs (server-side apply) and wait until Established
#   5. PostgreSQL, registry, Traefik RBAC + Deployment + LoadBalancer Service, BuildKit
#   6. Wait for readiness and for the LoadBalancer address
#   7. CoreDNS rewrite  *.svc.cs.internal -> Traefik      (deploy/local/coredns-rewrite.sh)
#   8. containerd hosts.toml on the node for the registry (deploy/local/node-registry-hosts.sh)
#   9. Verifications A-E                                   (deploy/local/verify.sh) unless --skip-verify
#  10. Summary table with real outputs
#
# Usage: deploy/local/bootstrap.sh [--skip-verify]
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

SKIP_VERIFY=0
for arg in "$@"; do
  case "${arg}" in
    --skip-verify) SKIP_VERIFY=1 ;;
    *) die "unknown argument: ${arg}" ;;
  esac
done

LOCAL_DIR="${DEPLOY_DIR}/local"
SUMMARY=""
row() { SUMMARY="${SUMMARY}$1|$2|$3"$'\n'; } # component image detail

ensure_postgres_secret() {
  if kc -n "${SYSTEM_NS}" get secret postgres-credentials >/dev/null 2>&1; then
    echo "secret postgres-credentials exists: kept as is"
    return 0
  fi
  local pw
  pw="$(head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
  [ "${#pw}" -eq 32 ] || die "could not generate a password"
  kc -n "${SYSTEM_NS}" create secret generic postgres-credentials \
    --from-literal=username=crewstation \
    --from-literal=password="${pw}" \
    --from-literal=database=crewstation \
    --from-literal=host="postgres.${SYSTEM_NS}.svc.cluster.local" \
    --from-literal=port=5432 \
    --from-literal=url="postgresql://crewstation:${pw}@postgres.${SYSTEM_NS}.svc.cluster.local:5432/crewstation" \
    >/dev/null
  echo "secret postgres-credentials created with a random password (not printed; read it with kubectl when needed)"
}

apply_traefik_crds() {
  kc apply --server-side --force-conflicts -f "${SYSTEM_DIR}/30-traefik-crds.yaml"
  local crd
  for crd in $(grep -E '^  name: [a-z]+\.traefik\.io$' "${SYSTEM_DIR}/30-traefik-crds.yaml" | awk '{print $2}'); do
    kc wait --for=condition=Established "crd/${crd}" --timeout=60s >/dev/null
  done
  echo "traefik.io CRDs established: $(kc get crd -o name | grep -c 'traefik.io')"
}

traefik_has_lb() {
  [ -n "$(kc -n "${SYSTEM_NS}" get svc traefik -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null)" ]
}

collect_status() {
  local user pgver catalog tver lb hostcode workers marker hosts calico kindnet
  calico="$(kc -n kube-system get daemonset calico-node -o jsonpath='{.status.numberReady}/{.status.desiredNumberScheduled}' 2>/dev/null || true)"
  kindnet="$(kc -n kube-system get daemonset kindnet -o name 2>/dev/null || true)"
  row cni "$(kc -n kube-system get daemonset calico-node -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || echo calico)" "calico-node ready ${calico:-NONE}; pool $(kc get ippools.crd.projectcalico.org default-ipv4-ippool -o jsonpath='{.spec.cidr}' 2>/dev/null || echo NONE); kindnet: ${kindnet:-absent}"
  user="$(kc -n "${SYSTEM_NS}" get secret postgres-credentials -o jsonpath='{.data.username}' | base64 -d)"
  pgver="$(kc -n "${SYSTEM_NS}" exec statefulset/postgres -c postgres -- psql -U "${user}" -d crewstation -Atc 'select version()' 2>/dev/null | cut -d, -f1 || true)"
  row postgres docker.io/library/postgres:17.11 "${pgver:-NOT REACHABLE}; Service postgres:5432, db/user crewstation, PVC data-postgres-0 10Gi"
  catalog="$(kc -n "${SYSTEM_NS}" exec deploy/registry -- wget -qO- http://127.0.0.1:5000/v2/_catalog 2>/dev/null || true)"
  row registry docker.io/library/registry:3.1.1 "GET /v2/_catalog -> ${catalog:-NOT REACHABLE}; ClusterIP :5000 + NodePort 30500"
  tver="$(kc -n "${SYSTEM_NS}" exec deploy/traefik -- traefik version 2>/dev/null | head -n 1 || true)"
  lb="$(kc -n "${SYSTEM_NS}" get svc traefik -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  hostcode="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${TRAEFIK_HOST_URL}/" 2>/dev/null || echo 000)"
  row traefik docker.io/library/traefik:v3.7.13 "${tver:-NOT REACHABLE}; LoadBalancer ingress ${lb:-none}; ${TRAEFIK_HOST_URL}/ -> HTTP ${hostcode} (404 = Traefik answered, no route for /)"
  workers="$(kc -n "${SYSTEM_NS}" exec deploy/buildkitd -- buildctl debug workers 2>/dev/null | awk 'NR==2 {print $1" "$2}' || true)"
  row buildkitd docker.io/moby/buildkit:v0.33.0-rootless "worker: ${workers:-NOT REACHABLE}; Service buildkitd:1234; registry ${REGISTRY_HOST} declared http+insecure"
  marker="$(kc -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -c 'svc\\.cs\\.internal' || true)"
  row coredns "(cluster CoreDNS, kube-system)" "rewrite *.svc.cs.internal -> ${TRAEFIK_INTERNAL_FQDN}: $([ "${marker:-0}" -gt 0 ] && echo present || echo MISSING)"
  hosts="$(node_exec sh -c "test -f '/etc/containerd/certs.d/${REGISTRY_HOST}/hosts.toml' && grep -c 30500 '/etc/containerd/certs.d/${REGISTRY_HOST}/hosts.toml'" 2>/dev/null || echo 0)"
  row "node containerd" "(${NODE_CONTAINER})" "certs.d/${REGISTRY_HOST}/hosts.toml -> ${REGISTRY_NODEPORT_URL}: $([ "${hosts}" -gt 0 ] && echo present || echo MISSING)"
}

print_summary() {
  echo
  echo "================================================================================"
  echo "crewstation local infrastructure: summary (context ${KUBE_CONTEXT}, node ${NODE_CONTAINER})"
  echo "================================================================================"
  printf '%-16s %-42s %s\n' COMPONENT IMAGE STATUS
  printf '%s' "${SUMMARY}" | while IFS='|' read -r c i d; do
    [ -n "${c}" ] && printf '%-16s %-42s %s\n' "${c}" "${i}" "${d}"
  done
  if [ -n "${VERIFY_RESULTS_FILE:-}" ] && [ -s "${VERIFY_RESULTS_FILE}" ]; then
    echo
    printf '%-3s %-8s %s\n' ID STATUS "VERIFICATION (deploy/local/verify.sh)"
    while IFS='|' read -r id st det; do
      [ -n "${id}" ] && printf '%-3s %-8s %s\n' "${id}" "${st}" "${det}"
    done < "${VERIFY_RESULTS_FILE}"
  fi
  echo
  echo "host access: ${TRAEFIK_HOST_URL}/  (any *.cs.localhost host name reaches Traefik from this machine)"
  echo "in-cluster : http://<name>.svc.cs.internal/ reaches Traefik; images: ${REGISTRY_HOST}/<repo>:<tag>"
}

main() {
  check_environment
  log "cluster"
  kc get nodes -o wide

  log "1/9 network plugin (Calico)"
  "${LOCAL_DIR}/calico-cni.sh"

  log "2/9 namespace"
  kc apply -f "${SYSTEM_DIR}/00-namespace.yaml"

  log "3/9 postgres credentials"
  ensure_postgres_secret

  log "4/9 Traefik CRDs (server-side apply)"
  apply_traefik_crds

  log "5/9 components"
  kc apply \
    -f "${SYSTEM_DIR}/10-postgres.yaml" \
    -f "${SYSTEM_DIR}/20-registry.yaml" \
    -f "${SYSTEM_DIR}/31-traefik-rbac.yaml" \
    -f "${SYSTEM_DIR}/32-traefik.yaml" \
    -f "${SYSTEM_DIR}/40-buildkitd.yaml"

  log "6/9 waiting for readiness"
  kc -n "${SYSTEM_NS}" rollout status statefulset/postgres --timeout=300s
  kc -n "${SYSTEM_NS}" rollout status deployment/registry --timeout=300s
  kc -n "${SYSTEM_NS}" rollout status deployment/traefik --timeout=300s
  kc -n "${SYSTEM_NS}" rollout status deployment/buildkitd --timeout=300s
  wait_until 120 "traefik LoadBalancer address" traefik_has_lb \
    || warn "traefik Service has no LoadBalancer address after 120s (is the kind-cloud-provider container running?)"
  kc -n "${SYSTEM_NS}" get pods,svc,pvc

  log "7/9 CoreDNS rewrite"
  "${LOCAL_DIR}/coredns-rewrite.sh"

  log "8/9 node containerd hosts.toml"
  "${LOCAL_DIR}/node-registry-hosts.sh"

  if [ "${SKIP_VERIFY}" = "1" ]; then
    log "9/9 verification skipped (--skip-verify)"
  else
    log "9/9 verification"
    VERIFY_RESULTS_FILE="$(mktemp)"
    export VERIFY_RESULTS_FILE
    "${LOCAL_DIR}/verify.sh" || warn "one or more verifications failed; see the summary"
  fi

  collect_status
  print_summary
}

main
