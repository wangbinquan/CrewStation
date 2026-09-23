# RFC-022｜实施计划

> 状态：Draft · 2026-09-23 · 三件套待作者批准；提案 §8 的 Q1–Q4 待裁定
> 配套：[提案](./proposal.md) · [技术设计](./design.md)

## 目录

- [1. 任务与依赖](#1-任务与依赖)
- [2. 验收清单](#2-验收清单)
- [3. 交付门禁](#3-交付门禁)

## 1. 任务与依赖

| 任务 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| RFC-022-T1 | 作者两轮裁定 D1–D8；三件套落档并登记 | 作者 | 落档完成（2026-09-23），待批准与 Q1–Q4 |
| RFC-022-T2 | 契约：`api/progress/startupProgress.ts`（三个 Schema、`currentStage`）；`NativeTerminalDto`、`DevSessionDto` 的 `startup`；`ProfileTestStage` 改为公共阶段的扩展、旧种类可读；Schema 用例；`contracts:lock` 确认不涉及业务契约面 | T1 | 未开始 |
| RFC-022-T3 | `packages/k8s/podStartup.ts`：从 Pod 与 Events 读出调度、容器起止、镜像拉取；夹具用例 | T1 | 未开始 |
| RFC-022-T4 | task-runtime 存储与推导：`startup` 列、迁移 `0009_environment_startup.sql` 与迁移锁、部分索引、仓储映射；`domain/podFailures.ts` 更名 `domain/podStartup.ts` 并加推导；设计 §3.2 的全部写入点；环境视图带 `startup`；单元与模块用例 | T2、T3 | 未开始 |
| RFC-022-T5 | task-runtime 观测与留日志：`observeStartupUseCase`、对账循环体提成 `judgeEnvironment`、每秒计时器；适配器 `observeStartup` 与读日志尾部；模块接口 `captureStartupLog`；判定失败时写 `logTail`；用例（含原对账用例全部照过） | T4 | 未开始 |
| RFC-022-T6 | dev-session：`composeCliStartup`；`read()` 组合与冻结进 `execution` 文档；失败先留日志再回收；`EnvironmentView.startup` 与开发会话 DTO；单元与模块用例 | T4、T5 | 未开始 |
| RFC-022-T7 | `runtimes/task`：`claim` 在 `starting` 接受，`input`／`resize` 仍拒绝；三条启动失败路径释放控制计时器；用例；构建新底座镜像 | T1 | 未开始 |
| RFC-022-T8 | 工作台公共组件：`shared/ui/progress/`（`StageProgress`、样式、`stageProgressView`）与应用级中英文案；用例 | T2 | 未开始 |
| RFC-022-T9 | 档位测试迁移：执行器改读环境阶段、`agent` 段、结论归类；`ProfileTestPanel` 换公共组件并保留定位、退出码、输出尾部；用例（既有用例改期望） | T5、T8 | 未开始 |
| RFC-022-T10 | 工作台 CLI：步骤条覆盖层、状态条、标签头「x/6」、失败时的重试（按 Q2）与日志展开、启动阶段就失败时的冻结步骤条、启动期间每秒刷新；用例 | T6、T8 | 未开始 |
| RFC-022-T11 | 工作台创建者自动取得：本窗口登记、启动中提前取得与旧 Runner 回退、焦点规则、`resize` 延后；用例 | T7、T10 | 未开始 |
| RFC-022-T12 | 工作台开发会话：创建与重建的步骤条、页头芯片、重试（按 Q1）、启动期间每秒刷新；用例 | T4、T8 | 未开始 |
| RFC-022-T13 | `crewstation session open／show` 打印启动过程；用例 | T2 | 未开始 |
| RFC-022-T14 | 按 Q3、Q4 的裁定补做（就绪后查看启动过程；运维 MCP 工具）或记为不做 | Q3、Q4 | 未开始 |
| RFC-022-T15 | 本地 gate、改动行防护、提交推送、精确 SHA CI 六项 | T2–T14 | 未开始 |
| RFC-022-T16 | 本机部署（控制面、工作台、任务底座镜像；默认档位用新底座重建镜像并另存修订）与实机验收 SP-01…SP-13，写 `acceptance.md` | T15 | 未开始 |
| RFC-022-T17 | 回填：RFC-003、RFC-006、RFC-008 加修订记录；基线 Design §5 增加启动进度，Plan 新增验收编号（回填时分配）；README、STATE.md 收口 | T16 | 未开始 |

## 2. 验收清单

对应提案 §10。实机时每项记录身份、页面、接口返回与 `kubectl` 核对结果，写进 `acceptance.md`。

| 编号 | 证据 |
|---|---|
| SP-01 | 新开 CLI 的步骤条逐段截图；名册接口返回的 `startup`（各段起止时间单调、首尾相接）；刷新后与另一名成员看到的截图一致 |
| SP-02 | 验收专用的超大套餐：`kubectl describe pod` 的调度事件与页面上的等待原因；删掉节点镜像缓存后的拉取细节与用时；缓存命中时的「节点上已有」 |
| SP-03 | 带两个启动前步骤的档位与没有步骤的档位各开一次：x/y 与「跳过」的截图 |
| SP-04 | 两个身份、三个窗口：创建者窗口不点击即可输入（录屏或逐帧截图、终端首帧时间）；其他两个窗口的状态条 |
| SP-05 | 三个验收专用档位（镜像不存在、启动前脚本失败、二进制路径错误）各开一次：停住的段、原因、`logTail`；按 Q2 重试的结果；验收后删掉这三个档位 |
| SP-06 | 在验收专用项目开始开发：五段截图、页头芯片、就绪后恢复的空 CLI 区域 |
| SP-07 | 同一项目重建：五段截图，第二段为「替换旧容器」 |
| SP-08 | 用不存在的分支开始开发：停在「检出代码」，`logTail` 里 git 报错且令牌显示为 `***`；按 Q1 重试的结果 |
| SP-09 | 保存一次档位触发测试：步骤条截图；打开一条升级前的测试记录 |
| SP-10 | `crewstation session show <项目>` 的输出 |
| SP-11 | `stageProgressView` 的偏差用例（±30 秒） |
| SP-12 | 用旧底座镜像的档位开 CLI：浏览器控制台无报错，进程拉起后取得成功 |
| SP-13 | 启动中关闭标签：名册里的 `startup.state` 为 `cancelled`，页面没有失败提示 |
| SP-14 | `bun run check`、`test:patch`、CI 运行号 |

## 3. 交付门禁

- 每个任务与它的用例在同一笔提交；`bun run check` 通过才提交；按显式路径 `git add` 与 `git commit --`。
- 共享工作区上另有会话正在改 `packages/contracts`（RFC-021 的 `release.ts`、`project.ts`、`index.ts` 等尚未提交）。本 RFC 也要改 `packages/contracts/index.ts`：只提交自己的那一行导出，不带上别人的改动；提交前核对依赖新契约的前端与后端一起到位。
- 迁移用 `bun run migrations:lock <文件>` 只锁自己的那一个；契约改动后跑 `bun run contracts:lock`。
- 部署前看节点磁盘；控制面、工作台、任务底座镜像逐个 `ctr import`；部署前与正在部署的其他会话对齐顺序（cs-api 先于工作台）；部署后 `crictl rmi` 旧镜像。
- 默认档位换新底座镜像要重建档位镜像并另存修订，保存会自动跑一次档位测试（含一次真实模型轮次）；在 STATE.md 记下修订号。
- 验收用的超大套餐、三个故障档位、不存在的分支都放在验收专用项目里，验收后删除；临时调整的并发额度事后恢复原值并记录。
- 不改其他成员已开的 CLI 与开发会话：只看，不点。
