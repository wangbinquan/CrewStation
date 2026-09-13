# RFC-003｜验收证据核对

> 2026-09-14；代码基准为 `c8e4894a4843ec20656048a5aae6b15aaad84359` 加本文件所在提交的预览故障恢复改动。任务和标准沿用 [plan.md](plan.md)，没有删减范围。

## 1. 判据和环境

本表区分源码／自动验证、隔离原生进程、历史浏览器记录和当前完整实机旅程。自动测试覆盖一条接口或路由，不等于使用者在当前部署完成整条旅程。以下 52 项均尚未取得完整终态证明；不把有测试文件或一个绿门禁计算为 52 项验收通过。

本轮核实本地 main 包含九笔尚未发布的提交，基准为 `c8e4894`，远端为 `be8f4cc8923657f354a26ea890857b79faa4d323`，两者为 0／9；本文件所在候选另计。最后已发布的精确 SHA CI 是 [34763312138](https://github.com/wangbinquan/CrewStation/actions/runs/34763312138)，不覆盖这些未发布内容。候选门禁与源码一致性结果见 [implementation.md](implementation.md) 第三十八批。

只读查询的 Kubernetes 上下文为 `docker-desktop`，`crewstation-system` 的 console、API、auth、controller、session、events 和两个 MCP 均为 1／1 就绪。console 使用 `cs-console:dev`，控制面使用 `cs-control-plane:dev`；可变标签与就绪副本数不能证明运行的是本次源码，也不能替代发布后的 UI 验收。

前次 CUA 清单读取超时仍未获得新的可用浏览器证据。本轮没有再次执行相同失败的浏览器动作。共享服务更新、专用项目首次生产切流与 main 推送的自动审批拒绝仍有效，未重试或改变执行方式绕过。已有专用 QA 会话与未提交比较文件继续保留。恢复验证须使用实际候选镜像和可用浏览器，记录账号／角色、项目、taskId、分支、SHA、tag、releaseId、来源、尺寸与结果。

## 2. 当前可追溯证据

- E1 项目分页与主动作：[项目页面回归](../../../apps/console/src/tests/projectSummaryPages.test.tsx)、[授权分页](../../../modules/project/tests/projectPages.test.ts)，实际列表／概览根据独立来源选择动作；门禁不包含多角色真实浏览器搜索旅程。
- E2 原生 CLI 与布局：[窗口交互](../../../apps/console/src/tests/nativeWorkspace.test.tsx)、[附着和 detach](../../../apps/console/src/tests/nativeTerminalAttachment.test.ts)、[个人布局](../../../apps/console/src/tests/workspaceLayout.test.ts)、[后端名册](../../../modules/dev-session/tests/nativeTerminals.test.ts)、[原生进程证据](native-activity-evidence.md)。隔离真实 CLI 使用脚本化模型响应，不能当作共享集群外部模型会话。
- E3 预览／编辑器：[预览状态](../../../apps/console/src/tests/previewStatus.test.tsx)、[故障到日志](../../../apps/console/src/tests/previewRecovery.test.tsx)、[编辑器草稿](../../../apps/console/src/tests/editorWorkspace.test.tsx)、[文件并发](../../../apps/console/src/tests/fileEditor.test.tsx)、[真实 Runner 预览进程](../../../runtimes/task/tests/runnerLifecycle.test.ts)。Runner 用例真实启动预览服务，UI 路由用例替代 HTTP／WS 边界，二者尚未组成当前部署的完整旅程。
- E4 工作树和来源：[预检](../../../modules/dev-session/tests/workspacePreflight.test.ts)、[开发地址与文件入口](../../../apps/console/src/tests/developmentLocation.test.tsx)、[真实 Git 比较](../../../runtimes/task/tests/workspaceComparison.test.ts)、[领域比较](../../../modules/dev-session/tests/versionComparison.test.ts)、[比较界面](../../../apps/console/src/tests/versionComparisonView.test.tsx)。真实 QA 文件及取消释放的历史浏览器证据在 implementation 第二批。
- E5 发布与上线：[来源向导](../../../apps/console/src/tests/publishWizard.test.tsx)、[双版本确认与回退](../../../apps/console/src/tests/releaseDelivery.test.tsx)、[并发裁定](../../../modules/release/tests/trafficConfirmation.test.ts)、[发布并发](../../../modules/release/tests/publishConcurrency.test.ts)。故障、错回执、在途重复和迟到结果均有断言；不能由此宣称完成生产切流。
- E6 诊断：[日志／订阅／trace 定位](../../../apps/console/src/tests/projectNavigation.test.tsx)、[告警及订阅](../../../apps/console/src/tests/alerts.test.tsx)。日志源仍是有界尾部，告警订阅保存不等于真实通知送达。
- E7 能力消费与试调：[申请](../../../apps/console/src/tests/catalogConsumption.test.tsx)、[试调表单](../../../apps/console/src/tests/apiInvocationForm.test.tsx)、[实际 Swagger Execute](../../../apps/console/src/tests/swaggerApiInvocation.test.tsx)、[Runner 调用](../../../runtimes/task/tests/apiInvocation.test.ts)、[跨副本通道](../../../modules/session/tests/apiInvocationDispatch.test.ts)。当前服务身份贯通共享网关的 J5 仍待实机证明。
- E8 设置与市场：[成员](../../../apps/console/src/tests/projectMembers.test.tsx)、[配置](../../../apps/console/src/tests/configForms.test.tsx)、[生效影响](../../../apps/console/src/tests/configImpact.test.tsx)、[市场](../../../apps/console/src/tests/appMarket.test.tsx)、[可见性草稿](../../../apps/console/src/tests/visibilitySettings.test.tsx)、[后端范围裁定](../../../modules/project/tests/appVisibility.test.ts)、[市场聚合](../../../modules/capabilities/tests/marketApps.test.ts)。范围、权限、缓存和并发自动验证不替代真实身份切换。
- E9 管理空间：[创建](../../../apps/console/src/tests/projectCreation.test.tsx)、[管理项目路径](../../../apps/console/src/tests/adminProjectSpace.test.tsx)、[管理总览／目录](../../../apps/console/src/tests/adminDirectory.test.tsx)、[审批意见](../../../apps/console/src/tests/adminRequestPages.test.tsx)、[调用方分页](../../../apps/console/src/tests/catalogCallerPicker.test.tsx)。真实开通／发布整链路仍缺当前候选的浏览器记录。
- E10 后台状态：[动态菜单](../../../apps/console/src/tests/agentActivityMenu.test.tsx)、[个人状态](../../../apps/console/src/tests/agentActivityStore.test.ts)、[完整定位](../../../apps/console/src/tests/agentActivityTarget.test.tsx)、[事件投影](../../../modules/dev-session/tests/nativeActivityProjection.test.ts)、[个人持久化](../../../modules/dev-session/tests/nativeActivityPersistence.test.ts)。两种原生事件来源另见 native-activity-evidence，不能把菜单夹具等同于双真实 CLI 同时运行。
- E11 布局与品牌：[分屏键盘](../../../apps/console/src/tests/splitGrid.test.tsx)、[品牌组件](../../../apps/console/src/tests/brand.test.tsx)、[品牌原稿](brand-design.md)。implementation 第三、六、十一至十四批有历史真实／隔离浏览器记录；没有本次全部页面在五种尺寸、两主题下的统一测量。

## 3. UX-AT-01–52 逐项结论

下表“现有证据”只指向已实现路径及对应自动／历史证据；“仍需证明”是该项未关闭的具体原因。

| 编号 | 现有证据 | 仍需证明 |
|---|---|---|
| UX-AT-01 | E1，按名称／slug、状态与负责人查询，现有会话主动作 | 当前部署中实际成员搜索并进入原会话 |
| UX-AT-02 | E2、E9，原生单窗及创建／开通状态 | 从首次开通、选分支到真实 CLI 的完整浏览器链路 |
| UX-AT-03 | E2，输入／控制按 terminalId，窗口布局和独立结束 | 同一共享会话中的两个真实 CLI 同时输入和执行 |
| UX-AT-04 | E2、E3，切视图只 detach、草稿保留 | 实际 CLI 输入状态经预览／代码往返仍完整 |
| UX-AT-05 | E3，崩溃可编辑、具名日志、重启单次和错误保留 | 当前预览服务崩溃后从界面定位真实日志并修复重启 |
| UX-AT-06 | E3，expectedVersion 冲突、取消及失败保留 | 真实 Agent 和编辑器修改同文件的完整交互 |
| UX-AT-07 | E4、E5，dirty 阻止发布并定位原会话文件 | 实机生成改动、自行提交、重新检查和发布 |
| UX-AT-08 | E5，远端来源不依赖会话，精确 SHA 贯通 | 无开发会话时实际远端分支发布成功 |
| UX-AT-09 | E5，202／发布阶段／就绪地址分开 | 真实构建部署完成后以测试者打开精确版本 |
| UX-AT-10 | E5，当前→目标两版本确认 | 经授权实际切到生产并核对正式路由和版本 |
| UX-AT-11 | E5，仍部署的候选及拒绝／失败恢复 | 实际回退和不能回退两种旅程 |
| UX-AT-12 | E5，旧版本确认失效、不自动重发 | 两位负责人实际先后切流的冲突恢复 |
| UX-AT-13 | E5、E6，migration＋releaseId 精确查询 | 本次真实迁移失败记录与对应日志链路 |
| UX-AT-14 | E6，订阅／trace 上下文和诊断入口 | 真实死信投递、重试与结果核对 |
| UX-AT-15 | E7，实际 Swagger 控件、结构化通道及响应 | 浏览器经开发容器和共享网关完成已授权 API 调用 |
| UX-AT-16 | E7、E9，申请／审批／拒绝材料与重读 | 实际申请人和管理员前后切换后的授权结果 |
| UX-AT-17 | E8，精确查找、高级 ID、成员角色及错误恢复 | 实际负责人添加注册成员并核对成员访问 |
| UX-AT-18 | E8，约束、两份草稿、Secret 不预填和生效反馈 | 开发／生产配置实际保存、重新读取及运行版本核对 |
| UX-AT-19 | E4，真实 QA 未提交清单与取消记录、自动未推送清单 | 当前候选界面中的真实未推送提交与取消保留 |
| UX-AT-20 | E9、E5，管理空间路径和开通恢复 | 创建接入容器→开发→发布→返回的实机全程 |
| UX-AT-21 | E1、E8、E9，无项目、筛空、失败有独立断言 | 在当前浏览器逐一观察三类状态和恢复 |
| UX-AT-22 | E7–E9，现有守卫和角色动作覆盖 | 开发者、负责人、测试者、管理员四个真实身份逐页验证 |
| UX-AT-23 | E2、E5、E10，重连、原请求 ID 与迟到回复 | 真实断线后重新进入，确认没有重复进程和发布 |
| UX-AT-24 | E4、E6、E9，真实路由与浏览器历史适配器回归 | 实浏览器旧链接、返回和两空间往返 |
| UX-AT-25 | E11，部分旧尺寸记录与内部滚动 CSS | 当前全部关键页面在 1280×720、1024、768、390、320 下量测 |
| UX-AT-26 | E8、E11，字段／错误关联、页签与分屏键盘断言 | 实浏览器明暗主题、焦点可见与全程键盘操作 |
| UX-AT-27 | E1、E9，当前页有界聚合、独立失败 | 实际多项目列表的请求范围及部分故障恢复 |
| UX-AT-28 | E2，单次启动、原 UUID 重试和已有布局保留 | 已有真实 CLI 执行中另一个启动失败的界面恢复 |
| UX-AT-29 | E2，隔离真实两种 CLI 及 Linux PTY 证据 | 当前共享工作台完整 TUI／resize／Ctrl+C／独立结束 |
| UX-AT-30 | E4，真实 Git 各关系、未知与部署来源 | 当前容器 HEAD 对实际生产 releaseId／SHA 的界面核对 |
| UX-AT-31 | E4、E5，源改变与切流后比较失效 | 另一使用者实际切流／回退时当前差异及时更新 |
| UX-AT-32 | E4，真实 Git 文件种类、patch、截断与独立计数 | 当前浏览器逐类比对真实文件内容 |
| UX-AT-33 | E3、E4，真实预览进程和保存／比较各自自动证据 | 真实 Agent 改文件后观察 HMR／重载，生产版本保持原值 |
| UX-AT-34 | E2，detach、名册、重连与旧 Runner 状态 | 关闭浏览器／返回与专用容器重建的真实恢复旅程 |
| UX-AT-35 | E11，历史隔离四窗可见记录 | 当前 1280×720 首窗 ≤210px、四窗至少六行输出和输入完整的量测 |
| UX-AT-36 | E2、E4，新页签、命名／关闭、放回与 URL 接续 | 两个实际 CLI 带输入、输出和后台状态经历这些操作 |
| UX-AT-37 | E2、E11，比例、顺序、键盘、跨页签与持久化 | 真实终端 resize、拖动和窄屏操作的视觉及进程核对 |
| UX-AT-38 | E8 与数据访问表单回归，三模式并存、期限、审批／撤销 | 真实角色申请／审批；分别记录授权、凭据和应用实际选用，未知仍如实呈现 |
| UX-AT-39 | E10，菜单／页签未读、定位与不抢输入的历史隔离记录 | 两种真实 CLI 后台完成，经发布／预览后定位正确轮次 |
| UX-AT-40 | E2、E10，原生问题事件与查看不解决 | 实际后台提问、显式应答与失效请求交互 |
| UX-AT-41 | E2、E10，原生轮次、取消和进程退出的独立证据 | 当前工作台完整新轮次／中断／退出操作 |
| UX-AT-42 | E10，重复、乱序、源降级、补发与持久化去重 | 实际断线和通道不可用时前端通知及恢复 |
| UX-AT-43 | E2、E10，个人布局／已读隔离和隐藏窗口定位 | 两位实际成员同时查看且互不清除对方未读 |
| UX-AT-44 | E7、E9，消费入口与管理供给分离 | 四类真实使用者的入口检查及管理员接入全旅程 |
| UX-AT-45 | E8，三种范围的服务端过滤及市场内部数据边界 | 非成员实际搜索多项获准应用及看不到隐藏项 |
| UX-AT-46 | E8，默认范围、名单去重／不存在、取消／保存 | 实际负责人保存三种范围并切换身份观察结果 |
| UX-AT-47 | E8，列表／详情一致裁定与撤销缓存回归 | 成员和指定名单变化后的真实多账号访问 |
| UX-AT-48 | E8，并发修订、故障恢复、草稿和写权限 | 两个浏览器保存冲突及普通开发者路径 |
| UX-AT-49 | E8，实际 prod 投影、未部署／暂停／错误无假链接 | 实际正式路由与未上线、未知三类应用 |
| UX-AT-50 | E7、E9，消费申请、管理员处理与结构化调用 | 同一应用的申请→审批→文档／MCP→真实调用闭环 |
| UX-AT-51 | E11，原稿一致性、顶栏／favicon／登录历史实看 | 当前 16／24／32／64px、单色和双主题的统一检查 |
| UX-AT-52 | E2、E4、E9、E10，独立历史路径、agent 接续、CLI 原对象 | 实际历史会话继续后返回，核对 CLI 状态和未保存输入处理 |

## 4. 任务与旅程的关闭条件

T1／T2 的设计材料及审批已经登记；T3–T11、T13–T16 已有相应实现和自动证据，仍不能由本表提前关闭其实际验收条件。T12 已开始逐项核对并在本轮识别、修复 UX-AT-05 的预览日志与状态竞态缺口；完整实机执行、所有尺寸／角色、发布同步及最终精确 SHA CI 仍未完成。

J1 须实际创建并试用；J2 须双真实 CLI、文件、预览、后台状态串联；J3 须发布到试用及正式切流／回退；J4 须真实故障到对应记录；J5 须市场可见性和当前服务身份试调；J6 须管理员完成接入及审批全程。每条旅程的失败／恢复路径同样要执行，不把单个正常响应视为该旅程完成。

当前阻断不通过缩减范围消除。main 发布仍以明确获准的提交范围为准；共享环境操作须在可审阅的具体镜像／对象方案获准后执行。任何新源码修复继续自带针对性测试和完整门禁，并更新本表对应证据；只有完整证明齐备才更新 RFC 为 Done。
