#!/usr/bin/env bash
# Adds the service-domain DNS convention to the cluster's CoreDNS, idempotently:
#   any `<name>.svc.cs.internal` resolves inside the cluster to Traefik's ClusterIP Service,
#   so pods can call other digital workers / platform APIs by host name through the gateway.
#
# Mechanism: read the kube-system `coredns` ConfigMap, insert a `rewrite` block into the `.:53`
# server block (once; a marker comment makes it idempotent), apply, then restart CoreDNS so the
# change is live immediately instead of waiting for the `reload` plugin.
#
#   rewrite stop {
#     name regex (.*)\.svc\.cs\.internal traefik.crewstation-system.svc.cluster.local
#     answer auto
#   }
#
# `answer auto` rewrites the answer names back to the queried name (CoreDNS >= 1.9; the cluster
# runs 1.14.2), so strict resolvers accept the response.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

MARKER="# crewstation: *.svc.cs.internal -> Traefik (deploy/local/coredns-rewrite.sh)"

write_block() { # $1 = file to write the Corefile snippet into (indented for the .:53 block)
  cat > "$1" <<CORE
        ${MARKER}
        rewrite stop {
            name regex (.*)\\.svc\\.cs\\.internal ${TRAEFIK_INTERNAL_FQDN}
            answer auto
        }
CORE
}

main() {
  check_environment
  log "CoreDNS rewrite: *.svc.cs.internal -> ${TRAEFIK_INTERNAL_FQDN}"
  local tmp
  tmp="$(mktemp -d)"
  kc -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' > "${tmp}/Corefile"

  if grep -qF "${MARKER}" "${tmp}/Corefile"; then
    echo "unchanged: rewrite already present"
    grep -n -A3 'rewrite stop' "${tmp}/Corefile"
    rm -rf "${tmp}"
    return 0
  fi

  grep -qE '^\.:53 \{' "${tmp}/Corefile" || die "Corefile has no '.:53 {' server block; refusing to edit"
  write_block "${tmp}/block"
  # sed's `r` appends the file after the first (and only) matching line; BSD and GNU sed agree on it.
  sed "/^\.:53 {/r ${tmp}/block" "${tmp}/Corefile" > "${tmp}/Corefile.new"
  grep -qF "${MARKER}" "${tmp}/Corefile.new" || die "failed to insert the rewrite block"

  kc -n kube-system create configmap coredns --from-file=Corefile="${tmp}/Corefile.new" \
    --dry-run=client -o yaml | kc apply -f -
  kc -n kube-system rollout restart deployment/coredns
  kc -n kube-system rollout status deployment/coredns --timeout=120s
  echo "applied: rewrite inserted into the .:53 block"
  grep -n -A3 'rewrite stop' "${tmp}/Corefile.new"
  rm -rf "${tmp}"
}

main "$@"
