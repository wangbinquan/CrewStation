# 0009. 资源中心：新增 resources（L1）、cluster-control 与 data-control（L2）、resource-runtime 包

- 状态：已接受；作者于 2026-09-23 「批准并实施」RFC-025（含本 ADR）
- 日期：2026-09-23
- 关联：[RFC-025](../../proposal/rfc/RFC-025-resource-center/proposal.md)；修订 [ADR-0006](./0006-cluster-management-module.md) 的所有权描述

## 背景

RFC-025 要把与 Pod、容器、服务相关的资源分配、启动、释放、流量收口到一处，作者裁定「可以多个模块，状态收口在 infra 层」「声明式：各模块存期望，中心存实况」。今天这些职责分散在 `data`（L3）、`release`／`task-runtime`（L4）、`dev-session`／`business-task`／`gateway`（L5）、`provisioning`／`cluster-management`／`observability`（L6），ADR-0006 与 Design D53 规定「原模块保留生命周期和期望配置所有权」。要让所有这些模块都能写期望、读实况，承接者必须在它们全部之下；它不需要任何领域模块，只需要通用包。

## 决策

新增三个模块与一个包，按标准脚手架（`bun run scaffold:module`）创建：

- `modules/resources`，**L1**（与 `identity` 同层、互不依赖）：拥有 `resources` schema（记录、子对象、变更日志、租约、别名）、种类注册表与阶段规则、受理与平台预检、按台账推导的额度、保留期、可做操作、标准视图与推送流的 HTTP。项目额度上限、角色裁剪、Kubernetes dry-run 经 `ports/` 声明，由 `modules/platform/wiring.ts` 回填。
- `modules/cluster-control`，**L2**：全部受管 Kubernetes 对象的调和、观测映射、孤儿回收、旧对象收编；依赖 `resources` 与通用包。今天散在各模块 `adapters/k8s/` 里的写集群代码迁入这里。
- `modules/data-control`，**L2**：数据面（库、角色、授权）的调和；执行代码自 `data` 模块的供给适配器迁入。
- `packages/resource-runtime`（领域无关）：按种类的 list＋watch 缓存与定期全量核对、按资源 ID 去重的工作队列、租约、退避。

依赖规则：

- 写期望、读实况的领域模块只依赖 `resources` 的根 `index.ts`；不依赖两个 `*-control` 模块。两个 `*-control` 由组合根装配进 `cs-controller`，不依赖任何领域模块。
- `tools/arch` 新增一条规则：除 `cluster-control` 外，`modules/*` 不得 import `packages/k8s` 的写操作（`apply`、`create`、`patch`、`delete`）；只读观测经 `resources` 的端口。迁移期间按 RFC-025 的分期逐步收紧，未迁的模块在本 ADR 里以带到期日的例外声明列出（实施时补）。

ADR-0006 修订：`cluster-management` 保留管理员的清单、筛选、历史用量与运维操作的受理和审计；受管对象的盘点改读 `cluster-control` 的观测，运维操作改为写期望，由调和器执行。「原模块保留期望配置」仍成立，「生命周期所有权」改归资源中心。

## 后果

- 获批实现时更新 `docs/engineering/repository-structure.md` §5 模块表与 §6 依赖图、`tools/arch/policy.ts` 的模块登记与新规则，并按迁移锁规则登记新迁移。
- `task-runtime` 交出大部分集群适配器后缩小；若某个 `*-control` 模块超过 40 个源码文件，按结构文档再立 ADR 拆分，不在本 ADR 预先拆。
- 不调整 600／20／80 上限，不引入 facade 或跨层 import。
