# deploy/ · local Kubernetes infrastructure for CrewStation

Status: **local development profile only** (Plan M0 prototyping). Everything here targets the
Docker Desktop kind-style cluster on this machine: `kubectl` context `docker-desktop`, one arm64
node `desktop-control-plane`. It is not the production installer of Design §11–12; that installer
will grow out of these manifests. All figures below are observed outputs from the run of
2026-09-11 on this machine, not targets.

## Contents

| Path | Purpose |
|---|---|
| `k8s/system/*.yaml` | One component per file, namespace `crewstation-system`: namespace, PostgreSQL, registry, Traefik (CRDs, RBAC, deployment), BuildKit |
| `k8s/verify/*.yaml` | Throw-away checks in namespace `crewstation-verify`; applied and deleted by `local/verify.sh` |
| `local/bootstrap.sh` | Idempotent installer: applies everything in order, creates the PostgreSQL Secret once, patches CoreDNS, configures the node's containerd, runs the verifications, prints a summary |
| `local/coredns-rewrite.sh` | Idempotent CoreDNS patch for `*.svc.cs.internal` |
| `local/node-registry-hosts.sh` | Writes containerd's `hosts.toml` on the node for the in-cluster registry |
| `local/verify.sh` | Re-runnable verifications A–D |
| `local/lib.sh` | Shared helpers, including the guard that ties the context to the node container |
| `local/install-platform.sh` | Builds and imports images, writes the platform Secret, applies `k8s/platform/*`, migrates and waits for rollout. A fresh install prints the administrator setup link; it does not create an account or password. Set `SKIP_BUILD=1` to skip builds, `SKIP_TASK_RUNTIME_BUILD=1` to keep the task image, or explicitly use `CS_BOOTSTRAP_ADMIN=1` for unattended setup |
| `local/install-dev-auth.sh` | Local-only OAuth 2.0/OIDC role switcher at `http://dev-auth.cs.localhost/`: seeds four fixed users through the real login flow and converges their admin/project roles. Called by `install-platform.sh`; set `CS_SKIP_DEV_AUTH=1` to omit it |
| `local/seed-catalog.sh` | Seeds one service plan and one task-container profile using the administrator account. Called after installation only when setup is complete and credentials are available. Compute profiles are created and tested by an administrator in the console (RFC-006) |
| `local/publish-base-image.sh` | Tags the imported task image as the platform base `crewstation/task-runtime:<tag>` and pushes it into the in-cluster registry through the node, so administrators can build profile images `FROM` it (RFC-006 §7.1). Called by `install-platform.sh` unless `CS_SKIP_TASK_RUNTIME=1` |
| `local/bootstrap-integrations.sh` | Creates the two built-in integration-container projects, pushes `integrations/*` into their repositories and releases them to the preview slot |

## Prerequisites (verified 2026-09-11)

- Docker Desktop with its Kubernetes backend: context `docker-desktop`, node `desktop-control-plane`
  (`kindest/node:v1.36.1`, Kubernetes v1.36.1, containerd 2.3.1, arm64, Debian 13), StorageClass
  `standard` (rancher.io/local-path) as default. Pod CIDR `10.244.0.0/16`, Service CIDR `10.96.0.0/16`,
  kube-proxy in iptables mode, kindnet CNI.
- Docker Desktop's helper containers `kind-cloud-provider` (`docker/desktop-cloud-provider-kind:v0.7.0`)
  and `kind-registry-mirror` running; the first one gives `type: LoadBalancer` Services a host-published address.
- `kubectl`, `docker`, `jq`, `curl`, bash (macOS bash 3.2 is enough). No helm, no kind CLI.
- Host ports 80 and 443 free (Docker Desktop publishes Traefik there). Port 5000 on the Mac is taken by
  macOS ControlCenter; nothing here needs it.
- Docker Hub reachable for the first pull of the images listed below.

The scripts refuse to run unless the `docker-desktop` context contains node `desktop-control-plane`,
so they cannot hit another cluster. The only container they `docker exec` into is `desktop-control-plane`;
the `aw-*` containers of agent-workflow are never touched.

## Run

```bash
deploy/local/bootstrap.sh                # install and verify (a warm run with verification took under 2 min here; a cold run also pulls ~370 MB of images)
deploy/local/bootstrap.sh --skip-verify  # install only
deploy/local/verify.sh [--keep]          # re-run checks A–D any time; --keep leaves crewstation-verify in place
deploy/local/coredns-rewrite.sh          # individual steps, each idempotent
deploy/local/node-registry-hosts.sh

deploy/local/install-platform.sh         # then the platform; open its setup link to create your administrator
deploy/local/install-dev-auth.sh         # rebuild/reseed only the local one-click role login entry
deploy/local/seed-catalog.sh             # re-seed service plans and task-container profiles on their own
deploy/local/publish-base-image.sh       # re-push the platform base image (crewstation/task-runtime) into the registry
deploy/local/bootstrap-integrations.sh   # the two built-in integration containers
```

### First administrator

Open the initialization link printed by `install-platform.sh`, or open the console to see the
administrator creation form. **There is no default username or initial password.** Choose your
username, display name, email and password, create the account, then log in with it. The link carries
the one-time bootstrap token; the page consumes it and removes it from the URL. Creation permanently
retires the token. Existing installations keep their accounts and normal login flow.

If the installation output is unavailable, the installation operator can retrieve the token:

```bash
kubectl -n crewstation-system get secret crewstation-secrets -o jsonpath='{.data.CS_BOOTSTRAP_TOKEN}' | base64 -d
```

After creating your account, configure plans in the admin space, or supply `CS_ADMIN_USERNAME` and
`CS_ADMIN_PASSWORD` when running `seed-catalog.sh` or `install-dev-auth.sh`. Those authenticated steps
wait until an administrator exists and credentials are available.

CI and explicitly unattended installs set `CS_BOOTSTRAP_ADMIN=1`. They may set
`CS_BOOTSTRAP_ADMIN_USERNAME`, `CS_BOOTSTRAP_ADMIN_EMAIL` and `CS_BOOTSTRAP_ADMIN_PASSWORD`; if the password
is omitted in this explicit mode, it is generated and saved to `.local/admin.env` (mode `0600`). Normal
interactive installation never writes that file. A creation failure fails the install with its reason.

Re-running is safe: manifests are `kubectl apply`ed, the Secret is created only when absent, and the
CoreDNS and containerd steps report `unchanged`. The Traefik CRDs are applied with
`kubectl apply --server-side` because they exceed the client-side annotation limit.

## What gets installed

| Component | Image (exact tag; arm64 pull verified on the node) | Kubernetes objects | Reach it |
|---|---|---|---|
| PostgreSQL 17 | `docker.io/library/postgres:17.11` | StatefulSet `postgres` (1 replica, PVC `data-postgres-0` 10Gi), Services `postgres` and `postgres-headless` | `postgres.crewstation-system.svc.cluster.local:5432`, database `crewstation`, user `crewstation`; password in Secret `postgres-credentials` (keys `username`, `password`, `database`, `host`, `port`, `url`) |
| Image registry (CNCF Distribution) | `docker.io/library/registry:3.1.1` | Deployment `registry`, PVC `registry-data` 20Gi, Service `registry` type NodePort | pods and BuildKit: `registry.crewstation-system.svc.cluster.local:5000` (plain HTTP); node and kubelet: `127.0.0.1:30500` |
| Traefik v3 | `docker.io/library/traefik:v3.7.13` | 10 `traefik.io` CRDs, ServiceAccount `traefik`, ClusterRole and ClusterRoleBinding `crewstation-traefik`, IngressClass `traefik`, Deployment `traefik`, Service `traefik` type LoadBalancer (80, 443) | from the Mac: `http://localhost/` with any `*.cs.localhost` host name; from pods: `http://<name>.svc.cs.internal/` |
| BuildKit, rootless | `docker.io/moby/buildkit:v0.33.0-rootless` | ConfigMap `buildkitd-config` (`buildkitd.toml`), PVC `buildkitd-cache` 20Gi, Deployment `buildkitd`, Service `buildkitd` | `tcp://buildkitd.crewstation-system.svc.cluster.local:1234` |
| CoreDNS patch | the cluster's `registry.k8s.io/coredns/coredns:v1.14.2` | `rewrite` block inserted into the kube-system `coredns` ConfigMap | — |
| Node containerd | — | `/etc/containerd/certs.d/registry.crewstation-system.svc.cluster.local:5000/hosts.toml` on `desktop-control-plane` | — |

Images used only by `verify.sh`: `docker.io/traefik/whoami:v1.12.0`, `docker.io/hashicorp/http-echo:1.0.0`,
`docker.io/curlimages/curl:8.22.0`, `docker.io/library/busybox:1.38.0` (all arm64, all pulled).

Traefik runs with `--providers.kubernetescrd` (`allowCrossNamespace=true`), `--providers.kubernetesingress`,
`--api.dashboard=false`, `--log.level=INFO`, `--accesslog=true`, entrypoints `web` (Service port 80 →
container 8000) and `websecure` (443 → 8443), as uid 65532 with a read-only root filesystem.
`forwardedHeaders.trustedIPs` is deliberately **not** set: Traefik drops incoming `X-Forwarded-*` headers
and writes `X-Forwarded-For` / `X-Real-Ip` from the real TCP peer, which is what the source-Pod-IP identity
lookup of Design Q21 needs.

## How the Mac reaches Traefik

Docker Desktop's `kind-cloud-provider` implements `type: LoadBalancer`: for the `traefik` Service it started
an `envoyproxy/envoy:v1.36.7` container (`kindccm-…`) on the kind Docker network that publishes
`0.0.0.0:80->80/tcp` and `0.0.0.0:443->443/tcp` on the host and forwards to the node's NodePorts
(`80:31395`, `443:31906`). The Service status shows `172.19.0.5` with `ipMode: Proxy`; that address is on the
Docker network and is **not** routable from macOS, so use `http://localhost/` (or any `*.cs.localhost` name).

```
$ kubectl -n crewstation-system get svc traefik
NAME      TYPE           CLUSTER-IP     EXTERNAL-IP   PORT(S)                      AGE
traefik   LoadBalancer   10.96.199.52   172.19.0.5    80:31395/TCP,443:31906/TCP   59s
$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost/
404          # Traefik answered; there is no route for a bare "/"
```

Because of the envoy → NodePort hop, requests from the Mac arrive at Traefik with the node's bridge address as
peer: whoami showed `X-Forwarded-For: 10.244.0.1` for host requests. Source-IP preservation holds for
in-cluster callers only (see verification C).

## The two name conventions

### `*.cs.localhost` — browser and curl on the Mac → Traefik (user-domain style)

Any name under `.localhost` resolves to loopback on this macOS without an `/etc/hosts` entry or an
`/etc/resolver` file: `getaddrinfo("foo.cs.localhost")` returned `127.0.0.1` and `::1`, and
`curl http://whoami.cs.localhost/` reached whoami through Traefik (verification B).
Google Chrome (152, macOS) behaves the same: opening `http://whoami.cs.localhost/` in the browser on 2026-09-11 rendered
whoami's answer with `Host: whoami.cs.localhost`, `X-Forwarded-Server: traefik-77c4879559-57xm7` and the Chrome
User-Agent, with no hosts-file entry (Chromium also maps `*.localhost` to loopback on its own).
Convention for local platform hosts: `<service>.cs.localhost` (user domain), e.g. `console.cs.localhost`,
`<project>.cs.localhost`. Route on `Host(...)` in an `IngressRoute` on entrypoint `web`.

### `*.svc.cs.internal` — inside the cluster → Traefik (service-domain style)

`coredns-rewrite.sh` inserts this into the `.:53` block of the kube-system Corefile (idempotent, marked by a
comment; CoreDNS is restarted once when the block is added):

```
rewrite stop {
    name regex (.*)\.svc\.cs\.internal traefik.crewstation-system.svc.cluster.local
    answer auto
}
```

Every `<name>.svc.cs.internal` therefore resolves to Traefik's ClusterIP (`10.96.199.52` in this run) and
Traefik routes on the `Host` header. `answer auto` rewrites the answer name back to the queried name so strict
resolvers accept it. Observed with both resolver families:

```
curl pod (musl)     nslookup whoami.svc.cs.internal   -> Name: whoami.svc.cs.internal  Address: 10.96.199.52
postgres pod (glibc) getent hosts whoami.svc.cs.internal -> 10.96.199.52  whoami.svc.cs.internal.crewstation-system.svc.cluster.local
```

The glibc line shows the search-list-expanded name: with `ndots:5` glibc first asks for
`whoami.svc.cs.internal.crewstation-system.svc.cluster.local.`, and the (unanchored) regex matches that too, so
the first query already succeeds. Harmless, and it saves the NXDOMAIN round trips of the search list.

## Using the components from the Mac

The registry NodePort (30500) and ClusterIPs live inside the node container and are not reachable from macOS.
Use port-forwards:

```bash
kubectl -n crewstation-system port-forward svc/registry 30500:5000   # then http://localhost:30500/v2/_catalog
kubectl -n crewstation-system port-forward svc/postgres 5432:5432
kubectl -n crewstation-system port-forward svc/buildkitd 1234:1234   # buildctl --addr tcp://127.0.0.1:1234 ...
kubectl -n crewstation-system get secret postgres-credentials -o jsonpath='{.data.password}' | base64 -d
kubectl -n crewstation-system exec -it statefulset/postgres -- psql -U crewstation -d crewstation
```

Images for the kubelet must be tagged `registry.crewstation-system.svc.cluster.local:5000/<repo>:<tag>`;
pushing from BuildKit needs `--output type=image,name=...,push=true,registry.insecure=true` (the daemon-side
`buildkitd.toml` already declares the registry `http = true, insecure = true`).

## Verification results (2026-09-11, `deploy/local/verify.sh`)

| ID | Check | Result | Evidence |
|---|---|---|---|
| A | Registry chain: `buildctl` in the buildkitd pod builds `FROM busybox:1.38.0` and pushes to `registry.crewstation-system.svc.cluster.local:5000/verify/hello:1`; a pod with `imagePullPolicy: Always` runs it | **works** | `#4 pushing manifest for …/verify/hello:1@sha256:e9e78bb1… done`; registry `GET /v2/verify/hello/tags/list` → `{"name":"verify/hello","tags":["1"]}`; kubelet event `Successfully pulled image "registry.crewstation-system.svc.cluster.local:5000/verify/hello:1" in 16ms`; pod `verify-hello 1/1 Running` |
| B | User-domain path from the Mac: `curl -H 'Host: whoami.cs.localhost' http://localhost/` and `curl http://whoami.cs.localhost/` | **works** | `Hostname: whoami-85944dc4f-7vr7m … Host: whoami.cs.localhost … X-Forwarded-For: 10.244.0.1 … X-Forwarded-Server: traefik-77c4879559-57xm7` |
| C | Source IP (Design Q21): pod `verify-curl` calls `http://whoami.svc.cs.internal/` through the CoreDNS rewrite and Traefik | **works: Pod IP preserved end to end** | caller pod IP `10.244.0.23`; whoami received `X-Forwarded-For: 10.244.0.23`, `X-Real-Ip: 10.244.0.23`, `RemoteAddr: 10.244.0.7:34266` (Traefik's pod). Pod → ClusterIP → Traefik keeps the source address with kube-proxy iptables + kindnet; Traefik forwards it |
| D | ForwardAuth: Middleware to a stand-in answering 200 (`traefik/whoami`) and to one answering 401 (`http-echo -status-code=401`) | **works** | `protected-ok.cs.localhost → HTTP 200` with the whoami body; `protected-deny.cs.localhost → HTTP 401`, body `denied by auth-deny stand-in`; the auth-ok stand-in logged `10.244.0.7:56042 … "GET /verify-auth HTTP/1.1"` from Traefik |

Also observed during bootstrap: containerd honoured the new `hosts.toml` without a restart (the probe pull of a
non-existent tag was answered `not found` by `127.0.0.1:30500`), and the second bootstrap run reported
`unchanged` for the namespace, Secret, CoreDNS block and `hosts.toml`.

`verify.sh` deletes `crewstation-verify` at the end (`--keep` to inspect). The pushed `verify/hello:1` stays in
the registry (`REGISTRY_STORAGE_DELETE_ENABLED=true` allows removing it through the registry API if wanted).

## Known limitations

- **Single node, local-path volumes.** PVC data lives inside the node container under
  `/var/local-path-provisioner/`; a "Reset Kubernetes cluster" in Docker Desktop erases it. Not HA; not a
  performance reference.
- **HTTP only.** `websecure` (443) is wired through but no certificates are configured yet.
- **Registry without TLS or authentication**, reachable only inside the cluster and from the node. Anything
  pulling it needs the insecure/HTTP declarations shown above.
- **Host requests do not carry the client IP**: the envoy → NodePort hop makes Traefik see `10.244.0.1`.
  Only in-cluster callers keep their Pod IP (verification C). This is a property of the Docker Desktop LB, not
  of Traefik.
- **The CoreDNS patch restarts CoreDNS once** (a few seconds of DNS churn) the first time it is applied, and it
  edits a kubeadm-managed ConfigMap; a Docker Desktop cluster reset drops it, `bootstrap.sh` puts it back.
- **`hosts.toml` is node-local state**, also lost on a cluster reset and restored by `bootstrap.sh`.
- **BuildKit rootless caveats**: no process sandbox (`--oci-worker-no-process-sandbox`), seccomp and AppArmor
  unconfined, `allowPrivilegeEscalation` left at default for the setuid `newuidmap`. Good enough for local
  builds; the production build path is decided in Plan T0/M2, not here.
- **`kubectl apply` prints `configured` for the postgres StatefulSet on every run** although `kubectl diff` is
  empty and the pod is not restarted (server-side defaulting of `volumeClaimTemplates`). Cosmetic.
- Exact tags are pinned here for this environment; Plan T0.2 locks the platform versions for real.

## Uninstall

```bash
kubectl delete namespace crewstation-system            # PVs are reclaimed (reclaimPolicy Delete)
kubectl delete -f deploy/k8s/system/30-traefik-crds.yaml
kubectl delete clusterrole crewstation-traefik clusterrolebinding crewstation-traefik ingressclass traefik
docker exec desktop-control-plane rm -rf '/etc/containerd/certs.d/registry.crewstation-system.svc.cluster.local:5000'
# CoreDNS: remove the marked rewrite block from `kubectl -n kube-system edit configmap coredns`, then
kubectl -n kube-system rollout restart deployment/coredns
```

## 集群容量、实时用量与七天历史（RFC-015）

`install-platform.sh` 安装 `38-cluster-metrics.yaml`：内部 Prometheus 3.13.3、10Gi 指标 PVC、固定卷根的只读 `cs-storage-probe` DaemonSet，以及独立监控凭据。`configure-metrics.ts` 首次生成三把凭据，重复执行保留既有值；不要删除 `crewstation-metrics` Secret 来重复安装。Prometheus 仅提供内部 Service，API 使用固定查询模板；对外不暴露 PromQL、probe 或 kubelet 代理。

安装前核对 **节点实际可用磁盘**。local-path 的 PVC `requests.storage` 不是硬配额或新增物理容量；10Gi 申请成功不代表磁盘有 10Gi 空闲。指标保留为 8 天，管理界面查询最近 7 天，留一天清理缓冲；没有按磁盘大小提前截断历史。采集从首次部署时刻开始，过去无数据的区间保留缺口。物理盘不足须扩容，不能删业务卷或伪称已有七天数据。

`crewstation-metrics-env` 的 `CS_STORAGE_PROBE_HOST_ROOT` 与 DaemonSet 的 `local-volumes.hostPath.path` 必须指向同一固定节点卷根（默认 `/var/local-path-provisioner`）；换存储供应器时同时修改这两处。probe 内挂载始终为只读 `/volumes`，请求只能指定经过 PV/PVC 绑定和节点归属校验的相对目录。CSI 提供原生卷统计时优先使用；不支持的卷给出原因，不显示假 0。Prometheus 的 PVC 大小／StorageClass 可在首次应用 StatefulSet 前配置，已有 PVC 按存储供应器的扩容流程调整。

API 与 controller 读取 `crewstation-metrics-env`、`crewstation-metrics`，修改后滚动重启对应 Deployment；变更 Prometheus scrape 配置后重启 StatefulSet。节点／Pod 指标约 15 秒采集，卷扫描独立约 60 秒。页面同时显示来源时间、采集覆盖率、缺失／过期／错误；应用与节点网络、文件系统别名、共享 PVC 都不相加冒充物理总量。完整验收和当前部署数据起点记录在 RFC-015 的 acceptance.md。
