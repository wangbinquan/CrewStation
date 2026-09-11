#!/usr/bin/env bash
# Re-runnable verification of the local platform infrastructure. Prints real outputs only.
#   A. registry chain     buildkitd build+push -> in-cluster registry -> kubelet pull through hosts.toml
#   B. Traefik user path  host curl -> localhost:80 (LoadBalancer) -> Traefik -> Host whoami.cs.localhost
#   C. source IP (Q21)    pod curl -> whoami.svc.cs.internal (CoreDNS rewrite) -> Traefik -> whoami
#   D. ForwardAuth        Middleware to a 200 stand-in passes the request; to a 401 stand-in blocks it
# Uses deploy/k8s/verify/*.yaml in namespace crewstation-verify, deleted at the end (--keep keeps it).
# When VERIFY_RESULTS_FILE is set, one `id|status|detail` line per check is appended to that file
# (bootstrap.sh uses it for the final summary). Exit code 1 if any check FAILs.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

KEEP=0
for arg in "$@"; do
  case "${arg}" in
    --keep) KEEP=1 ;;
    *) die "unknown argument: ${arg}" ;;
  esac
done

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
RESULTS=""

record() { # id status detail
  RESULTS="${RESULTS}$1|$2|$3"$'\n'
  if [ -n "${VERIFY_RESULTS_FILE:-}" ]; then
    printf '%s|%s|%s\n' "$1" "$2" "$3" >> "${VERIFY_RESULTS_FILE}"
  fi
}

setup() {
  log "verify: applying ${VERIFY_DIR} into namespace ${VERIFY_NS}"
  kc apply -f "${VERIFY_DIR}/00-namespace.yaml"
  kc apply -f "${VERIFY_DIR}/10-whoami.yaml" -f "${VERIFY_DIR}/20-forwardauth.yaml"
  local d
  for d in whoami auth-ok auth-deny; do
    kc -n "${VERIFY_NS}" rollout status "deployment/${d}" --timeout=180s
  done
}

verify_a() {
  log "A. registry chain: buildkitd build+push -> ${REGISTRY_HOST} -> kubelet pull through containerd hosts.toml"
  local ref="${REGISTRY_HOST}/verify/hello:1"
  local pod
  pod="$(kc -n "${SYSTEM_NS}" get pod -l app.kubernetes.io/name=buildkitd -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [ -z "${pod}" ]; then
    record A FAIL "no buildkitd pod found"
    return 0
  fi
  echo "--- buildctl build + push inside pod ${pod}"
  if ! kc -n "${SYSTEM_NS}" exec "${pod}" -- env "REF=${ref}" sh -c '
      d=$(mktemp -d)
      printf "FROM docker.io/library/busybox:1.38.0\nCMD [\"sh\", \"-c\", \"echo hello from crewstation verify; sleep 3600\"]\n" > "$d/Dockerfile"
      echo "Dockerfile:"; cat "$d/Dockerfile"
      if buildctl build --frontend dockerfile.v0 --local context="$d" --local dockerfile="$d" \
           --output type=image,name="$REF",push=true,registry.insecure=true > "$d/build.log" 2>&1; then rc=0; else rc=$?; fi
      tail -n 12 "$d/build.log"
      rm -rf "$d"
      exit $rc'; then
    record A FAIL "buildctl build/push to ${REGISTRY_HOST} failed (see output above)"
    return 0
  fi
  echo "--- registry answer for GET /v2/verify/hello/tags/list (from the registry pod)"
  kc -n "${SYSTEM_NS}" exec deploy/registry -- wget -qO- http://127.0.0.1:5000/v2/verify/hello/tags/list 2>&1 || true
  echo
  echo "--- kubelet pull: pod verify-hello from ${ref} with imagePullPolicy=Always"
  kc -n "${VERIFY_NS}" delete pod verify-hello --ignore-not-found --wait=true >/dev/null
  kc -n "${VERIFY_NS}" run verify-hello --image="${ref}" --image-pull-policy=Always --restart=Never >/dev/null
  if kc -n "${VERIFY_NS}" wait --for=condition=Ready pod/verify-hello --timeout=120s >/dev/null; then
    kc -n "${VERIFY_NS}" get pod verify-hello -o wide
    kc -n "${VERIFY_NS}" get events --field-selector involvedObject.name=verify-hello \
      -o custom-columns=REASON:.reason,MESSAGE:.message --no-headers 2>/dev/null | grep -E 'Pull|Started' || true
    record A PASS "verify-hello Running; image pulled from ${REGISTRY_HOST} via hosts.toml -> ${REGISTRY_NODEPORT_URL}"
  else
    kc -n "${VERIFY_NS}" describe pod verify-hello | tail -n 15
    record A FAIL "pod verify-hello did not become Ready (see events above)"
  fi
  kc -n "${VERIFY_NS}" delete pod verify-hello --ignore-not-found --wait=false >/dev/null
}

verify_b() {
  log "B. Traefik user-domain path: host -> ${TRAEFIK_HOST_URL} -> Traefik -> Host(whoami.cs.localhost)"
  local lb body body2
  lb="$(kc -n "${SYSTEM_NS}" get svc traefik -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  echo "traefik Service LoadBalancer ingress: ${lb:-<none>} (Docker Desktop publishes its ports on the host as localhost:80/443)"
  echo "--- curl -s -H 'Host: whoami.cs.localhost' ${TRAEFIK_HOST_URL}/"
  body="$(curl -sS --max-time 10 -H 'Host: whoami.cs.localhost' "${TRAEFIK_HOST_URL}/" 2>&1 || true)"
  printf '%s\n' "${body}"
  echo "--- curl -s http://whoami.cs.localhost/ (relies on the OS resolving *.localhost to 127.0.0.1)"
  body2="$(curl -sS --max-time 10 http://whoami.cs.localhost/ 2>&1 || true)"
  printf '%s\n' "${body2}" | grep -E '^(Hostname|Host|X-Forwarded-For|X-Real-Ip):' || printf '%s\n' "${body2}"
  if printf '%s' "${body}" | grep -q '^Hostname: whoami-' && printf '%s' "${body2}" | grep -q '^Hostname: whoami-'; then
    record B PASS "whoami answered via ${TRAEFIK_HOST_URL} with Host header and via http://whoami.cs.localhost/"
  elif printf '%s' "${body}" | grep -q '^Hostname: whoami-'; then
    record B PARTIAL "works with an explicit Host header; whoami.cs.localhost did not resolve or route from this host"
  else
    record B FAIL "no whoami response through Traefik from the host"
  fi
}

verify_c() {
  log "C. source-IP preservation (Design Q21): pod -> http://whoami.svc.cs.internal/ -> CoreDNS rewrite -> Traefik -> whoami"
  kc -n "${VERIFY_NS}" delete pod verify-curl --ignore-not-found --wait=true >/dev/null
  kc -n "${VERIFY_NS}" run verify-curl --image=docker.io/curlimages/curl:8.22.0 --restart=Never --command -- sleep 600 >/dev/null
  if ! kc -n "${VERIFY_NS}" wait --for=condition=Ready pod/verify-curl --timeout=120s >/dev/null; then
    record C FAIL "verify-curl pod did not become Ready"
    return 0
  fi
  local podip traefikip out xff xri remote
  podip="$(kc -n "${VERIFY_NS}" get pod verify-curl -o jsonpath='{.status.podIP}')"
  traefikip="$(kc -n "${SYSTEM_NS}" get pod -l app.kubernetes.io/name=traefik -o jsonpath='{.items[0].status.podIP}')"
  echo "verify-curl pod IP: ${podip}    traefik pod IP: ${traefikip}"
  echo "--- DNS from the curl pod (musl): nslookup whoami.svc.cs.internal"
  kc -n "${VERIFY_NS}" exec verify-curl -- nslookup whoami.svc.cs.internal 2>&1 | grep -vE '^(Server|Address:\s+10\.96\.0\.10)' | grep -v '^$' || true
  echo "--- DNS from the postgres pod (glibc): getent hosts whoami.svc.cs.internal"
  kc -n "${SYSTEM_NS}" exec statefulset/postgres -c postgres -- getent hosts whoami.svc.cs.internal 2>&1 || true
  echo "--- from the curl pod: curl -s http://whoami.svc.cs.internal/"
  out="$(kc -n "${VERIFY_NS}" exec verify-curl -- curl -sS --max-time 10 http://whoami.svc.cs.internal/ 2>&1 || true)"
  printf '%s\n' "${out}"
  xff="$(printf '%s\n' "${out}" | tr -d '\r' | awk '/^X-Forwarded-For:/ {print $2}')"
  xri="$(printf '%s\n' "${out}" | tr -d '\r' | awk '/^X-Real-Ip:/ {print $2}')"
  remote="$(printf '%s\n' "${out}" | tr -d '\r' | awk '/^RemoteAddr:/ {print $2}')"
  echo "X-Forwarded-For=${xff:-<none>}  X-Real-Ip=${xri:-<none>}  caller pod IP=${podip}  RemoteAddr=${remote:-<none>} (Traefik pod ${traefikip})"
  if [ -n "${xff}" ] && [ "${xff}" = "${podip}" ] && [ "${xri}" = "${podip}" ]; then
    record C PASS "X-Forwarded-For and X-Real-Ip equal the caller Pod IP ${podip}: Traefik saw the real Pod IP as TCP peer"
  elif [ -n "${xff}" ]; then
    record C FAIL "X-Forwarded-For=${xff} X-Real-Ip=${xri} differ from caller Pod IP ${podip}"
  else
    record C FAIL "no response from whoami.svc.cs.internal"
  fi
  kc -n "${VERIFY_NS}" delete pod verify-curl --ignore-not-found --wait=false >/dev/null
}

verify_d() {
  log "D. ForwardAuth: Middleware forwardauth-ok (stand-in answers 200) and forwardauth-deny (stand-in answers 401)"
  local ok_code deny_code
  ok_code="$(curl -sS --max-time 10 -o "${TMP}/ok.body" -w '%{http_code}' -H 'Host: protected-ok.cs.localhost' "${TRAEFIK_HOST_URL}/" 2>/dev/null || echo 000)"
  deny_code="$(curl -sS --max-time 10 -o "${TMP}/deny.body" -w '%{http_code}' -H 'Host: protected-deny.cs.localhost' "${TRAEFIK_HOST_URL}/" 2>/dev/null || echo 000)"
  echo "protected-ok.cs.localhost   -> HTTP ${ok_code}; body: $(head -n 1 "${TMP}/ok.body" 2>/dev/null)"
  echo "protected-deny.cs.localhost -> HTTP ${deny_code}; body: $(head -n 1 "${TMP}/deny.body" 2>/dev/null)"
  echo "--- forward-auth request as received by the auth-ok stand-in (verbose whoami log, last request)"
  kc -n "${VERIFY_NS}" logs deploy/auth-ok --tail=60 2>/dev/null | tr -d '\r' | grep -E '(GET /verify-auth|^X-Forwarded-(Method|Host|Uri|For):)' | tail -n 5 || true
  if [ "${ok_code}" = "200" ] && [ "${deny_code}" = "401" ]; then
    record D PASS "200 stand-in: request passed to whoami (HTTP 200); 401 stand-in: request blocked (HTTP 401)"
  else
    record D FAIL "expected 200 and 401, got ${ok_code} and ${deny_code}"
  fi
}

cleanup() {
  if [ "${KEEP}" = "1" ]; then
    echo "keeping namespace ${VERIFY_NS} (--keep)"
    return 0
  fi
  log "cleanup: deleting namespace ${VERIFY_NS} (manifests stay in ${VERIFY_DIR})"
  kc delete namespace "${VERIFY_NS}" --ignore-not-found --wait=true
}

print_summary() {
  echo
  echo "verification summary"
  printf '%-3s %-8s %s\n' ID STATUS DETAIL
  printf '%s' "${RESULTS}" | while IFS='|' read -r id st det; do
    [ -n "${id}" ] && printf '%-3s %-8s %s\n' "${id}" "${st}" "${det}"
  done
}

main() {
  check_environment
  setup
  verify_a
  verify_b
  verify_c
  verify_d
  cleanup
  print_summary
  if printf '%s' "${RESULTS}" | grep -q '|FAIL|'; then
    exit 1
  fi
}

main
