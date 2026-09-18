# RFC-004｜实施计划

> **Superseded · 2026-09-18 被 [RFC-006](../RFC-006-unified-compute-profile/plan.md) 取代**；下表 AR 不再执行，验收改按 RFC-006 的 CP 表。以下为历史记录。
>
> 2026-09-14 作者批准；2026-09-16 作者以会话目标“完整落地RFC-004并提交上库”要求实施，覆盖原排期。T1–T7、T9 已有自动化证据并提交 main；T8 的实机验收与 AR 逐项实机证据尚未执行，见下方实施说明。

## 任务

| 编号 | 工作 | 依赖 | 完成证据 |
|---|---|---|---|
| T1 | 确认两个启动前动作、路径／环境输出、失败／重试、生效语义与模块边界 | 作者批准 RFC／ADR | 已完成：2026-09-14 作者批准 RFC-004，并要求 RFC-003 完结后实施 |
| T2 | Hook 步骤／不可变版本／凭据与验证记录，管理员 API 和 CAS | T1、RFC-003 Done | 已完成（2026-09-16）：`packages/contracts/taskrunner/beforeStart*.ts`、`packages/contracts/api/agentRuntime/*`、`modules/agent-runtime/**`（PostgreSQL 表、CAS、凭据 keep／replace／clear、管理员路由）；`modules/agent-runtime/tests/*.test.ts`、`packages/contracts/taskrunner/beforeStart.test.ts` |
| T3 | 算力档位绑定和就绪投影、统一解析端口 | T2 | 已完成：`modules/project` 档位 `runtimeConfigId`／`revision`＋`expectedRevision` CAS、租户投影 `{mode, available, reason}`；`modules/platform/wiring.ts` 的 `computeCatalogFor` 统一解析；`modules/project/tests/computeProfileRuntime.test.ts` |
| T4 | Runner beforeStart 执行器、文件注入、脚本进程组与环境输出、CLI 合成；任务镜像补 Python 3 | T2 | 已完成：`runtimes/task/src/beforeStart/*`、`packages/agent-drivers`（Claude `--settings` 合成、OpenCode `OPENCODE_CONFIG` 合成）、`runtimes/task/Dockerfile` 加 `python3`；`runtimes/task/tests/beforeStart.test.ts`（本机真实 bash／python3／bun）、`managedStart.test.ts`、`packages/agent-drivers/tests/managedConfig.test.ts`。镜像尚未重建 |
| T5 | 原生／历史对话／业务子任务快照与幂等 | T3、T4 | 已完成：dev-session 原生／历史对话与 business-task 子任务在受理时固定版本、按 `processAttemptId` 幂等；session 在写入前拒绝不支持的 Runner；`modules/dev-session/tests/managedRuntimeStart.test.ts`、`modules/business-task/tests`、`modules/session/tests/runtimeNegotiation.test.ts` |
| T6 | 管理员完整 Hook 预演与实际模型检查 | T4、T5 | 代码完成：task-runtime `runtime-check` 任务（平台命名空间、哨兵项目准入上限 4、oneshot Agent、固定回文标记、镜像 digest／CLI 版本／解释器上下文、unknown 语义）；`modules/task-runtime/tests/runtimeCheck.test.ts` 以假集群／假 Runner 验证。真实模型检查未在集群执行 |
| T7 | 管理空间双页签、步骤列表／文件／脚本编辑／排序、检查与启用、租户准备进度 | T3、T6 | 代码完成：`apps/console/src/features/admin/components/runtime/*`、`AdminComputePage` 双页签（查询串直达）、档位绑定运行环境与就绪列、租户面不可用档位禁选与“环境准备中／失败”状态；`apps/console/src/tests/runtimeConfigEditor.test.tsx`。多分辨率／明暗主题／键盘实机验收未做 |
| T8 | 旧配置接续、文档和完整实机验收 | T5、T7 | 部分：旧模式（`CS_AGENT_ENV_SECRET`）保留为未绑定档位的兼容路径并有回归测试；文档已更新。实机验收（下表 AR 的“实机”列）未执行 |
| T9 | 精确提交 main、本地完整门禁、推送与精确 SHA CI | T8 | 已完成（代码部分）：2026-09-16 本地 `bun run check` 1325 pass／4 skip／0 fail 后按精确路径提交 `1562ccc16af579feffd12ed5fa0c07d67c2d6eef` 并推送，[CI 35053685096](https://github.com/wangbinquan/CrewStation/actions/runs/35053685096) 成功；T8 实机验收完成后需再次经此步 |

T2–T8 按可验证小批推进；新增生产代码必须带测试，bug 先复现。没有独立的长期配置迁移双轨：旧模式只保留兼容入口，托管路径的领域状态与版本归 agent-runtime。

启动条件是 RFC-003 原定实现、52 项验收、提交上库与最终 CI 均完成并正式标记 Done；不能因 RFC-004 已获批而跳过或缩减 RFC-003 的范围。条件满足后直接按本批准启动，无需再次索要同一方案授权。

## 验收案例

| 编号 | 场景 | 必须证明 |
|---|---|---|
| AR-01 | 管理员新建两类 CLI 运行环境 | 预设、文件路径与原生模板、脚本步骤、草稿保存和重读 |
| AR-02 | 普通租户进入开发 | 只选档位；不要求填写模型连接或登录配置 |
| AR-03 | 两种 CLI 真实执行 | 都经过 beforeStart 完成真实模型轮次，文件已写／脚本退出 0／TUI 启动均不能替代 |
| AR-04 | 同容器两个运行配置 | 网关／模型／环境与配置目录各自正确，输入和事件独立 |
| AR-05 | 已有容器内新增 CLI | 自动使用最新启用版本，不要求重建容器 |
| AR-06 | 已运行 Agent 遇到配置更新 | 保持原快照；显示版本，未经明确操作不结束／重开 |
| AR-07 | 保存、验证与启用 | 三种状态明确；编辑后旧验证结果无法启用新版本 |
| AR-08 | 停用与版本回退 | 新启动拒绝，已有执行不被中止；回退只影响新受理 |
| AR-09 | API Key／Token 保留、替换、清除 | 明文不进入 GET、事件、日志、仓库或租户表单；失败不误清旧值 |
| AR-10 | 错误连接／认证／模型／JSON | 准确阶段与字段错误，草稿保留；不回退到未指定模型 |
| AR-11 | 并发编辑、双击、断线与迟到回执 | 固定 revision／requestId；不重复检查或启动，不丢草稿 |
| AR-12 | 业务子任务与历史对话 | 使用同一解析入口，真实执行有配置版本记录 |
| AR-13 | 旧档位、旧 Secret 与旧 Runner | 兼容模式明确；托管命令不发给不支持的 Runner，不动原会话 |
| AR-14 | 权限与配置来源 | 管理员可管理、租户不能写；保留字段冲突可解释 |
| AR-15 | 真正的运行环境检查 | 绑定镜像 digest、CLI 版本与目标出口；不能拿目录响应代替推理结果 |
| AR-16 | 管理 UX | 1280／1024／768／390／320、明暗主题、键盘与错误焦点可用 |
| AR-17 | 文件路径与变量 | 自定义绝对路径／Agent 私有目录都真实加载；未定义变量、非法 JSON／JSONC、无权限写入定位步骤 |
| AR-18 | Shell／Python／JavaScript 脚本 | 三种真实解释器按所选版本执行；自定义解释器缺失明确失败，不静默切换解释器 |
| AR-19 | 初始化环境传递 | 三种语言写 CS_HOOK_ENV_OUT 后后续步骤和 CLI 得到值；普通 stdout 和 export 不被误当输出协议 |
| AR-20 | 步骤组合与排序 | file→script、script→file、仅文件、仅脚本；顺序改变实际结果并使旧检查失效 |
| AR-21 | 失败、超时与取消 | 中途失败阻断后续步骤和 CLI；终止整个脚本进程组，不留子进程；原 Agent 继续运行 |
| AR-22 | Hook 重试与未知结果 | 双击／WS 重发不重复脚本；Runner 丢失后 unknown 不伪称成功／自动重跑；显式重试创建新 attempt |
| AR-23 | 同容器路径与并发 | 两份私有配置互不覆盖，共享固定路径的不同活跃配置报冲突；排队不暂停已运行 Agent，写失败保留原文件 |
| AR-24 | 租户启动生命周期 | 明确“环境准备中／步骤失败／CLI 在线／模型轮次状态”；切页、重连、控制权切换不执行 Hook |
| AR-25 | CLI 配置合成与动态认证 | OpenCode provider options 保留；Claude --settings 与平台观测合成；凭据脚本结果生效但不误称已有 OAuth 续期产品能力 |

所有 AR 条目保留实际账号／角色、配置 revision、档位 revision、Agent／taskId、CLI 版本、镜像 digest 与结果。RFC-003 的 UI 验收继续单独登记。

## 实施说明（2026-09-16）

作者以会话目标“完整落地RFC-004并提交上库”要求立即实施，覆盖原“RFC-003 完结后启动”的排期。本批落地的是生产代码、自动化测试与文档；下表的“实机”列全部为未执行，不据自动化结果宣称任何 AR 已在集群通过。

| 编号 | 自动化证据（本机 `bun run check` 内） | 实机 |
|---|---|---|
| AR-01 | `modules/agent-runtime/tests/agentRuntimeModule.test.ts`（两类预设建档、草稿保存与重读）；`apps/console/src/tests/runtimeConfigEditor.test.tsx`（假后端的编辑、保存旅程） | 未执行 |
| AR-02 | 租户面只选档位：`StartAgentForm`／`NativeToolbar` 读取 `{mode, available, reason}` 投影；`apps/console/src/tests/historicalAgentCreation.test.tsx` 回归 | 未执行 |
| AR-03 | 无自动化替代（真实模型轮次只能实机） | 未执行 |
| AR-04 | 每个 Agent 私有 HOME／运行目录与共享路径登记：`runtimes/task/tests/beforeStart.test.ts`；CLI 配置合成：`packages/agent-drivers/tests/managedConfig.test.ts` | 未执行 |
| AR-05、AR-06 | 受理时解析已启用版本并固定到记录、启动命令携带材料：`modules/dev-session/tests/managedRuntimeStart.test.ts`、`modules/business-task/tests` | 未执行 |
| AR-07、AR-08 | 状态机、启用只接受同版本同内容哈希的通过检查、停用保留启用版本且新解析被拒：`agentRuntimeModule.test.ts` | 未执行 |
| AR-09 | keep／replace／clear 与 GET 不含原值：`agentRuntimeModule.test.ts`（HTTP 响应断言） | 未执行 |
| AR-10 | 版本内容逐字段校验：`modules/agent-runtime/tests/revisionValidation.test.ts`；模板变量／JSON／路径错误定位步骤：`beforeStart.test.ts` | 未执行 |
| AR-11 | 草稿 CAS 冲突、`clientRequestId` 幂等检查：`agentRuntimeModule.test.ts`；冲突保留草稿：`runtimeConfigEditor.test.tsx` | 未执行 |
| AR-12 | 业务子任务与历史对话经同一 `computeCatalog` 解析并记录版本：`modules/business-task/tests`、`managedRuntimeStart.test.ts` | 未执行 |
| AR-13 | 未绑定档位保持部署配置模式：`modules/project/tests/computeProfileRuntime.test.ts`；不支持的 Runner 在写入前被拒：`modules/session/tests/runtimeNegotiation.test.ts` | 未执行 |
| AR-14 | 管理员接口逐个裁定身份：`agentRuntimeModule.test.ts`；保留变量名拒绝：`revisionValidation.test.ts`、`beforeStart.test.ts` | 未执行 |
| AR-15 | 检查上下文（镜像 digest、CLI 版本、解释器）、真实回文标记判定、目录响应不算通过：`modules/task-runtime/tests/runtimeCheck.test.ts`（假集群／假 Runner） | 未执行 |
| AR-16 | 无自动化替代 | 未执行 |
| AR-17、AR-18、AR-19 | 路径规则与原子写、三种真实解释器（本机 bash／python3／bun）、自定义解释器缺失明确失败、`CS_HOOK_ENV_OUT` 传递而 stdout／export 不传递：`beforeStart.test.ts` | 未执行（镜像含 python3 尚未重建） |
| AR-20 | 内容哈希随步骤顺序变化、旧检查不可用：`agentRuntimeModule.test.ts`；file→script→file 传递：`beforeStart.test.ts` | 未执行 |
| AR-21 | 中途失败阻断后续与 CLI、进程组终止、超时取消：`beforeStart.test.ts`、`runtimes/task/tests/managedStart.test.ts` | 未执行 |
| AR-22 | 按 `processAttemptId` 幂等不重跑：`beforeStart.test.ts`；环境丢失记 unknown 不自动重跑：`runtimeCheck.test.ts` | 未执行 |
| AR-23 | 共享路径不同内容报 `file_path_in_use`、同容器串行队列：`beforeStart.test.ts` | 未执行 |
| AR-24 | `preparing` 状态与 `beforeStart` 进度事件：`managedRuntimeStart.test.ts`；租户面文案与禁用：console 测试 | 未执行 |
| AR-25 | OpenCode provider options 保留、Claude `--settings` 与平台观测合成：`managedConfig.test.ts` | 未执行（动态认证脚本仅本机脚本级验证） |

未完成项：任务镜像重建与部署、真实检查（AR-15）、两类 CLI 的真实模型轮次（AR-03）、多分辨率／主题／键盘（AR-16）以及全部 AR 的实机证据。
