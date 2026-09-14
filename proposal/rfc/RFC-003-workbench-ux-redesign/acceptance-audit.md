# RFC-003｜验收证据核对

> 2026-09-14；共享 console 已更新为 `64f37c31f48e6bf0610a1860462569bfa7401671`，后端与任务镜像仍以 `3d1ce5181a11787e3629fea4021f0130e734912d` 为基准。第四十二批已在更新后的共享控制台完成编辑冲突复验及发布／回退的部分旅程。任务和标准沿用 [plan.md](plan.md)，没有删减范围。

## 1. 判据和环境

本表区分源码／自动验证、隔离原生进程、历史浏览器记录和当前完整实机旅程。自动测试覆盖一条接口或路由，不等于使用者在当前部署完成整条旅程。当前 UX-AT-02／03／04／06／10／19／33／36／41 九项已取得本次实机通过证明；其余 43 项仍有未执行的角色、失败分支或完整旅程。不把有测试文件或一个绿门禁计算为 52 项验收通过。

作者授权上库后，十笔提交已发布至 `3d1ce51`，精确 SHA [CI 34810918306](https://github.com/wangbinquan/CrewStation/actions/runs/34810918306) 成功，1082 pass／8 skip／0 fail、console build 通过。源码候选的本地门禁和一致性证据见 implementation 第三十八批，实际发布和部署见第三十九批。记录前 fetch 确认 main 与 origin/main 0／0。

具体环境方案已获用户“授权”。docker-desktop 的八个服务逐个滚动完成，五份缺少的迁移应用成功；实际 Pod imageID 与完整 revision 标签构建的镜像一致，不能仅凭 1／1 或标签做此判断。新建专用会话使用新 Runner；旧 QA Pod UID 和比较文件 hash 保持完整。

Chrome 原生 CUA 已恢复，可实看并操作新工作台。实际 admin 在专用 rfc003-ux 完成首次上线并打开正式应用；新建 rfc003-verify-workbench、开会话和首个真实 Claude TUI 也有证据。共享更新、首次切流和此前 main 推送授权已明确，无需再次索要。新 Pod 缺平台模型配置，Claude 停在登录选择；作者指定改用 OpenCode，已完成真实双进程并行、后台完成／草稿／精确定位、页签关闭恢复和独立中断退出。RFC-004 三件套与 ADR-0004 已获批准，Draft 表示排队，须等 RFC-003 完结后启动；现有 RFC-003 的剩余角色／尺寸／失败恢复继续。

第四十一批 `64f37c3` 的精确 SHA [CI 34822560250](https://github.com/wangbinquan/CrewStation/actions/runs/34822560250) 成功，1085 pass／8 skip／0 fail、console build 通过。第四十二批只更新共享 console 镜像，核对实际 imageID 与原任务保留；没有改后端、任务镜像、迁移或生产源码。

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
- E12 当前部署实机：[implementation 第三十九批](implementation.md#第三十九批已授权发布环境更新与首批完整实机证据)，包含镜像、迁移、角色、两个专用项目、原会话保留、真实上线／路由／版本、未跟踪文件 diff、新建／开通／新 Runner／原生 TUI，以及一次 OpenCode 真实模型轮次、独立预览、未读完成和动态精确定位。明确不包含尚未执行的双真实模型并行和回退等分支。
- E13 双 OpenCode 真实交互：[implementation 第四十批](implementation.md#第四十批双-opencode-并行页签恢复与独立中断退出)，两次执行区间重叠、后台完成时预览草稿与焦点不变、按事件定位、CLI 草稿经预览／代码／跨页签／关闭恢复保留、受控 resize、独立 Escape 中断与 Ctrl+C 退出。模型是实际 OpenCode Big Pickle，只有固定验收文本，没有脚本化模型响应。五种视口／主题和 Claude 完整轮次仍未补齐。
- E14 真实文件冲突与预览：[implementation 第四十一批](implementation.md#第四十一批真实-agent-文件修改预览与编辑器冲突提示)，实际 OpenCode 修改同一文件，编辑器拒绝覆盖并保留草稿，开发预览与生产内容分离。该批在候选控制台完成冲突／确认置顶及默认焦点验证，后续共享部署复验见 E15。
- E15 共享部署及发布回退：[implementation 第四十二批](implementation.md#第四十二批共享控制台冲突复验未推送清单与发布回退)，核对 console 镜像／Pod 身份后在共享页面复验真实冲突；普通终端只提交 QA 首页，释放前列明实际未推送提交、取消保留原任务。另从已推送 main 发布 v0.1.1，实看试用、上线、回退与网关蓝绿槽对照。只有 admin 身份和正常回退分支，不替代测试者、无会话发布或禁止回退。

## 3. UX-AT-01–52 逐项结论

下表“现有证据”只指向已实现路径及对应自动／历史证据；“仍需证明”是该项未关闭的具体原因。

| 编号 | 现有证据 | 状态／仍需证明 |
|---|---|---|
| UX-AT-01 | E1，按名称／slug、状态与负责人查询，现有会话主动作 | 当前部署中实际成员搜索并进入原会话 |
| UX-AT-02 | E2、E9、E12、E13，真实创建／开通、main、新 Runner 与逐个新增 TUI | 已通过：新项目选择 main 开会话，逐次点击各新增一个原生进程；OpenCode 等待任务后才提交输入并完成真实模型轮次 |
| UX-AT-03 | E2、E13，两个实际 OpenCode 输入和执行区间重叠 | 已通过：平铺／放大／恢复／收起保留原对象；只中断并退出 CLI 5557a0，CLI ba964a 继续执行后完成，原 agentId／terminalId／startedAt 保持 |
| UX-AT-04 | E2、E3、E13，原生输入经独立预览、代码与 CLI 往返 | 已通过：CLI ba964a 的输出与未发送 RFC003_UNSENT_DRAFT_KEEP_0914 保留；原 PTY 不重开，返回原窗口，后台轮次继续 |
| UX-AT-05 | E3，崩溃可编辑、具名日志、重启单次和错误保留 | 当前预览服务崩溃后从界面定位真实日志并修复重启 |
| UX-AT-06 | E3、E14、E15，更新后共享控制台与原真实 OpenCode 同文件修改 | 已通过：提示位于代码区上方，聚焦继续编辑，草稿保留且未覆盖 Agent 内容；显式放弃后才载入磁盘新版本 |
| UX-AT-07 | E4、E5、E15，dirty 清单、定位原文件、普通终端精确提交与重检 | home.ts 已提交并从清单消失，原 .claude.json 仍如实阻止发布；完整干净工作树重试发布尚待证明 |
| UX-AT-08 | E5、E15，已推送 main／6af30245c4 实际发布 v0.1.1，排除本地 1aa2db9 | 当前项目有开发会话；完全无开发会话的分支仍待实机证明 |
| UX-AT-09 | E5、E15，真实发布中→就绪与 admin 打开实际待验证蓝槽 | 测试者身份试用及 202 受理阶段的完整界面观察仍待证明 |
| UX-AT-10 | E5、E12，当前→目标确认、切流记录与正式应用实际访问 | 已通过：admin 将 rfc003-ux 从空正式版本切到 v0.1.0；目标 rel_01a09859aa5b7000a780d546a80468cb／a10027cda8470ca4088780ed79081d07dd2b8e0b，正式路由和槽 API 一致 |
| UX-AT-11 | E5、E15，v0.1.1→仍在待命的 v0.1.0 实际回退，网关及记录一致 | 正常回退实机通过；禁止回退及历史版本不冒充候选的当前界面分支仍待证明 |
| UX-AT-12 | E5，旧版本确认失效、不自动重发 | 两位负责人实际先后切流的冲突恢复 |
| UX-AT-13 | E5、E6，migration＋releaseId 精确查询 | 本次真实迁移失败记录与对应日志链路 |
| UX-AT-14 | E6，订阅／trace 上下文和诊断入口 | 真实死信投递、重试与结果核对 |
| UX-AT-15 | E7，实际 Swagger 控件、结构化通道及响应 | 浏览器经开发容器和共享网关完成已授权 API 调用 |
| UX-AT-16 | E7、E9，申请／审批／拒绝材料与重读 | 实际申请人和管理员前后切换后的授权结果 |
| UX-AT-17 | E8，精确查找、高级 ID、成员角色及错误恢复 | 实际负责人添加注册成员并核对成员访问 |
| UX-AT-18 | E8，约束、两份草稿、Secret 不预填和生效反馈 | 开发／生产配置实际保存、重新读取及运行版本核对 |
| UX-AT-19 | E4、E15，真实 QA 本地提交 1aa2db9，释放前检查与取消记录 | 已通过：确认前列出具体未推送 SHA／说明及剩余未提交文件；取消后原 task、Agent、HEAD 和未推送提交保留 |
| UX-AT-20 | E9、E5，管理空间路径和开通恢复 | 创建接入容器→开发→发布→返回的实机全程 |
| UX-AT-21 | E1、E8、E9，无项目、筛空、失败有独立断言 | 在当前浏览器逐一观察三类状态和恢复 |
| UX-AT-22 | E7–E9，现有守卫和角色动作覆盖 | 开发者、负责人、测试者、管理员四个真实身份逐页验证 |
| UX-AT-23 | E2、E5、E10，重连、原请求 ID 与迟到回复 | 真实断线后重新进入，确认没有重复进程和发布 |
| UX-AT-24 | E4、E6、E9，真实路由与浏览器历史适配器回归 | 实浏览器旧链接、返回和两空间往返 |
| UX-AT-25 | E11，部分旧尺寸记录与内部滚动 CSS | 当前全部关键页面在 1280×720、1024、768、390、320 下量测 |
| UX-AT-26 | E8、E11，字段／错误关联、页签与分屏键盘断言 | 实浏览器明暗主题、焦点可见与全程键盘操作 |
| UX-AT-27 | E1、E9，当前页有界聚合、独立失败 | 实际多项目列表的请求范围及部分故障恢复 |
| UX-AT-28 | E2，单次启动、原 UUID 重试和已有布局保留 | 已有真实 CLI 执行中另一个启动失败的界面恢复 |
| UX-AT-29 | E2、E13，OpenCode 实际 TUI／输入／受控 resize／Escape／Ctrl+C 与独立结束 | OpenCode 正常轮次及取消退出已有实机证据；两类 CLI 的提问／确认应答与 Claude 真实模型交互仍未完整验证 |
| UX-AT-30 | E4、E12、E15，提交一致及本地 1aa2db9 对生产 6af30245c4 领先 1，未提交／未推送独立计数 | 一致和领先已实看，落后／分叉等其余真实界面分支仍待证明 |
| UX-AT-31 | E4、E5，源改变与切流后比较失效 | 另一使用者实际切流／回退时当前差异及时更新 |
| UX-AT-32 | E4、E12，当前浏览器显示真实 untracked 文件 +1／−0 与对应 patch | 仍需暂存、未暂存、删除、二进制及截断的当前界面核对 |
| UX-AT-33 | E3、E4、E14，真实 OpenCode 单行编辑与开发／正式页面对照 | 已通过：开发预览直接显示 RFC003 Agent 实时预览及后续更新；生产仍为 v0.1.0／6af30245c4f5dc0537bdae2c3a44aa2b3fd62d29，正式 h1 不变，无需发布即可看到工作树效果 |
| UX-AT-34 | E2，detach、名册、重连与旧 Runner 状态 | 关闭浏览器／返回与专用容器重建的真实恢复旅程 |
| UX-AT-35 | E11，历史隔离四窗可见记录 | 当前 1280×720 首窗 ≤210px、四窗至少六行输出和输入完整的量测 |
| UX-AT-36 | E2、E4、E13，新页签、命名、跨页签、关闭和两种恢复入口 | 已通过：新建空页签不启动进程，命名为 OpenCode 并行验收；关闭后已启动仍为 3，动态恢复原 A、名册恢复原 B，B 的草稿和两窗输出完整 |
| UX-AT-37 | E2、E11、E13，实际键盘 50→56、拖动至 43、纵排、跨页签与受控 PTY resize | 实机部分通过；只读窗口保持原 PTY 尺寸、取得控制才适配。均分／排序持久化、五种尺寸及只读小窗完整可达性仍需核对 |
| UX-AT-38 | E8 与数据访问表单回归，三模式并存、期限、审批／撤销 | 真实角色申请／审批；分别记录授权、凭据和应用实际选用，未知仍如实呈现 |
| UX-AT-39 | E10、E12、E13，两真实 OpenCode 在预览后台完成，未读 1→2 且草稿和焦点不变，精确事件定位 | 预览与其他工作页签分支已实看；发布页及 Claude 完成后的实际通知／定位仍需证明 |
| UX-AT-40 | E2、E10，原生问题事件与查看不解决 | 实际后台提问、显式应答与失效请求交互 |
| UX-AT-41 | E2、E10、E13，原生新轮次、取消和进程退出的独立事件 | 已通过：完成后再次输入显示执行中；A 的第二轮 Escape 后为本轮已中断／进程在线，随后 Ctrl+C 为进程已结束；B 第三轮正常完成，取消未冒充完成 |
| UX-AT-42 | E10，重复、乱序、源降级、补发与持久化去重 | 实际断线和通道不可用时前端通知及恢复 |
| UX-AT-43 | E2、E10，个人布局／已读隔离和隐藏窗口定位 | 两位实际成员同时查看且互不清除对方未读 |
| UX-AT-44 | E7、E9，消费入口与管理供给分离 | 四类真实使用者的入口检查及管理员接入全旅程 |
| UX-AT-45 | E8，三种范围的服务端过滤及市场内部数据边界 | 非成员实际搜索多项获准应用及看不到隐藏项 |
| UX-AT-46 | E8，默认范围、名单去重／不存在、取消／保存 | 实际负责人保存三种范围并切换身份观察结果 |
| UX-AT-47 | E8，列表／详情一致裁定与撤销缓存回归 | 成员和指定名单变化后的真实多账号访问 |
| UX-AT-48 | E8，并发修订、故障恢复、草稿和写权限 | 两个浏览器保存冲突及普通开发者路径 |
| UX-AT-49 | E8、E12，当前市场中的真实未上线、上线后正式链接与应用访问 | 已实看前两类，仍需真实状态未知分支 |
| UX-AT-50 | E7、E9，消费申请、管理员处理与结构化调用 | 同一应用的申请→审批→文档／MCP→真实调用闭环 |
| UX-AT-51 | E11，原稿一致性、顶栏／favicon／登录历史实看 | 当前 16／24／32／64px、单色和双主题的统一检查 |
| UX-AT-52 | E2、E4、E9、E10，独立历史路径、agent 接续、CLI 原对象 | 实际历史会话继续后返回，核对 CLI 状态和未保存输入处理 |

## 4. 任务与旅程的关闭条件

T1／T2 的设计材料及审批已经登记；T3–T11、T13–T16 已有相应实现和自动证据，仍不能由本表提前关闭其实际验收条件。T12 已逐项核对，修复 UX-AT-05 的状态竞态并开始当前部署实机验证；代码发布同步与精确 SHA CI 已完成，完整实机执行、所有尺寸／角色及剩余失败恢复仍未完成。

J1 须实际创建并试用；J2 须双真实 CLI、文件、预览、后台状态串联；J3 须发布到试用及正式切流／回退；J4 须真实故障到对应记录；J5 须市场可见性和当前服务身份试调；J6 须管理员完成接入及审批全程。每条旅程的失败／恢复路径同样要执行，不把单个正常响应视为该旅程完成。

剩余项不通过缩减范围消除。已获准的共享环境与专用项目操作继续执行；管理员运行配置 RFC-004 已批准，明确在 RFC-003 完结后启动，当前未实施 Hook。任何新源码修复继续自带针对性测试和完整门禁，并更新本表对应证据；只有完整证明齐备才更新 RFC 为 Done。
