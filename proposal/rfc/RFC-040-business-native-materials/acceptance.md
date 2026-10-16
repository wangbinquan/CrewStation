# RFC-040 验证记录（进行中）

2026-10-15，用户明确授权“那这个RFC040你接手”。本记录只覆盖已经完成的证据，不代表 RFC Done。

## 生产实现与集中验证

基线：`2274ae0473efd8fcd5cf26af5f329a212220bca6`（共享 main，与 origin/main 同步）。生产实现与测试用例先写齐，再集中执行功能验证；测试库使用独立临时 PostgreSQL 数据库，显式 `CS_TEST_REQUIRE=database`，没有改动业务生产库。

- 原生 Agent／子代理、逐协议选项白名单、发布授权四开关、内联 MCP、完整插件树及模式／安全符号链接。
- 对象材料：preparing／ready 日志、对象固定引用、限定对象的下载授权、续发授权不改摘要、流式完整性校验与取消清理。
- 命令 Secret：冻结发布环境键、项目 Secret 版本固定、同请求及 fresh retry 不随轮换漂移、Runner 接收能力位与输出脱敏。
- 实际启动清单：Claude 根 init、OpenCode 运行时客户端观测；有界、去重、当前尝试身份、冷重放与 finalCursor，初始化失败的 unavailable 也先于最终结果持久化。
- 档位证明只按实际能力探针授予新能力位；旧请求、旧材料和未宣告新能力的 Runner 保留原有行为。

集中首轮：**81 个文件，417 项，411 pass / 6 fail**，145.10 秒。修复本人引入的 registered 状态清单持久化与原型键归一化前校验；同步新增合同对应的测试预期，并修正取消用例自身的等待时序及游标过滤断言。按影响范围复验、补充受理前清单边界和合同金样用例，复用未变化范围的通过结果。

合并各文件最后有效结果：**82 个文件，425 项，425 pass / 0 fail / 0 skip**。这是本次范围的集中验证，不是全仓或实机验收结论。原始日志：

- `/private/tmp/cs-rfc040-tests.log`、`cs-rfc040-junit.xml`
- `/private/tmp/cs-rfc040-recheck.log`、`cs-rfc040-recheck-2.log`、`cs-rfc040-recheck-3.log`
- `/private/tmp/cs-rfc040-surface-final.log`
- `/private/tmp/cs-rfc040-validation.json`：候选内容摘要、文件清单和逐项最后结果；明确记录一条用例重命名。

静态：架构检查通过；97 个改动 TypeScript 文件 lint 通过；根类型检查和 console 类型检查通过。`git diff --check` 无异常。整仓 `check:static` 的 lint 被既有 `.local/cli-bot-acceptance/` 中 8 处错误阻断（probeCurrentSession、probeNewSession、renderDeployment、renderFinalDeployment、snake-source/src/game/snake）；这些文件未改动。不能把范围 lint 通过称作整仓门禁通过。

## 本机构建

独立标签构建成功，未覆盖 dev 标签：

| 镜像 | 本地配置 ID |
| --- | --- |
| `cs-control-plane:rfc040-bdac231b68cc` | `sha256:9b4d1bbc0ca84c792966b1bbe6adbd1a1b7b0a78a81ce6d01504cd861c2a718d` |
| `cs-task-runtime:rfc040-bdac231b68cc` | `sha256:34e664fd579e25b7a9d9d8099a45e3553a0ab8fb324985bdc6360a9fa79ad458` |

构建日志：`/private/tmp/cs-rfc040-control-build.log`、`/private/tmp/cs-rfc040-runner-build.log`。以上是本地配置 ID；集群导入后的 OCI manifest digest 另行核对，不能混称。

## 准确提交与本机部署

生产实现提交：`92889e87a7be3db1cbc4f2aad8c63a85f1f577c9`，106 个精确路径。对应 [CI 38838520891](https://github.com/wangbinquan/CrewStation/actions/runs/38838520891) 九项全部成功，包括 `gate` 和 `e2e`。本地 ignored 文件 lint 的历史失败保留，不能改称原本地全量成功。

通过本机官方存储预检与不可变镜像导入后，仅升级七个后端（cs-api、cs-session、cs-controller、cs-auth、cs-events、mcp-capabilities、mcp-operations），均 Ready 1；console 保留既有版本。实际 OCI manifest：

- 控制面：`sha256:004edc4ee8e73ae03254c9d8d172e54fec601229d1481fc27798871eddccedb0`
- Runner：`sha256:b27a7fb8ebf7134c2e53585cb55248eb4d054aa5da122af6c0b6989d76da88b7`

`crewstation-rfc040-migrate-92889e87` 作业完成，新增且仅新增 `business_task/0038_material_objects.sql`（applied 1，rolesInitialized 0）；此前迁移摘要不变。镜像导入、部署前后快照及迁移证据分别在 `/private/tmp/cs-rfc040-import.log`、`cs-rfc040-targets.json`、`cs-rfc040-deploy-before.json`、`cs-rfc040-deploy.log`、`cs-rfc040-applied-migrations.txt`。节点磁盘仍紧张，未清理其他任务资源。

## OpenCode 实机验证

用户最新明确：**“不要验证claude code了，只验证opencode”**。后续只执行 OpenCode 实机验收；Claude Code 不再是本次收口条件，不宣称已实机通过。

独立隐藏档位 `01a14282-7979-7000-b517-f3d4a3207d56`（`rfc040-opencode-92889e87` r2）固定上述新 Runner，OpenCode 1.18.29、火山 AI 网关/glm-5.2。复制使用服务器端加密凭据保留能力，原 `rfc027-live-agent` 与平台默认档位未改。

真实测试 `01a14282-7a4e-7000-bfe5-90b409d97680`、任务 `01a14282-7ad9-7000-9631-9edcf03fdc6d`：真实模型轮次、events、resume、skills、MCP、nativeConfig、materialObjects 均通过。持久事件中的 `opencode-inventory` 实际观测 `crewstation-probe=connected`，三个新增能力位均为 1。结果记录 `/private/tmp/cs-rfc040-opencode-test.json`。

**保留未通过事实：systemPrompt=false。** 该 GLM 模型收到探针标记但拒绝按指令回显；原始响应保存在该任务的持久事件中。档位整体状态 passed 不表示每个可选能力通过，依赖 systemPrompt 的业务调用仍会明确被拒绝。没有篡改证明或以重测抹掉失败。

隔离项目 `rfc040-native-acceptance`（`01a1428b-7693-7000-9695-28881ae3aebc`）使用独立发布与档位继续业务 API 实机链路：完整插件树、二进制对象、模式／安全链接、local MCP、内部子代理与耐久事件。该项目最初 500m HTTP 服务滚动更新因 CPU 不足未就绪；只对该自有验收槽使用 Recreate 完成更新，再经正常 Manifest 发布切为 50m 服务规格。现有 AW 与其他项目未变。

## 业务服务身份下的完整 OpenCode 实机链路

以上隔离项目正式验收版本为 `v0.1.2`，GitLab 来源 `3619524d7fa429fa2a3f82080582ea2a62ab8698`，CS 发布 `01a1428f-eabe-7000-af4c-887037988560`。所有 `/v3` 调用均从该已登记服务 Pod 经平台网关发起，使用实际执行权租约和冻结发布合同；没有直接伪造来源身份或写业务数据库。

父任务 `01a14294-79d0-7000-b7d6-f0db13390656` 的实际证据汇总在 [OpenCode 实机证据](./opencode-live-20261015.json)：

| 旅程 | 实际结果 |
| --- | --- |
| 原生插件与对象材料 | 子任务 `01a14295-6f22-7000-8837-c05d8396f4d9` 成功；完整插件树通过相对符号链接加载依赖，读取对象文件 2,097,169 bytes 并核对 sha256，可执行脚本 mode 为 0755。对象有 material-version 固定引用，同 requestKey 重放得到相同材料，不同内容 409。 |
| 内部子 Agent | OpenCode 实际调用 `task`，`subagent_type=rfc040-helper`，返回只存在于该 Agent 正文中的随机值；仍为同一 CS 子任务内的内部委派。 |
| local／remote MCP | 子任务 `01a1429a-6033-7000-8cbe-a701b72f3d41` 成功；stdio MCP 计算注入 env 的 sha256，HTTP MCP 计算实际收到 header 的 sha256，两者均与期望一致且原值不出现在事件／结果。实际启动清单中两者均 connected。 |
| 权限与模型选项 | 插件读取实际 OpenCode 配置，报告 bash=deny、temperature=0.15、top_p=0.7；工具集中没有 bash，目标禁止文件不存在。实际 chat.params 中 topP=0.7；本 GLM 模型的温度实际采样效果未单独证明。 |
| 冷续接 | 新子任务 `01a1429c-5721-7000-a987-71630441dfb8` 在原 OpenCode Pod 退出／释放后，恢复原 session `ses_ebd69b3cdffeLzWJvzdTPtlXeb`，无工具地正确返回前轮子 Agent 的随机值。原材料摘要与档位 r2 保持；原事件完整重放。 |
| 命令 Secret | 首次命令有意 exit 7 后将项目合成 Secret 从 v1 轮换为 v2。原 requestKey 重放无重复执行；fresh retry 使用 v1，新命令使用 v2。输出分块发送原值，平台事件／结果均已脱敏；三行持久子任务数据不含任一明文，原尝试与重试 payload digest 相同，新命令不同。7 项检查通过。 |
| 取消与 fresh retry | 子任务 `01a1429f-2011-7000-a46a-c56f43f8ca5a` 产生真实 session 后取消，最终 state=cancelled／process=exited；`inventory-cancelled` 在 result 前持久输出。重试 `01a142a0-27e5-7000-8b04-e5ad4097b0f6` 成功、新 native session、attempt=2，原材料／档位保持，插件再次验证对象字节。7 项检查通过。 |
| 受理前拒绝 | 越权 model 选项、逃逸符号链接均 400，错误对象摘要 412，未授权 command env 400；没有把这些请求变成成功执行。 |

MCP／冷续接脚本 12 项、Secret 脚本 7 项、取消／fresh retry 脚本 7 项全部通过。首次插件脚本的 local MCP 断言误要求回显 env 明文，平台正确脱敏成 `***`；原失败保持，后续改用摘要完成定向实测，未更改产品脱敏行为。日志分别为 `/private/tmp/cs-rfc040-{native,extra,secret,cancel}-live.log`，原始回执为同前缀 `*-acceptance.json`，持久秘密检查为 `cs-rfc040-secret-db-proof.json`。

此处证明的是实际 OpenCode 进程退出、冷续接、取消后重试及业务事件重放；没有将其描述为完整 CS 集群灾难恢复或 AW 全链路恢复。验收项目、父卷与证据保留。

## 仍未完成

- AW RFC-370 原生材料编译、私有 Git 凭据助手及其发布契约接线仍属 AW 后续工作，不以 CS 单侧通过替代。

本机 AW 正式 `agent-workflow.cs.localhost` 保留运行。CS 部署及上述验收后再次只读核对：blue／green 均 Ready、0 restarts，Pod UID 分别仍为 `67808ecd-2cb8-418b-98f1-4e7ce338bce3` 与 `0039a97f-e2ae-4647-9913-a99b4839c1cc`。未替换、停止或删除它们。RFC 状态保持 **In Progress**。
