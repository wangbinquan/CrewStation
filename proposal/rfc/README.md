# RFC 索引

> `proposal/` 下的三件套（Proposal、Design、Plan）是**基线**，描述整个系统。
> 基线之后的新功能、非平凡重构、产品行为变更，一律先走 RFC 再写代码。
> 流程见 `docs/engineering/development-rules.md` §5。

## 登记格式（硬约定）

新 RFC 一律**追加为下面这张表的一行**，编号升序，三列：

```
| [RFC-NNN](./RFC-NNN-{slug}/proposal.md) | 标题：一句话摘要 | 状态 |
```

状态取 `Draft` / `In Progress` / `Done` / `Superseded` 四选一**打头**，其后接日期与证据（commit / CI run）。

两条注意：

1. 正文里的 `|` 必须转义成 `\|`，否则整行错列。
2. **不要在表外另起散文条目**——散在正文里的登记会让「哪些 RFC 没收口」无法一次扫出。

## 目录结构

每个 RFC 一个目录，三个文件，与基线三件套同构：

```text
proposal/rfc/RFC-NNN-{slug}/
├─ proposal.md   # 产品视角：背景、目标与非目标、用户故事、验收标准
├─ design.md     # 技术设计：接口契约、数据流、落在哪个模块哪一层、失败模式、测试策略
└─ plan.md       # 任务分解：RFC-NNN-T1… 、依赖、验收清单
```

编号从 `RFC-001` 起递增，**不复用、不重排**。被取代的 RFC 保留原目录，状态改 `Superseded` 并写明取代它的编号。

## 索引

| 编号 | 标题 | 状态 |
|---|---|---|
| [RFC-001](./RFC-001-platform-owned-compute/proposal.md) | 算力由平台统一提供：业务只引用管理员定义的档位名，不再声明驱动与模型 | Done · 2026-09-12 实现 `447e374`，实跑修补 `39c8e36`；本机端到端跑通（开通 → 发布 v0.1.4 → 开发会话起 Agent → `/chat`） |
| [RFC-002](./RFC-002-admin-and-tenant-spaces/proposal.md) | 管理空间与租户空间分离：顶栏切换两个空间，接入容器移出租户项目列表 | Done · 2026-09-12 实现 `72a3e93`；管理员与普通成员两条路径均在浏览器实跑确认 |
| [RFC-003](./RFC-003-workbench-ux-redesign/proposal.md) | 工作台 UX：能力市场与五个项目入口、逐个 CLI／页签分屏／后台状态、独立实时预览、工作树与生产版本对比、发布上线与管理供给 | Done · 2026-09-16 · 52／52 项 UX-AT 全部实机通过,本地 gate 与精确 SHA CI 通过。设计基线 `1f40fa8`；2026-09-16 第八十三批按设计附件对齐视觉并修复首次回放缺陷，第八十四批五身份逐页、暗色与键盘实机核对并修复 cs-api 连接池卡死，第八十五批市场三身份旅程与未读隔离，第八十六批分屏页签实机与走连接池的健康检查，第八十七批数据访问审批旅程，第八十八批成员撤销与用户域 403 页面，第八十九批定向开放申请浏览器往返，第九十批切流过期确认与他人页面刷新，第九十一批浏览器 API 试调，第九十二批浏览器发布 v0.1.2，第九十三批申请人／审批人显示可辨识名字，第九十四批六个失败分支的完整浏览器实机（破坏性回退拒绝、死信重放、局部来源故障、浅／无共同历史、查询失败恢复、状态未知），第九十五批以可回滚故障注入走通 UX-AT-42 乱序补发；实机通过 52／52，RFC-003 验收完成 |
| [RFC-004](./RFC-004-admin-agent-runtime/proposal.md) | 管理员定义 Agent 启动前 Hook：预置配置文件与执行初始化脚本；租户按算力档位使用 | Superseded · 2026-09-18 被 RFC-006 取代（作者裁定 C8：运行环境并入算力档位）；此前 2026-09-14 批准、2026-09-16 代码落地，AR 实机验收未执行 |
| [RFC-005](./RFC-005-oidc-company-login/proposal.md) | OIDC／OAuth 2.0 公司登录：管理员配置身份提供方（配置项对齐 agent-workflow），引导令牌交接首位管理员，常规登录由经 OIDC 登录的管理员关闭 | Done · 2026-09-18 作者以会话目标「完整实现整个RFC并提交上库」要求实施并完成：T1–T11 全部落地，OA-01…OA-31 逐项核对（能实机的都在本机集群＋两个 mock IdP＋无头 Chrome 上实机跑过），见 [acceptance-audit.md](./RFC-005-oidc-company-login/acceptance-audit.md)。产品规则取自当日十二项裁定 A1–A12（初始化完全照搬含本地密码、常规登录由 OIDC 管理员手动关闭、只做 auto／allowlist、断代开发、删除演示登录、多 Provider 并存且账户不合并、ConfigMap 强制开关为破窗口、IdP 身份信息先留平台并由平台配置转发给业务的字段：全局默认＋按项目覆盖、可扩展自定义映射、令牌声明同步裁剪） |
| [RFC-006](./RFC-006-unified-compute-profile/proposal.md) | 算力档位合并运行环境：档位即完整执行配置（协议、管理员基于平台底座构建的镜像、必填二进制、启动前步骤、模型），每个 Agent 独立 Pod，保存即在真实容器里自动测试、通过前不可选 | Done · 2026-09-18 作者以会话目标「完整实现RFC并提交上库」要求实施并完成：T1–T13 落地，CP-01…CP-22 与 design.md §13 四项实机核对（本机做不到的 CP-03 Claude 真实轮次与 CP-11「没有默认档位」以自动化用例为准），基线三件套回填到 v0.3.4；产品规则取自作者当日五轮二十项裁定 C1–C20；**待作者复核**：P1–P8、ADR-0005（仍为「实施中」）、implementation-open-questions I17–I19；RFC-004 按裁定 C8 置为 Superseded |
| [RFC-007](./RFC-007-dev-role-login/proposal.md) | 开发环境 OAuth 2.0 一键换角色：独立 dev-auth 通过真实 OIDC 流程切换平台管理员、项目开发者、preview 测试者与普通成员 | Done · 2026-09-20 T1–T8 全部完成；四角色与旧页签令牌恢复已在本机 Chrome 实机通过，功能提交 `fd1418f`、CI 修复 `35452d5` 已上库，精确 SHA GitHub `check`／`e2e` 成功 |
| [RFC-008](./RFC-008-development-session-ux/proposal.md) | 开发会话操作闭环与界面重构：明确连接与恢复路径，数据访问／会话信息页签化，分离功能导航与 CLI 工作区 | Done · 2026-09-20 T1–T7／DS-01…DS-16 完成；原 demo 保卷恢复和 CLI／编辑／预览实机闭环通过；共同 gate 1684 pass／5 skip／0 fail，实现 `5252c4c` 与精确 SHA CI 35502873316 的 check／e2e 全部成功 |
| [RFC-009](./RFC-009-project-settings-ux/proposal.md) | 项目设置 UX：设置聚焦环境变量、应用展示、成员与高级操作，开发资源独立，编辑按需展开 | Done · 2026-09-20 T1–T8 完成，代码 `c5e5f0e` 与精确 CI 35503015065 通过；本机实机 E2E 11 项、共同 gate 1684 项通过，PS-11 详情／Swagger 实际 HTTP 200（112／91 ms）已补齐；旧演示代理部署问题单独记录 |
| [RFC-010](./RFC-010-cluster-management/proposal.md) | 集群资源管理：项目与平台内置资源的数量、状态、归属和 Pod 用途，受控重启／扩缩／删除与操作记录 | Done · 2026-09-20 · T1–T11、CM-01–25 完成；RBAC、完整清单和真实管理动作验收通过，本地 1875 pass／5 skip／0 fail；发布 7237ecc 的 CI 35516088549 六作业成功，见 [证据](./RFC-010-cluster-management/acceptance.md) |
| [RFC-011](./RFC-011-role-based-home/proposal.md) | 三类平台角色与使用者首页：能力市场只展示应用，成员试用卡片标 Beta，开发者自建项目，管理员独立管理，删除全局 Agent 动态 | In Progress · 实现 b3d8d0e 已上库，基线 v0.3.6；真实四测试视角、创建开通和 Beta 试用通过；完整门禁 1864 pass／5 skip／0 fail，发布 da4f437 的 CI 六作业成功；仅具体测试账号改权实机验收待授权，见 [验收记录](./RFC-011-role-based-home/acceptance.md) |
| [RFC-012](./RFC-012-project-compute-access/proposal.md) | 项目算力授权：允许的 Agent 档位、项目默认档位、开发容器套餐及全链路校验 | Done · 2026-09-20 T1–T6／PC-01…PC-12 完成；实现 `5fb7e6c` 与共享接线 `b7fb3e5`／`b3d8d0e` 已上库，96 条相关回归、三尺寸构建预览、部署后真实页面/API 验收通过；共享完整门禁 1864 pass／5 skip／0 fail，包含完整功能的 `a694465` 六项 CI 成功，见 [实施与验证](./RFC-012-project-compute-access/plan.md) |
| [RFC-013](./RFC-013-resource-uuid/proposal.md) | 资源身份统一为标准 UUIDv7，名称只作展示属性 | Done · 2026-09-21 · 原库 35 项迁移、登录恢复、浏览器与新旧 Runner 运行验收完成；本地 1946 pass／5 skip／0 fail，兼容修复 `9a67e12` 的 CI `35547465024` 六项成功；[证据](./RFC-013-resource-uuid/acceptance.md) |
| [RFC-014](./RFC-014-identity-admin-ux/proposal.md) | 用户与权限、认证 UX：紧凑用户目录与按需角色编辑，登录方式与身份字段分组，接入方配置和诊断重排 | Done · 2026-09-21 T1–T8 完成；44 项定向、共享候选完整门禁与实机布局通过，a1b87a1 的 CI 35543847392 六项成功，见 [证据](./RFC-014-identity-admin-ux/acceptance.md) |
| [RFC-015](./RFC-015-cluster-resource-observability/proposal.md) | 集群容量与用量：节点总览、Pod／容器资源、PVC 申请与实际使用及最近七天趋势 | Done · 2026-09-21 · T1–T12／RO-01…RO-29 完成，本机部署／实机验收与 2029 项本地用例通过；实现 `3266e75`，发布 `f5f42ad` 的 CI 35555330886 六项成功，见 [证据](./RFC-015-cluster-resource-observability/acceptance.md) |
| [RFC-016](./RFC-016-preview-process-control/proposal.md) | 开发会话预览进程：Agent 经操作 MCP 自主启动／停止／重启，富状态与预览输出缓冲，控制统一走 cs-api | In Progress · 2026-09-21 · T1–T9 完成并上库：Runner 三条新命令经 `previewControl` 能力位协商、输出环形缓冲、三条 cs-api 路由、三个 MCP 工具、工作台迁 REST；`55187d0` 的 CI 35552484798 六项成功。**PV-01…PV-18 实机验收未执行**（需本机集群，被并行 RFC-015 在制品挡住），实现中发现的缺口记为 I21 |
| [RFC-017](./RFC-017-project-resource-management/proposal.md) | 项目资源配置：服务规格范围、开发与 Agent 资源、任务配额及共享规格模板归属 | Done · 2026-09-21 · T1–T6／PR-01…PR-10 完成，本机部署及浏览器验收通过；完整门禁 2072 pass／8 skip／0 fail，391／391 改动行覆盖；实现 `38d1f3a` 的 CI 35564949555 六项成功，见 [验证](./RFC-017-project-resource-management/plan.md) |
| [RFC-018](./RFC-018-remove-egress-allowlist/proposal.md) | 下线出站 FQDN 白名单：删除条目／申请／被阻记录与 APIProxy 受控出站通道，接入容器直连上游，平台不再以域名约束出站 | Done · 2026-09-22 · T1–T9 与 EG-01…EG-08 全部通过。作者批准八项能力影响清单并裁定 Q1＝C、Q2＝b；本机部署、11 个命名空间策略逐项核对、六条路由 404、`egress` schema 与 4 行迁移记录删除并复查。阻塞 EG-04 的 I23 按方案 a 解决后，两个接入项目迁 v2、发 `v0.1.4` 并切流，经网关真实调用取得 HTTP 200 与真实上游数据。完整门禁 2069 pass／8 skip／0 fail，改动行防护 100／100；实现提交 `5a51d38` 的 [CI 35710784089](https://github.com/wangbinquan/CrewStation/actions/runs/35710784089) 六项成功 |
| [RFC-019](./RFC-019-deployment-topology/proposal.md) | 部署与运行形态图：项目概览缩略与运行诊断全图、集群管理拓扑页签（系统层／项目层／Pod 层），视觉借鉴 Archify、工作台自绘 SVG | Done · 2026-09-22 · 作者批准三件套并裁定 §7（成员看与管理员相同的 Pod 投影，动作只在集群管理）。T1–T10 完成，基线 v0.3.8（R55、§14.6、D55、AT-56）；本机部署并实机核对三处入口与接口对账，dev-auth 恢复后本机 e2e 层跑通（拓扑用例 8／8：三层、宽度 1280／1024／390／320、浅色主题、键盘、成员 200／非成员 404）；完整门禁 2060 pass／55 skip／0 fail，改动行防护 99.2%；实现推送的 [CI 35744347320](https://github.com/wangbinquan/CrewStation/actions/runs/35744347320) 与 e2e 补强的 [CI 35749904351](https://github.com/wangbinquan/CrewStation/actions/runs/35749904351) 六项成功；TP-05／06／15 只有用例覆盖，见 [acceptance.md](./RFC-019-deployment-topology/acceptance.md) |
| [RFC-020](./RFC-020-project-workspace-ia/proposal.md) | 项目工作台信息架构重构：左栏按数字人生命周期排序、二级导航统一为分组导航、开发工作区的预览／代码／变更／数据／参考／会话改为终端旁的工具面板、发布记录合并为带人名的时间线、主题各归一处 | Done · 2026-09-23 · 作者裁定 D1 工具面板、D2 取消「开发资源」并入面板与设置、D3 只合并状态页签、D4 一屏、D5 时间线、D7 保留文案并「批准实施并提交上库」；T3–T10 完成（b927a15、b8b64e2、8448a29、f1a19bc 与验收批），WS-01–18 实机与用例证据见 acceptance.md，本机 console `cs-console:rfc020-20260923b`，验收批 3b7ec74 的 CI 35771402142 六项成功 |
| [RFC-021](./RFC-021-slot-offline-maintenance/proposal.md) | 待验证版本下线与正式版本维护：负责人与管理员手动下线待命槽、切流后回退目标 72 小时与待验证版本闲置 14 天自动下线（提前 24 小时提醒、可推迟）、从发布记录重新部署；正式版本「维护中」按人放行，用户流量／服务域调用／事件推送三个开关，项目完整维护即破坏性迁移窗口；作废基线「暂停项目」 | Done · 2026-09-23 · 作者七轮裁定 M1–M28 并要求实施、部署与实机验收。T1–T13 完成：1c3586c 后端、1eeb576／3c4076e 工作台，验收中修复 56ff345（改开放策略立即重算放行表）、2e2600b（下线认旧 `rel_…` 标签）、692207c（Pod 身份索引重列清旧行）、80c4e1b（Traefik 保留无 endpoint 的路由）与 635359d；SM-01…SM-18 以五个身份在本机实机通过，证据见 [acceptance.md](./RFC-021-slot-offline-maintenance/acceptance.md)；基线 v0.3.9（R56、R57、§6.9、D56、D57、AT-57、AT-58），「暂停项目」作废；最后一笔 80c4e1b 的 [CI 35825463850](https://github.com/wangbinquan/CrewStation/actions/runs/35825463850) 六项成功；同日修订 T14（作者当面裁定，不另立 RFC）：提醒发出之后才能推迟（槽信息带 `postponable`，提醒前推迟接口 412，按钮「推迟 72 小时下线」，cd80eac），待验证版本空着时「部署版本…」、重新部署弹窗第一行选版本（8e51443），本机 `postpone-20260923` 实机核对见 acceptance.md |
| [RFC-022](./RFC-022-startup-progress/proposal.md) | 启动进度（公共能力）：新开 CLI 六段、开发会话容器五段（重建以「替换旧容器」代替「检出代码」），后端统一产出带起止时间的阶段并存库，平台读 Pod 与 Events 给出调度、拉镜像、检出细节；档位测试迁到同一套；终端区域中间放步骤条，失败停在出错的那段并给出重试与日志；点击创建的窗口自动取得新 CLI 的输入控制 | Done · 2026-09-23 · 作者两轮裁定 D1–D8，第三轮「批准并实施」并裁定 Q1、Q2 取推荐方案、Q3、Q4 不做；SP-01…SP-14 实机验收完成，验收中修复 10 处，见 [验收记录](./RFC-022-startup-progress/acceptance.md) |
| [RFC-023](./RFC-023-postgres-js-driver/proposal.md) | 数据库驱动换成 postgres.js：I16 的根治做法 (b)，Bun 只做运行时、ORM 仍是 Drizzle；连接层、测试库、数据模块的建库适配器改用 postgres.js，行为、表结构与接口不变；以新进程＋突发并发的复现脚本对比新旧驱动，再观察 72 小时 | In Progress · 2026-09-23 · 作者批准三件套；Q1 不保留切回开关，Q2 观察 72 小时，Q3 显式设置连接回收参数 |
| [RFC-024](./RFC-024-cli-interface-ready/proposal.md) | CLI 界面就绪：新开 CLI 的步骤条等到 CLI 画出界面再撤；Runner 在无头终端上按「可见文字＋静止 500 ms」判定（90 秒超时放行），启动进度增加「CLI 初始化」段，旧底座行为不变 | Done · 2026-09-23 · 作者批准，Q1–Q3 取推荐（静止 500 ms、超时 45 秒、代答查询另立 RFC）；实现 652677fa，[CI 35855602907](https://github.com/wangbinquan/CrewStation/actions/runs/35855602907) 六项成功；本机部署 `iface-20260923`、默认档位修订 6，实机 OpenCode 43.2 秒画出界面后步骤条才撤，见 [验收记录](./RFC-024-cli-interface-ready/acceptance.md)；验收后作者裁定超时 45 → 90 秒（T9，75c45cbc，随 RFC-026 的任务底座 `replies-20260923` 上线） |
| [RFC-025](./RFC-025-resource-center/proposal.md) | 统一资源管理中心：声明式台账（各模块写期望、中心存实况）、调和器按种类回收、统一的启动预检、标准资源视图与 SSE 推送、路由随生命周期挂上与摘除（待验证槽为空给说明页）、网关限流；范围含任务类容器、服务槽与构建、路由与切流、命名空间与额度、网络策略、数据资源 | In Progress · 2026-09-23 · 作者四轮裁定 D1–D13 后「批准并实施」（B1–B11、Q1–Q8 按草案，C1–C8 确认）；按计划分六期实施 |
| [RFC-026](./RFC-026-runner-terminal-query-replies/proposal.md) | 终端查询由 Runner 应答：无头终端统一回答 CLI 的能力／光标／配色查询（配色按固定值补答），浏览器 xterm 在新 Runner 下拦下查询不再应答；无人持有输入控制时 CLI 也能画出界面，查询应答不再给控制续租；旧 Runner 行为不变 | Done · 2026-09-23 · 作者批准实施，Q1–Q3、C1、C2 按推荐；实现 ac0b7c3f，[CI 35866042993](https://github.com/wangbinquan/CrewStation/actions/runs/35866042993) 六项成功；本机工作台 `replies-20260923b`、任务底座 `replies-20260923`、默认档位修订 7；实机无人持有控制时 OpenCode 按屏幕判定画出界面，只读查看者 0 条 `terminalInput`，见 [验收记录](./RFC-026-runner-terminal-query-replies/acceptance.md) |
