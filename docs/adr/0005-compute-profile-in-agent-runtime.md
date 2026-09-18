# 0005. 算力档位归 agent-runtime，取消独立的运行环境对象

- 状态：提议
- 日期：2026-09-18
- 关联：[RFC-006](../../proposal/rfc/RFC-006-unified-compute-profile/proposal.md)；修订 [ADR-0004](0004-agent-runtime-module.md) 的职责划分

## 背景

RFC-006 按作者 2026-09-18 的裁定 C1，把运行环境并入算力档位：档位本身带协议、镜像、二进制、参数、启动前步骤、变量、凭据、模型、资源套餐，并有修订与测试记录。

现状是两处宿主：

- `modules/project`（L2）拥有 `ComputeProfile`（driver／model／taskProfile／可选 runtimeConfigId）。
- `modules/agent-runtime`（L3，ADR-0004）拥有运行环境、不可变版本、凭据、检查记录。

合并以后，对象只剩一个，必须选一个宿主。

## 决策

- `ComputeProfile` 从 `project` 移到 `agent-runtime`，后者成为档位唯一宿主。原运行环境对象、版本、草稿与启用流程删除；启动前步骤、凭据与测试记录归到档位名下。持久化仍在自有的 `agent_runtime` schema，断代重建，不迁移旧数据（RFC-006 C8）。
- `project` 只保留 ServicePlan、TaskProfile、TaskQuota。
- `agent-runtime` 继续不 import 其他模块。它需要的三件事经端口由 `platform` 回填：TaskProfile 目录（project）、发布引用查询（release）、测试执行（task-runtime）。
- release、dev-session、business-task、capabilities 取档位的端口不变，`platform` 把实现从 project 改接到 agent-runtime。
- 模块名 `agent-runtime` 与 schema 名 `agent_runtime` 不改：职责仍是「Agent 运行配置」，改名只带来路径与迁移搬家。

## 后果

- 结构文档 §5 模块表：`agent-runtime` 一行改为「算力档位（RFC-006）：协议、镜像、二进制、启动前步骤、凭据、修订、测试记录、默认与引用确认；TaskProfile 目录、发布引用与测试执行经 ports 由 platform 回填」；依赖图不新增边。
- project 的源码文件数下降；agent-runtime 的文件数在上限内重排，需要时按 `domain/profile*`、`application/profile*` 分组，不突破 20 个文件每目录。
- 不提高尺寸上限，不引入门禁例外。
- ADR-0004 中「现有算力档位继续归 project（L2），增加运行配置引用及 revision」一句由本 ADR 取代；ADR-0004 的其余决定（独立模块、一模块一 schema、检查经端口由 task-runtime 执行）继续有效。

本 ADR 与 RFC-006 一并呈作者批准；批准后状态改为「已接受」并同步结构文档。
