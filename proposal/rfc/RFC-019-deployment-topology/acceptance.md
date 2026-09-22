# RFC-019｜验收记录

> 状态：In Progress · 2026-09-22 · 本机 kind 集群、dev-admin 真实 Chrome；精确 SHA CI 六项成功；未实机复核的项写明原因
> 配套：[提案](./proposal.md) · [技术设计](./design.md) · [实施计划](./plan.md)

## 目录

- [1. 环境](#1-环境)
- [2. 逐项证据](#2-逐项证据)
- [3. 顺手修的缺陷](#3-顺手修的缺陷)
- [4. 卡住的地方与收尾](#4-卡住的地方与收尾)

## 1. 环境

- 集群：本机 `docker-desktop` kind 节点，命名空间 `crewstation-system`；镜像 `cs-control-plane:rfc019-20260922`（`eb29e4f18d11`）滚到 cs-api／cs-auth／cs-controller／cs-events／cs-session／mcp-capabilities／mcp-operations，`cs-console:rfc019-20260922`（`63009310fdd6`）滚到 console，§3 修复后重建为 `cs-console:rfc019-20260922b`（`eaa4882f8932`）并已滚出；`docker save | ctr -n k8s.io images import` 单个镜像导入，`kubectl set image`。
- 浏览器：Chrome，dev-admin（管理员，dev-oidc 登录），1728px 视口；`read_console_messages` 按 `error|warn` 过滤为空。
- 对账项目：演示数字人 `01a0c12a-de0c-7009-83f4-d05f95c9a0a2`（命名空间 `cs-demo`，prod＝blue v0.1.4、preview＝green v0.1.2、开发会话工作区一个）。
- 本地门禁：`CS_TEST_DATABASE_URL` 指向本机测试库的 `bun run check`：`arch:check` 无违规，**2060 pass／55 skip／0 fail**（55 个 skip 全是 e2e 层，原因见 §4）。

## 2. 逐项证据

| 编号 | 结果 | 证据 |
|---|---|---|
| TP-01 | 通过 | 运行与诊断「部署与运行形态」：入口／工作负载／Pod／数据与存储四泳道；横带只出现实际存在的线上槽（prod · blue · v0.1.4）、待命槽（preview · green · v0.1.2）、开发会话（分支 main · 0 个 Agent）；业务任务、构建与迁移横带因当时没有对象而不出现。节点 11 个：`route:prod`、Deployment `demo-blue`（`c6771f1d…`）、Pod `demo-blue-56fb8ffff9-kl2cg`（`e4841e13…`）、`db:production`、`route:preview`、`demo-green`（`15d3d9f4…`）、`demo-green-d668b9755-vmcdv`（`9e1dbb15…`）、`route:dev`、工作区 Pod `task-r-01a0c7fc…`（`7002b47a…`）、PVC `task-01a095410744-work`（`e5ef3ab4…`）、`db:development` |
| TP-02 | 通过 | `GET /v1/projects/<id>/cluster-resources`：3 个 Pod、2 个 Deployment、1 个 PVC，`complete: true`；`GET /v1/admin/cluster/summary` 的 `projects[]` 演示数字人 `workloads 2 / pods 3 / readyPods 3`，与 `kubectl -n cs-demo get pods,deploy` 一致；概览卡「工作负载 2 · Pod 3，就绪 3，运行 0」——Running 与 Ready 分开计数 |
| TP-03 | 用例覆盖，未实机切流 | 两槽主机、版本、副本与「发布与上线」页一致（demo.cs.localhost v0.1.4 1／1、preview.demo.cs.localhost v0.1.2 1／1）；「切流后角色互换而位置不变」由 `topologyLayout.test.ts`「状态与标题变化不移动节点」覆盖，本轮没有为验收切演示项目的流 |
| TP-04 | 部分通过 | 开发会话横带里工作区 Pod、工作卷（`mounts` 边）与开发库（`uses` 边）实机出现；当时没有 CLI／Agent Pod 在跑，`child` 边由 `topologyAssembly.test.ts` 覆盖；释放会话后横带消失未实机做（不释放作者的会话） |
| TP-05 | 用例覆盖 | `topologyPages.test.tsx`：Pending 的业务子任务 aria-label 含 `Insufficient cpu` 并标需要关注；实机当时没有排队中的子任务 |
| TP-06 | 用例覆盖 | `topologyAssembly.test.ts` 构建与迁移横带及迁移 Pod 对生产库的 `uses` 边；本轮没有发布，实机无 Job |
| TP-07 | 通过 | 点 Pod 节点右侧详情：就绪徽记、用途「数字人服务」、状态 `Running · demo-blue: Unknown (exit 255)`、重启 1、节点 `desktop-control-plane`、镜像 `registry.crewstation-system.svc.cluster.local:5000/demo:v0.1.4`、创建时间、发布 id、槽 `blue · prod`、UID、关联 2（`demo-blue` 管理、生产库）；「这里只读」说明在，页面无「调整副本」；「查看日志」进日志页并带 `source=slot&slot=prod`；接口 `availableActions` 全为空 |
| TP-08 | 通过（DOM 用例）＋实机筛选栏 | `topologyDiagram.test.tsx`：筛选只置 `data-dim` 不移除节点，清除后恢复，「只看需要关注（n）」按异常计数；实机筛选栏显示用途 4 组、状态「就绪」、关注 0 时按钮禁用 |
| TP-09 | 通过 | 概览「部署与运行形态」卡三条横带（`band:slot:prod`、`band:slot:preview`、`band:dev`）与全图一致，「查看完整形态 →」及点卡都进 `operations?tab=topology` |
| TP-10 | 通过（模块用例）＋实机管理员 200 | `modules/cluster-management/tests/projectResources.test.ts`（真实 PostgreSQL）：负责人／开发成员 200 且无动作，测试员 403，陌生人 403，未知项目 403，未登录 401，坏参数 400，过期快照 410；实机 dev-admin 200。非管理员实机走 `tests/e2e/topology.test.ts` 的成员检查，本机 e2e 层未跑（§4） |
| TP-11 | 通过 | 集群管理「拓扑」系统层：`crewstation-system` 内 21 个节点、20 条静态线默认显示，图例注明「虚线为静态架构标注，不是实测」；`cs-api` 的 aria-label「cs-api，副本 1／1，REST API · 集群盘点 · MCP 后端」，每个组件状态来自同一快照的资源表；CI e2e（run 35744347320）在没有项目的空平台上同样断言静态线多于 10 条、`cs-api` 的 aria-label 含「副本」 |
| TP-12 | 通过（折叠为用例） | 项目层 11 个项目按摘要计数画出，「需要关注 · 2 个项目」置顶；超过 60 个折叠由 `topologyAssembly.test.ts`（`projectsLayer`）覆盖，本机只有 11 个项目 |
| TP-13 | 通过 | 项目卡 → 「展开该项目的 Pod 层」→ 面包屑「项目层 › 演示数字人」，Pod 层 11 个节点与运行诊断页签同一形态；点节点走 RFC-010 的 `ClusterDetail`；「返回项目层」回项目层 |
| TP-14 | 部分通过 | 页头「每 15 秒换一份快照，节点位置按 UID 固定」，查询 `keepPreviousData` 15 秒刷新；位置不变由排布用例覆盖；410 由模块用例覆盖，工作台以 QueryStatus 提示刷新；实机没有等到 410 |
| TP-15 | 未做 | 来源失败的展示（观测行写失败来源、节点待核对、计数不显示 0）由 `topologyAssembly.test.ts` 与模块用例覆盖；实机撤 RBAC 会影响作者并行会话，本轮不做 |
| TP-16 | 通过（320 仅原型核对） | 本机 1728 视口：集群拓扑 SVG 1467px 铺满 1470px 容器；运行诊断页签开详情时 SVG 1072px 铺满 1074px 容器，`scrollWidth 1728 = innerWidth`。1280／1024 铺满（SVG 与容器宽度差 ≤8px）与 390 分组列表（无 SVG、`scrollWidth − innerWidth ≤ 1`）由 CI e2e 在部署好的平台上实测通过（[run 35744347320](https://github.com/wangbinquan/CrewStation/actions/runs/35744347320)，`2ce5ba0`）；320 只在原型核对过，本机浏览器会话过期后未再登录复核 |
| TP-17 | 部分通过 | `i18nParity` 在 console 层通过（`topology.*` 204 键、三处 feature 文案中英齐全）；键盘 Tab／Enter／Esc 由 `topologyDiagram.test.tsx` 覆盖；明暗两套 `--cs-topo-*` 令牌由 `topologyTokens.test.ts` 回归；实机浅色主题与键盘复核待登录恢复 |
| TP-18 | 通过 | 完整本地 gate 通过（§1）；`test:cover` 三层全绿（e2e 层 28 项因登不进而超时失败，同一原因），`test:patch --base origin/main --worktree` 改动行 522／522（100%）；CI：实现推送 `f087007` 的 [run 35743094030](https://github.com/wangbinquan/CrewStation/actions/runs/35743094030) static／unit／module／console／gate 成功、新增代码防护 1229 行中 1219 行被执行（99.2%），e2e 39 pass／20 skip／1 fail——唯一失败是本 RFC 的系统层用例在没有项目的 CI 平台上等项目卡片，`2ce5ba0` 改为按项目数分支；[run 35744347320](https://github.com/wangbinquan/CrewStation/actions/runs/35744347320) 六项全部成功，e2e 40 pass／20 skip／0 fail（Pod 层与成员用例因 CI 无项目而 skip） |

## 3. 顺手修的缺陷

- PVC 的 `facts` 值是 JSON（`capacity {"storage":"10Gi"}`）原样上图。加 `factText` 取其中的量，卡片显示 `capacity 10Gi`；`topologyAssembly.test.ts` 已断言。已重建并滚出 `cs-console:rfc019-20260922b`，实机复核待登录恢复。

## 4. 卡住的地方与收尾

滚 `cs-control-plane` 新镜像时 `crewstation-dev-auth` 也换了镜像并被 Recreate 策略重建：它启动要先用管理员**密码**登录平台播种，而库内策略仍是密码登录关闭（日志：`准备失败：CrewStation 403 /auth/login：用户名密码登录已被管理员关闭`），`readyz` 持续 503，旧 Pod 已不在。后果：本机 dev-oidc 登不进，浏览器会话过期后无法再登录，e2e 层整层 skip。恢复走 STATE 已记的破窗口流程（`CS_PASSWORD_LOGIN=force-on` → 重启 cs-auth／cs-api → 开发登录器重新播种 → 移除开关 → 再重启两个服务），按惯例需作者授权，本轮未做。

收尾清单：作者授权后恢复 dev-auth；重建 console 镜像（含 `factText`）复核 TP-16 的 1280／1024／390、TP-17 的键盘与浅色主题、§3 的显示；跑本机 e2e 层；把上表「待复核」改成实测；README 收口为 Done。
