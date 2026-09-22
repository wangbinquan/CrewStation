# RFC-019｜实施计划

> 状态：Draft · 2026-09-22 · 待作者批准后开始 T1
> 配套：[提案](./proposal.md) · [技术设计](./design.md) · [交互设计稿核对](./prototype-review.md)

## 目录

- [1. 任务与依赖](#1-任务与依赖)
- [2. 验收清单](#2-验收清单)
- [3. 交付门禁](#3-交付门禁)

## 1. 任务与依赖

| 任务 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| RFC-019-T1 | 作者批准三件套并裁定提案 §7（成员可见的 Pod 事实边界） | 作者 | 未执行 |
| RFC-019-T2 | 契约：`ProjectClusterResourcesSchema`、`summary.projects[]` 计数；api-client `cluster.projectResources`；Schema 用例 | T1 | 未执行 |
| RFC-019-T3 | `cluster-management`：`authorizeProject` 依赖、`projectResources` 用例、`summary` 计数、路由；组合根注入；真实 PostgreSQL 的成功／401／403／404／400／410／截断用例 | T2 | 未执行 |
| RFC-019-T4 | `tokens.css` 九组语义色；`shared/ui/topology/` 渲染组件与排布（从原型迁入，改为 CSS module 与 `useT`）；排布与组件用例 | T1 | 未执行 |
| RFC-019-T5 | `shared/topology/` 组装：项目形态、横带汇总、系统层静态表、项目层折叠；组装用例 | T2、T4 | 未执行 |
| RFC-019-T6 | 项目概览「部署与运行形态」卡；运行与诊断 `topology` 页签、筛选、只读详情；中英文 | T3、T5 | 未执行 |
| RFC-019-T7 | 集群管理「拓扑」页签：三层、面包屑、项目层折叠、复用 `ClusterDetail`；中英文 | T3、T5 | 未执行 |
| RFC-019-T8 | 窄屏列表、键盘、`prefers-reduced-motion`、浅深主题核对；e2e 三处入口与测试员 403 | T6、T7 | 未执行 |
| RFC-019-T9 | 本机构建部署、真实浏览器与 `kubectl` 对账（TP-01…TP-18）、完整 gate、改动行防护、精确 SHA CI，`acceptance.md` | T8 | 未执行 |
| RFC-019-T10 | 基线回填：Proposal §3／§6 新增需求行、Design §2 与 §8 增补、Plan 新增 AT 与矩阵行，版本升 v0.3.8；README 状态收口 | T9 | 未执行 |

## 2. 验收清单

| 编号 | 要求与可观测证据 |
|---|---|
| TP-01 | 开发者身份打开演示数字人的运行与诊断「部署与运行形态」：入口、工作负载、Pod、数据与存储四泳道与线上槽、待命槽、开发会话、业务任务、构建与迁移横带按实际存在的对象出现，不凭空构造 |
| TP-02 | 图上的 Pod 数、就绪数、工作负载数与 `kubectl -n <ns> get pods,deploy,job` 及集群管理资源表一致；Running 不等于 Ready |
| TP-03 | 线上槽与待命槽的主机、版本、副本与「发布与上线」页一致；切流后下一份快照角色互换而位置不变 |
| TP-04 | 开发会话运行时工作区 Pod、每个 CLI／Agent Pod、工作卷与开发库出现，`child` 与 `mounts` 边正确；释放会话后横带消失 |
| TP-05 | 业务子任务等待调度时状态短语原样显示（如 `Insufficient cpu`）并标需要关注；调度后同一节点位置不变、状态更新 |
| TP-06 | 发布触发的构建与迁移 Job 及其 Pod 出现在构建与迁移横带；迁移 Pod 对生产库有 `uses` 边 |
| TP-07 | 点节点右侧详情显示事实、关联（可点跳）、容器、事件；项目侧没有重启／扩缩／删除入口，`availableActions` 为空 |
| TP-08 | 筛选用途、状态、只看需要关注只压暗不移除；清除后恢复 |
| TP-09 | 项目概览横带汇总卡与全图一致，点卡进入全图 |
| TP-10 | 测试员访问项目形态接口与页面得 403；非成员 403；未登录 401；跨项目 id 403 |
| TP-11 | 管理员集群管理「拓扑」系统层：`crewstation-system` 内每个组件的状态与资源表一致；静态调用线默认显示且图例标明不是实测 |
| TP-12 | 项目层每项目计数与逐项目过滤的资源表一致；异常项目置顶；模拟或真实超过 60 个项目时折叠并可展开 |
| TP-13 | 从项目卡展开 Pod 层，与该项目的运行与诊断全图同一形态；面包屑返回项目层；Pod 层点节点走 RFC-010 资源详情 |
| TP-14 | 每 15 秒换快照时已有节点位置不变；快照 410 时提示刷新 |
| TP-15 | 制造一个来源读取失败（如临时撤销 PVC 的 RBAC）：观测行写明失败来源，受影响节点标待核对，计数不显示 0 |
| TP-16 | 1728／1280／1024 宽度下 SVG 与内容区等宽、无整页横向溢出；390／320 为分组列表，`innerWidth = scrollWidth` |
| TP-17 | 浅色深色、中英文文案齐全（`i18nParity`）；键盘 Tab 到节点、Enter 选中、Esc 关闭详情；`prefers-reduced-motion` 下无过渡 |
| TP-18 | 完整本地 gate 与 `test:patch` 通过，精确 SHA CI 六项成功；`acceptance.md` 记录每项证据 |

## 3. 交付门禁

- 每个任务与其用例同一提交；`bun run check` 通过后才提交；按显式路径 `git add`。
- 触及契约的提交先跑 `bun run contracts:lock` 判断是否属于业务契约面。
- 本机部署只重建 console 与控制面镜像并 `ctr import` 单个镜像，部署前看节点磁盘；不跑整套 `install-platform.sh`。
- 实机验收不改真实项目授权；需要制造失败时用可回滚的方式并在 `acceptance.md` 记录恢复。
