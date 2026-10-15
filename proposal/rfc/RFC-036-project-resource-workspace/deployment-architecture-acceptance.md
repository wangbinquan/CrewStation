# RFC-036 部署架构资源视图：实现与验收

状态：Done · 2026-10-15。作者明确要求「你来按照设计完成RFC」，已按部署架构原型实施、精确发布并完成本机 console 部署及部署后浏览器验收。本文仅记录本次追加；旧资源中心、聚合修正和实际调额的验收分别保留在原文档中。

## 实现范围

| 设计约束 | 正式实现依据 |
| --- | --- |
| 资源中心和运行诊断复用六类事实与推送缓存，各来源保留时间和完整性 | `apps/console/src/shared/topology/useProjectTopology.ts:14` |
| 台账 ID、不可变物理 UID、发布 ID、数据库 ID 桥接；不同名字或同名替换不推断归属 | `apps/console/src/features/project-resources/model/deploymentIdentity.ts:7`；`apps/console/src/shared/topology/physicalIdentity.ts:4` |
| 部署槽与副本聚合，原始成员关系保留，生产数据共用，声明与拟申请分离 | `apps/console/src/features/project-resources/model/deploymentGraph.ts:70` |
| 发布与构建、已生效任务数据库绑定保留原始证据；无 Pod 的在途作业仍可见 | `apps/console/src/features/project-resources/model/deploymentDependencies.ts:6`；`apps/console/src/shared/topology/projectTopology.ts:113` |
| 四视角、每页 20 个对象、筛选保留上游上下文，局部画布明确标示不完整 | `apps/console/src/features/project-resources/model/deploymentProjection.ts:8` |
| 命名空间紧凑额度、公共能力与全项目目录、待核对清单、窄屏与放大图 | `apps/console/src/features/project-resources/components/DeploymentWorkspace.tsx:21` |
| 统一 Dialog 的权限／运行对象／原始关系页签；列表内部 50 行递增分页 | `apps/console/src/features/project-resources/components/DeploymentObjectDialog.tsx:21` |

API、事件依赖来自发布声明，以配置关系展示，不冒充已测量的调用。目录中有授权但无运行关联的资源保留；读取不完整时不显示“已授权未使用”的断言。服务规格和 Agent 档位、任务规格仍为不同条目。原动作描述、申请、审批、生效回执和旧链接继续复用，未新增业务合同、迁移或后端权限。

## 自动化检查

源码已精确提交并推送 `c02ca7a29a872f9e7bfc505cb1c2b414445e6d35`。56 个准确路径含 25 个源码／测试文件、批准的原型和验收文档；共享索引、署名及远端同步已核对。准确 SHA [GitHub CI 38742516344](https://github.com/wangbinquan/CrewStation/actions/runs/38742516344) 于 2026-10-15 13:34:03 UTC 完成，static、unit、四片 module、console、实机 e2e 和 gate 共九项全部成功。机器可读结果见 [门禁记录](./deployment-architecture-gates.json)。

| 本地检查 | 结果 |
| --- | --- |
| 结构、lint、后端及 console 类型 | 全部完成；两套类型在 Node 4 GiB 堆配置下通过 |
| 方法级 UT | 1524 pass／0 fail，370 文件 |
| 四片模块测试，独立真实 PostgreSQL | 2922 pass／27 环境 skip／0 fail，601 文件 |
| 控制台完整层 | 1184 pass／0 fail，183 文件 |
| 本地端到端层 | 20 pass／132 环境 skip／0 fail，22 文件；本地没有完整 CI 实机环境 |
| 全部分层汇总及用例人口审计 | 5650 pass／159 环境 skip／0 fail，5809 用例、1176 文件 |
| 本次新增代码防护 | 374／374 可执行行命中，100% |
| Vite 生产构建 | 通过 |

验证沿用仓库 CI 的分层、四片分区、完整用例人口／JUnit／LCOV 审计。测试断言、超时、跳过规则和生产配置均未改变。源码冻结后唯一的格式修正是去掉文件末尾一个多余空行；最终验证镜像 `sha256:2f41e60cebc8ad93d3cc057c22cef59a809e312f26e07b36b5ada95ac2efa217` 来自准确提交。环境为 Bun 1.3.13、非 root、UTF-8、独立 PostgreSQL 17.11，prepared transactions 已启用。

原始失败保留，不能把这一结果写成单进程 `bun run check` 全绿：

- 主目录 lint 有八处历史 `.local/cli-bot-acceptance/` 验收脚本错误，原文件保持；完整候选镜像按正常构建规则排除本地生成物和凭据，并包含全部共享源码与测试。
- 首次单进程完整检查的静态阶段已通过；记录 4091 pass／159 skip／一项既有 Registry 清理用例的 5 秒超时后，进程达到 18 GiB 容器限制，`OOMKilled=true`、退出 137，未完成。
- 改用现有 CI 分层释放各批内存；静态重检的 Debian Node 默认 2 GiB 堆不足，仅补足到 4 GiB 后完成两套类型。原 Registry 用例在完整分片中以原 5 秒预算通过（runtime-environment 3569ms、release 2619ms），不是删掉失败、增加重试或延长用例预算。
- 本次创建的十二个测试容器和独立网络已按准确名称清理；日志与覆盖产物留在 `.local/rfc036-acceptance/`。汇总回执见 [门禁记录](./deployment-architecture-gates.json)。

组合回归另外覆盖双端路由、79 行权限末行与分页上下文、嵌套 Esc／焦点、四视角、业务任务隔离、共享生产数据、不可变 UID、68 个对象分页、部分失败和拒绝访问。原类型循环依赖在第一次结构检查中发现并拆开，没有加结构豁免。

## 真实接口与浏览器

本批浏览器使用现有 dev-developer 身份。项目“演示数字人” `01a0c12a-de0c-7009-83f4-d05f95c9a0a2`，namespace `cs-demo`。先以本地最终 Vite 构建通过只允许 GET／HEAD 的预览代理访问现有真实平台；这一阶段不是固定 API 夹具，也不计为正式部署后的验收。

- 实际读到 82 项已有能力、22 个资源中心来源、服务槽、Deployment／Pod、生产数据库与已声明 gitlab.push 事件。`demo-blue` 聚合两个运行对象，并关联十个原始资源条目。
- 顶部按真实额度显示 CPU requests 0.5／8 核、内存 requests 0.5／16 GiB、Pod 1／30、PVC 0／20。生产库和逻辑访问入口在命名空间边界外。
- 从部署对象权限列表按 service-plan 筛选，进入 standard-small 的统一详情；原资源 UUID、CPU 500m、内存 512Mi、副本上限 3 与实际回执一致。
- 390×844 的内层详情 x=16、y=16、width=358、height=812；Esc 只关闭内层，保留 service-plan 筛选，焦点回到“详情”。320×844 的外层弹窗 width=288，document.scrollWidth=320，无横向溢出。最终构建再验 390px，第二次 Esc 关闭对象后焦点返回 demo-blue 原列表入口。
- 桌面 1440px 中文／英文主图实看；英文配额单位 cores/items 和 Event subscription 正确，原始资源名和后端原因保留原文。临时语言和视口设置已还原。
- 当前真实身份是开发者；管理员与负责人操作由既有回归及本次隔离路由用例验证。没有把隔离角色或历史真实调额计为本次真实审批，没有提交授权、调额、发布或创建工作负载。

本地截图和原始只读快照保存在 `.local/rfc036-acceptance/`。本次新实现的管理员、负责人和复杂开发／业务任务场景由完整回归覆盖，没有把它们写成本轮新的实机角色操作。自动审批曾拒绝访问另一会话的私有项目，原因是当前验收授权不覆盖该项目；未重试或绕行，验收继续限定在上述演示项目。

## 本机正式部署与部署后验收

2026-10-15 13:38:57 UTC 完成仅 console 更新，使用准确源码归档构建，先核对源码 SHA 的九项 CI、存储契约版本 1 和原部署源码的祖先关系。部署在 `docker-desktop` / `crewstation-system`，通过包含 UID、resourceVersion、旧镜像前置条件的 JSON patch 仅替换 console 镜像，没有运行整平台替换。回执见 [部署与浏览器记录](./deployment-architecture-deployment.json)。

- 原源码 `507d832d86173e26581eeb2f10746976ab543b54`；新源码 `c02ca7a29a872f9e7bfc505cb1c2b414445e6d35`。
- 新镜像 `docker.io/library/cs-console@sha256:4df32c12d0bd1a541ff0af4819141fc80c2c99f4d1f3c8d2a584dca5c51214a6`，构建 config ID `sha256:441c3b9a14ce5fc78750e7f25f9d870f24a8ee83cb0da9388b91de1d037c90da`。
- console UID `c4874a0e-6415-4c2b-b141-74ac25ea10ed` 保持，generation 307 → 308，observedGeneration=308、Ready=1。其余 11 个系统 Deployment 的 UID、generation、镜像和 Runner 配置完全相同。
- 演示项目 Pod UID 前后均为 `88e8c9a6-7893-4e1d-97e7-4c175fb0db99`，没有重建业务实例。
- 实际打开不带预览端口的 `http://console.cs.localhost/projects/01a0c12a-de0c-7009-83f4-d05f95c9a0a2/resource-center`：四视角、82 项已有能力、真实命名空间额度、单个共享生产库、gitlab.push 声明关系均出现；demo-blue 为 2 个运行对象／10 项资源权限。
- 正式页桌面 1728×817，document.scrollWidth=1728；390×844 嵌套详情 x=16、y=16、width=358、height=812，document.scrollWidth=390。Esc 返回外层时仍为 service-plan 筛选且焦点在“详情”；稳定窄屏布局从 demo-blue 打开／关闭后焦点回原入口。未提交任何资源申请或权限变更，临时视口已复原。
- 只读预览进程和本次测试容器／网络已关闭或清理，正式页面保留为交付入口。

后续验收文档提交只保存此处证据，不修改已验证的源码或重新部署；其准确 SHA CI 在交付时另行核对，不代替上述源码 CI。

## 页面证据

[正式部署主图](./acceptance-screenshots/deployment-architecture/deployed-desktop.jpg) · [正式部署 390px 嵌套详情](./acceptance-screenshots/deployment-architecture/deployed-mobile-detail.jpg)。

部署前真实接口预览：[中文主图](./acceptance-screenshots/deployment-architecture/deployment-desktop.jpg) · [英文主图](./acceptance-screenshots/deployment-architecture/deployment-english.jpg) · [390px 嵌套详情](./acceptance-screenshots/deployment-architecture/deployment-mobile-detail.jpg)。以上均为当前实现读取既有演示项目的真实接口，不是原型固定场景。
