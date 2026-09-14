# RFC-003｜验收证据核对

> 2026-09-15；共享 console 保持 `cbe28250607aa4084d74556c32aff650a9347783`、cs-api 保持 e26515e，cs-controller 已更新为 `cc931041503cd2794c3145172b728ac24303a08a`，精确 SHA CI、实际 imageID 和源码核对通过。第五十三批修复历史消息草稿、发送回执和离开确认，完整本地门禁与 console build 已通过，上库部署继续。参考代理 v0.1.2 已正常上线，请求到达正确代理，但访问 GitLab 被现有出站规则阻断，I9 待作者裁定。CUA 曾恢复并核对 files 页面未提交 0／未推送 0，随后再次报告 Mac 锁定，已请求解锁。四窗 OOM、保卷恢复和具体成员范围仍待处理。任务和标准沿用 [plan.md](plan.md)，没有删减范围。

## 1. 判据和环境

本表区分源码／自动验证、隔离原生进程、历史浏览器记录和当前完整实机旅程。自动测试覆盖一条接口或路由，不等于使用者在当前部署完成整条旅程。当前 UX-AT-01／02／03／04／05／06／07／08／10／19／21／23／29／33／36／39／40／41 十八项已取得本次实机通过证明；其余 34 项仍有未执行的角色、失败分支或完整旅程。不把有测试文件或一个绿门禁计算为 52 项验收通过。

作者授权上库后，十笔提交已发布至 `3d1ce51`，精确 SHA [CI 34810918306](https://github.com/wangbinquan/CrewStation/actions/runs/34810918306) 成功，1082 pass／8 skip／0 fail、console build 通过。源码候选的本地门禁和一致性证据见 implementation 第三十八批，实际发布和部署见第三十九批。记录前 fetch 确认 main 与 origin/main 0／0。

具体环境方案已获用户“授权”。docker-desktop 的八个服务逐个滚动完成，五份缺少的迁移应用成功；实际 Pod imageID 与完整 revision 标签构建的镜像一致，不能仅凭 1／1 或标签做此判断。新建专用会话使用新 Runner；旧 QA Pod UID 和比较文件 hash 保持完整。

第三十九至四十五批中，Chrome 原生 CUA 恢复后已实看并操作新工作台；第四十六批曾不可读取页面，第四十七批已恢复，见本表开头。实际 admin 在专用 rfc003-ux 完成首次上线并打开正式应用；新建 rfc003-verify-workbench、开会话和首个真实 Claude TUI 也有证据。共享更新、首次切流和此前 main 推送授权已明确，无需再次索要。新 Pod 缺平台模型配置，Claude 停在登录选择；作者指定改用 OpenCode，已完成真实双进程并行、后台完成／草稿／精确定位、页签关闭恢复和独立中断退出。RFC-004 三件套与 ADR-0004 已获批准，Draft 表示排队，须等 RFC-003 完结后启动；现有 RFC-003 的剩余角色／尺寸／失败恢复继续。

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
- E16 无会话发布与访客空／错态：[implementation 第四十三批](implementation.md#第四十三批无会话发布空态修复与访客故障恢复)，新项目从远端 SHA 发布至真实就绪，前后 dev-session 都是 404；历史 v0.1.0 明确已被替代，当前试用仍指向 v0.1.1。独立访客窗口验证尚无项目、筛空、摘要请求阻断的真实失败与解除后刷新；规则已移除。正常 404 的提示修复在候选控制台实看，完整本地门禁与精确 SHA CI 通过，已更新共享 console；更新后页面待 Mac 手动解锁复验。
- E17 离线读取与请求结果：[implementation 第四十四批](implementation.md#第四十四批离线读取提示与未发送操作)，完整门禁及精确 SHA CI 通过，实际共享镜像核对后在 Chrome Offline 验证提示、未发送和发布说明保留；恢复联网没有新 release。断网刷新后回到原开发和发布页，原 Agent 身份、活动事件及 throughSeq=10248 保留；网络条件已恢复。
- E18 真实提问与发布页通知：[implementation 第四十五批](implementation.md#第四十五批真实问题拒绝与发布页后台完成)，单独启动 OpenCode C，问题只读定位后仍 pending，显式 Green 回答后同轮完成；Escape 后 request-resolved=rejected、pending 为空且无旧答案入口，无确定轮次结果时如实 unconfirmed。第三轮在发布页后台完成，说明和焦点保持，离开保护与准确事件定位实看，最后 Ctrl+C 只结束 C。结合 E13 的原生 resize／中断，完成作者指定 OpenCode 的实际 CLI 交互条件。

- E20 会话与真实容器状态：[implementation 第四十七批](implementation.md#第四十七批会话连接状态与真实容器状态)，共享失败页面复现绿色误提示；修复后候选与共享镜像均实看保持失败、历史回放不覆盖，旧正常会话正确显示已连接。完整本地门禁、精确 SHA CI 和实际 imageID 已核对，取消新建保留原工作区；不替代 OOM 恢复或全套故障旅程。
- E21 搜索、预览与工作树发布：[implementation 第四十八批](implementation.md#第四十八批搜索预览故障恢复与当前工作树发布)，实际名称／slug 搜索继续旧任务；新 files 专用任务只终止预览进程，日志定位、CLI 草稿／真实模型轮次、文件保存、单次重启及 iframe 新内容完整串联。dirty 拦截后精确提交 QA 首页，受保护 main 拒绝保持，再从普通 QA 开发分支发布 a80dbc1／v0.1.1 并实际打开。临时 preview 副本均恢复 1／1。计数修复已完成门禁／精确 SHA CI／部署；原会话通过正常 API 发布同 SHA 的 v0.1.2 后未推送归零，原进程和 Git 配置／文件摘要保持。Mac 锁定，该次计数结果尚非界面复验。
- E22 迁移故障与恢复：[implementation 第四十九批](implementation.md#第四十九批迁移失败恢复发布与日志事实)，专用 files v0.1.3 迁移输出固定标记后 exit 42，真实 Job／发布失败且原预览不变；移除验收命令并发布 v0.1.4 后正常就绪。故障时精确 releaseId 可查标记，其他版本无该记录；原任务／Agent、文件摘要和正式槽保留。日志元数据修复的十项回归、完整门禁和精确 SHA CI 通过；第五十批取得明确本机更新授权并实际部署，原生容器时间与 API 记录已核对。此时原失败 Job／Pod 已不存在，一小时保留期已过，不能再复验那条标记。新故障到日志的页面旅程仍待解锁，不把 API 取证视为 UX-AT-13 已通过。
- E23 全部部署槽筛选：[implementation 第五十批](implementation.md#第五十批全部部署槽日志筛选)、[模块 API 回归](../../../modules/observability/tests/observabilityModule.test.ts)，修复未传 slot 仍默认正式槽的后端行为。全部槽限定服务部署工作负载，明确槽保持角色映射。先红后绿、完整本地门禁、精确 SHA CI 和实际 API 部署均完成；真实查询全部槽返回蓝绿两条、prod／preview 分别只返回 green／blue，排除失败开发容器，时间与原始容器日志一致且两次查询相同。页面复验仍待解锁，不增加 UX 通过项。
- E24 活动代理与目录更新顺序：[implementation 第五十一批](implementation.md#第五十一批真实-api-试调与目录路由一致性)、[组合根回归](../../../modules/platform/tests/gatewayCatalogRoutes.test.ts)。files QA 的默认开放 GET 原返回 404，活动代理选择与目录提交后刷新已修复并通过本地／精确 SHA CI、实际部署核对。参考代理 v0.1.2 正常上线后，请求到达正确代理；后续上游连接超时，系统与项目命名空间的 DNS／TCP 对照定位至已有 I9 出站缺口，待作者选择方案。没有修改 grants，不把到达代理视为完整调用或 UX-AT-15 通过。
- E25 发布消费者并发与失败重试：[implementation 第五十二批](implementation.md#第五十二批发布登记投影的并发迟到)。可控暂停旧请求复现迟到覆盖，发布投影统一由目录消费者完成后触发；K8s 失败后同一事件可重试恢复且无重复操作。新增两个组合根回归、完整本地门禁与精确 SHA CI 通过，cs-controller 已更新、镜像和源码核对一致，原路由与 QA 会话保持。files 计数曾在页面复验，但不代替 UX-AT-32 的全部文件类型分支。
- E26 历史对话草稿与发送回执：[implementation 第五十三批](implementation.md#第五十三批历史对话输入与发送回执)、[真实路由回归](../../../apps/console/src/tests/historicalConversations.test.tsx)。复现并修复跨对象草稿、失败即清空、快捷键重复发送、返回丢输入和错误链接选中另一对象；覆盖并行回执及发送期间新输入。仍须实际历史 Agent 与返回 CLI 的浏览器旅程，不据隔离 HTTP 夹具增加通过项。

## 3. UX-AT-01–52 逐项结论

新增 E19：[implementation 第四十六批](implementation.md#第四十六批四窗-oom工作树保全与失败会话展示)，真实四窗 OOM、只读工作卷保全、失败任务／退出原因修复及九项新增回归；精确 SHA CI 与三个服务实际部署已核对。失败任务、不可读工作树和独立生产版本的 HTTP 行为已复验，原槽位／旧 QA／工作卷保留。它是故障与修复证据，不是四窗或容器恢复验收通过；历史表中的“原进程保留／在线”均指此前旅程结束当时。

下表“现有证据”只指向已实现路径及对应自动／历史证据；“仍需证明”是该项未关闭的具体原因。

| 编号 | 现有证据 | 状态／仍需证明 |
|---|---|---|
| UX-AT-01 | E1、E21，实际名称／slug 搜索及现有会话主动作 | 已通过：admin 分别搜索 rfc003-ux 与 RFC-003 验收，唯一结果直接继续原 taskId，浏览器返回保留查询，没有新任务 |
| UX-AT-02 | E2、E9、E12、E13，真实创建／开通、main、新 Runner 与逐个新增 TUI | 已通过：新项目选择 main 开会话，逐次点击各新增一个原生进程；OpenCode 等待任务后才提交输入并完成真实模型轮次 |
| UX-AT-03 | E2、E13，两个实际 OpenCode 输入和执行区间重叠 | 已通过：平铺／放大／恢复／收起保留原对象；只中断并退出 CLI 5557a0，CLI ba964a 继续执行后完成，原 agentId／terminalId／startedAt 保持 |
| UX-AT-04 | E2、E3、E13，原生输入经独立预览、代码与 CLI 往返 | 已通过：CLI ba964a 的输出与未发送 RFC003_UNSENT_DRAFT_KEEP_0914 保留；原 PTY 不重开，返回原窗口，后台轮次继续 |
| UX-AT-05 | E3、E21，实际预览 crashed 与同一 OpenCode、文件和日志链路 | 已通过：SIGKILL 错误限于预览区；相关日志可定位、CLI 草稿与真实模型轮次保留、文件保存可用；一次重启恢复 ready，iframe 显示新标题，原任务与进程不变 |
| UX-AT-06 | E3、E14、E15，更新后共享控制台与原真实 OpenCode 同文件修改 | 已通过：提示位于代码区上方，聚焦继续编辑，草稿保留且未覆盖 Agent 内容；显式放弃后才载入磁盘新版本 |
| UX-AT-07 | E4、E5、E15、E21，dirty 清单与文件定位、普通终端提交、干净来源重新确认和发布 | 已通过：files 项目 dirty 时没有新标签；只提交 home.ts 为 a80dbc1 后重检，从普通 QA 开发分支发布 v0.1.1，精确 release／SHA／就绪与实际试用一致；受保护 main 拒绝未绕过 |
| UX-AT-08 | E5、E15、E16，专用 rfc003-verify-delivery 无会话远端发布 | 已通过：main／完整 ea10bd3ab67501b301ec87d6bc85eaa215fdfa8e 确认后发布 v0.1.1，实际就绪和预览访问成功，前后均无开发会话；页面明确仅含远端提交 |
| UX-AT-09 | E5、E15，真实发布中→就绪与 admin 打开实际待验证蓝槽 | 测试者身份试用及 202 受理阶段的完整界面观察仍待证明 |
| UX-AT-10 | E5、E12，当前→目标确认、切流记录与正式应用实际访问 | 已通过：admin 将 rfc003-ux 从空正式版本切到 v0.1.0；目标 rel_01a09859aa5b7000a780d546a80468cb／a10027cda8470ca4088780ed79081d07dd2b8e0b，正式路由和槽 API 一致 |
| UX-AT-11 | E5、E15、E16，实际正常回退，以及新项目已被替代历史详情 | 正常回退与历史不冒充候选已实机通过；禁止回退分支仍待证明 |
| UX-AT-12 | E5，旧版本确认失效、不自动重发 | 两位负责人实际先后切流的冲突恢复 |
| UX-AT-13 | E5、E6、E22，实际 v0.1.3 迁移 exit 42、故障时精确日志与 v0.1.4 恢复；元数据修复已部署并验证实际容器日志 | 原失败 Job 已不存在；浏览器已恢复，需重新产生受控故障，在日志仍可查时完成失败发布到精确日志的一跳页面旅程 |
| UX-AT-14 | E6，订阅／trace 上下文和诊断入口 | 真实死信投递、重试与结果核对 |
| UX-AT-15 | E7、E24，实际 Swagger 控件、结构化通道及响应；路由修复已部署，真实请求到达代理 | I9 出站设计裁定并实现后，浏览器经开发容器和共享网关完成已授权 API 调用 |
| UX-AT-16 | E7、E9，申请／审批／拒绝材料与重读 | 实际申请人和管理员前后切换后的授权结果 |
| UX-AT-17 | E8，精确查找、高级 ID、成员角色及错误恢复 | 实际负责人添加注册成员并核对成员访问 |
| UX-AT-18 | E8，约束、两份草稿、Secret 不预填和生效反馈 | 开发／生产配置实际保存、重新读取及运行版本核对 |
| UX-AT-19 | E4、E15，真实 QA 本地提交 1aa2db9，释放前检查与取消记录 | 已通过：确认前列出具体未推送 SHA／说明及剩余未提交文件；取消后原 task、Agent、HEAD 和未推送提交保留 |
| UX-AT-20 | E9、E5，管理空间路径和开通恢复 | 创建接入容器→开发→发布→返回的实机全程 |
| UX-AT-21 | E1、E8、E9、E16，真实 rfc003-visitor 独立窗口 | 已通过：尚无项目有开通需求入口；筛空可清除条件；摘要请求阻断显示加载失败／数量未确认，解除并刷新恢复，无错误当空列表 |
| UX-AT-22 | E7–E9，现有守卫和角色动作覆盖 | 开发者、负责人、测试者、管理员四个真实身份逐页验证 |
| UX-AT-23 | E2、E5、E10、E16、E17，真实 Offline 与断网刷新／重进 | 已通过：联网后离线发布不补发、说明保留；原 3 个 CLI 身份及 throughSeq=10248／轮次事件不变，原发布记录无新增，返回开发和发布按既有对象恢复 |
| UX-AT-24 | E4、E6、E9，真实路由与历史适配器回归；E17 开发／发布返回；E21 搜索返回与精确文件链接；E23 全部部署槽真实 API | 修复已部署；旧链接的全部对象／筛选及两空间往返仍需页面核对 |
| UX-AT-25 | E11，部分旧尺寸记录与内部滚动 CSS | 当前全部关键页面在 1280×720、1024、768、390、320 下量测 |
| UX-AT-26 | E8、E11，字段／错误关联、页签与分屏键盘断言 | 实浏览器明暗主题、焦点可见与全程键盘操作 |
| UX-AT-27 | E1、E9，当前页有界聚合、独立失败 | 实际多项目列表的请求范围及部分故障恢复 |
| UX-AT-28 | E2、E19，单次启动和幂等；真实四窗 OOM 暴露资源保护缺口；I15 补当前 cgroup 事实与隔离选项 | 新增 CLI 资源不足影响原进程的故障仍未解决；I15 待作者选择后实施隔离和实机复验，I14 的故障恢复不能替代保护 |
| UX-AT-29 | E2、E13、E18，作者指定 OpenCode 的实际 TUI、输入、受控 resize、提问应答、Escape、Ctrl+C | 已通过：真实 Big Pickle 轮次、Green 应答、拒绝问题与独立退出均实看，C 退出码 0，原 B 等进程保留。Claude 外部模型未接通是环境限制，原 plan 此项的真实 CLI 条件按作者指定 OpenCode 验证 |
| UX-AT-30 | E4、E12、E15，提交一致及本地 1aa2db9 对生产 6af30245c4 领先 1，未提交／未推送独立计数 | 一致和领先已实看，落后／分叉等其余真实界面分支仍待证明 |
| UX-AT-31 | E4、E5，源改变与切流后比较失效 | 另一使用者实际切流／回退时当前差异及时更新 |
| UX-AT-32 | E4、E12、E21、E25，真实 untracked patch、首页修改；发布后计数修复已有真实 Git 回归、部署和原会话 API 复验，页面已显示未提交 0／未推送 0 | 暂存、未暂存、删除、二进制及截断的完整界面仍需核对 |
| UX-AT-33 | E3、E4、E14，真实 OpenCode 单行编辑与开发／正式页面对照 | 已通过：开发预览直接显示 RFC003 Agent 实时预览及后续更新；生产仍为 v0.1.0／6af30245c4f5dc0537bdae2c3a44aa2b3fd62d29，正式 h1 不变，无需发布即可看到工作树效果 |
| UX-AT-34 | E2、E17、E19、E20，真实断线附着；OOM 后名册 unknown，失败页面与取消新建在共享镜像实看 | 后续容器恢复／新建旅程仍未完成；原 OOM 进程不在线，不能以状态显示修复算恢复通过 |
| UX-AT-35 | E11、E19，历史隔离四窗；当前四窗启动后容器 OOM | 未通过：需先解决资源不足，并完成 1280×720 首窗 ≤210px、六行输出与输入区量测 |
| UX-AT-36 | E2、E4、E13，新页签、命名、跨页签、关闭和两种恢复入口 | 已通过：新建空页签不启动进程，命名为 OpenCode 并行验收；关闭后已启动仍为 3，动态恢复原 A、名册恢复原 B，B 的草稿和两窗输出完整 |
| UX-AT-37 | E2、E11、E13，实际键盘 50→56、拖动至 43、纵排、跨页签与受控 PTY resize | 实机部分通过；只读窗口保持原 PTY 尺寸、取得控制才适配。均分／排序持久化、五种尺寸及只读小窗完整可达性仍需核对 |
| UX-AT-38 | E8 与数据访问表单回归，三模式并存、期限、审批／撤销 | 真实角色申请／审批；分别记录授权、凭据和应用实际选用，未知仍如实呈现 |
| UX-AT-39 | E10、E12、E13、E18，其他页签／预览及发布页的真实 OpenCode 后台完成 | 已通过：发布页未读 4→5 时说明和焦点保持，查看结果先保护未保存输入；清理验收草稿后按 C 第三轮 event／seq=16539 定位原终端，仅该完成标为已读 |
| UX-AT-40 | E2、E10、E18，真实原生提问、显式选择和拒绝 | 已通过：后台待处理持续显示，前往处理只读后 pending 仍在；Green 回答恢复同轮执行。第二个问题经 Escape 拒绝后 pending 为空、原表单关闭；缺少结果时明确 unconfirmed，没有当作完成或继续批准旧问题 |
| UX-AT-41 | E2、E10、E13，原生新轮次、取消和进程退出的独立事件 | 已通过：完成后再次输入显示执行中；A 的第二轮 Escape 后为本轮已中断／进程在线，随后 Ctrl+C 为进程已结束；B 第三轮正常完成，取消未冒充完成 |
| UX-AT-42 | E10、E17，自动去重和真实断线重进后的原事件保持；E18 缺少结果时明确未确认 | 乱序补发与状态通道不可用的实际通知／恢复仍待证明 |
| UX-AT-43 | E2、E10，个人布局／已读隔离和隐藏窗口定位 | 两位实际成员同时查看且互不清除对方未读 |
| UX-AT-44 | E7、E9，消费入口与管理供给分离 | 四类真实使用者的入口检查及管理员接入全旅程 |
| UX-AT-45 | E8，三种范围的服务端过滤及市场内部数据边界 | 非成员实际搜索多项获准应用及看不到隐藏项 |
| UX-AT-46 | E8，默认范围、名单去重／不存在、取消／保存 | 实际负责人保存三种范围并切换身份观察结果 |
| UX-AT-47 | E8，列表／详情一致裁定与撤销缓存回归 | 成员和指定名单变化后的真实多账号访问 |
| UX-AT-48 | E8，并发修订、故障恢复、草稿和写权限 | 两个浏览器保存冲突及普通开发者路径 |
| UX-AT-49 | E8、E12，当前市场中的真实未上线、上线后正式链接与应用访问 | 已实看前两类，仍需真实状态未知分支 |
| UX-AT-50 | E7、E9，消费申请、管理员处理与结构化调用 | 同一应用的申请→审批→文档／MCP→真实调用闭环 |
| UX-AT-51 | E11，原稿一致性、顶栏／favicon／登录历史实看；第五十三批新增当前原稿四尺寸、单色／双主题的 rsvg-convert 实际渲染图 | 资产尺寸已复核；当前浏览器里的顶栏、favicon、登录与明暗主题统一检查仍待解锁 |
| UX-AT-52 | E2、E4、E9、E10，独立历史路径、agent 接续、CLI 原对象；E21 实看历史入口与普通终端；E26 补消息草稿、发送回执、对象定位与离开保护回归 | 实际历史 Agent 对话继续后返回、CLI 状态及未保存输入处理仍待核对；普通终端提交或隔离 HTTP 回归不替代该旅程 |

## 4. 任务与旅程的关闭条件

T1／T2 的设计材料及审批已经登记；T3–T11、T13–T16 已有相应实现和自动证据，仍不能由本表提前关闭其实际验收条件。T12 已逐项核对，修复 UX-AT-05 的状态竞态并开始当前部署实机验证；代码发布同步与精确 SHA CI 已完成，完整实机执行、所有尺寸／角色及剩余失败恢复仍未完成。

J1 须实际创建并试用；J2 须双真实 CLI、文件、预览、后台状态串联；J3 须发布到试用及正式切流／回退；J4 须真实故障到对应记录；J5 须市场可见性和当前服务身份试调；J6 须管理员完成接入及审批全程。每条旅程的失败／恢复路径同样要执行，不把单个正常响应视为该旅程完成。

剩余项不通过缩减范围消除。已获准的共享环境与专用项目操作继续执行；管理员运行配置 RFC-004 已批准，明确在 RFC-003 完结后启动，当前未实施 Hook。任何新源码修复继续自带针对性测试和完整门禁，并更新本表对应证据；只有完整证明齐备才更新 RFC 为 Done。

第四十三批的具体成员变更被自动审批拦截；专用受益账号、角色与 `rfc003-verify-workbench` 资源范围已整理到真实确认面板并向用户询问，尚未提交角色或市场范围写入。该项只暂停依赖新增权限的实机分支，不暂停其余开发与验收。
