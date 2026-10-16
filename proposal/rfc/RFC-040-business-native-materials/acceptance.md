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

## 仍未完成

- 精确提交 SHA 的 hosted `gate`、`e2e`。
- 新镜像部署与新数据库迁移，以及双协议 CLI、MCP、插件、权限、内部子代理和重启的本机联合实机验收。
- AW RFC-370 原生材料编译、私有 Git 凭据助手及其发布契约接线仍属 AW 后续工作，不以 CS 单侧测试替代。

本机 AW 正式 `agent-workflow.cs.localhost` 保留运行。此前只读复查 blue／green 均 Running、Ready、0 restarts；本轮尚未替换、停止或删除它们。全局 RFC 状态保持 **In Progress**。
