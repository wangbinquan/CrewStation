# RFC-036 部署架构资源视图：实现与验收

状态：In Progress · 2026-10-15。作者明确要求「你来按照设计完成RFC」，按已提供的部署架构原型实施。本文仅记录本次追加；旧资源中心、聚合修正和实际调额的验收分别保留在原文档中。

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

- 控制台完整层 `bun run test:console --cover`：1184 pass／0 fail、8000 断言、183 文件。之后补齐英文单位与关系标签、拆开类型循环依赖；最终针对性三文件 18 pass／0 fail、145 断言，生产 Vite 构建通过。
- 组合五文件回归 39 pass／0 fail、370 断言，覆盖双端路由、79 行权限末行与分页上下文、嵌套 Esc／焦点、四视角、业务任务隔离、共享生产数据、不可变 UID、68 个部署对象分页、部分失败和拒绝访问。
- 当前主目录静态检查曾发现本批两文件类型循环，已拆到独立类型文件；下一轮结构检查通过。全目录 lint 的八处错误来自 `.local/cli-bot-acceptance/` 的历史未入库验收脚本，原文件保持；本批作用域 lint 与 console 类型检查通过。
- 冻结 25 个源码／测试文件，指纹保存于 `.local/rfc036-acceptance/candidate.json`。完整 Linux 镜像包含同一共享候选的全部源码和测试，仅按构建忽略规则排除 `.git`、生成目录、依赖缓存和本地凭据；没有删改共享在制品。
- 单次完整门禁：Bun 1.3.13、非 root、UTF-8、独立 PostgreSQL 17.11，`max_prepared_transactions=10`；镜像 `sha256:a5e7b1bf0dc7c1593d06c93ad44abb9c47d8c0b89329f6e8cc4987af67682186`。运行结果待自然结束，原始日志为 `.local/rfc036-acceptance/full-check.log`。

## 真实接口与浏览器

本批浏览器使用现有 dev-developer 身份。项目“演示数字人” `01a0c12a-de0c-7009-83f4-d05f95c9a0a2`，namespace `cs-demo`。本地最终 Vite 构建通过只允许 GET／HEAD 的预览代理访问现有真实平台；不是固定 API 夹具，也尚不算正式部署后的验收。

- 实际读到 82 项已有能力、22 个资源中心来源、服务槽、Deployment／Pod、生产数据库与已声明 gitlab.push 事件。`demo-blue` 聚合两个运行对象，并关联十个原始资源条目。
- 顶部按真实额度显示 CPU requests 0.5／8 核、内存 requests 0.5／16 GiB、Pod 1／30、PVC 0／20。生产库和逻辑访问入口在命名空间边界外。
- 从部署对象权限列表按 service-plan 筛选，进入 standard-small 的统一详情；原资源 UUID、CPU 500m、内存 512Mi、副本上限 3 与实际回执一致。
- 390×844 的内层详情 x=16、y=16、width=358、height=812；Esc 只关闭内层，保留 service-plan 筛选，焦点回到“详情”。320×844 的外层弹窗 width=288，document.scrollWidth=320，无横向溢出。最终构建再验 390px，第二次 Esc 关闭对象后焦点返回 demo-blue 原列表入口。
- 桌面 1440px 中文／英文主图实看；英文配额单位 cores/items 和 Event subscription 正确，原始资源名和后端原因保留原文。临时语言和视口设置已还原。
- 当前真实身份是开发者；管理员与负责人操作由既有回归及本次隔离路由用例验证。没有把隔离角色或历史真实调额计为本次真实审批，没有提交授权、调额、发布或创建工作负载。

本地截图和原始只读快照保存在 `.local/rfc036-acceptance/`。正式部署与准确 SHA CI 的回执在完成后追加。

## 页面证据

[真实部署主图](./acceptance-screenshots/deployment-architecture/deployment-desktop.jpg) · [英文主图](./acceptance-screenshots/deployment-architecture/deployment-english.jpg) · [390px 嵌套详情](./acceptance-screenshots/deployment-architecture/deployment-mobile-detail.jpg)。以上均为当前实现读取既有演示项目的真实接口，不是原型固定场景。
