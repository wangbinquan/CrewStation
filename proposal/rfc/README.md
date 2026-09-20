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
| [RFC-013](./RFC-013-resource-uuid/proposal.md) | 平台资源统一 UUIDv7：完整 36 字符 ID、名称与身份分离，覆盖套餐／档位／模板／API／事件／配置／步骤及旧数据迁移 | In Progress · 2026-09-21 代码随 73aa132／a1b87a1 上库，CI 35543847392 六项成功；旧库副本升级与 97.4% 防护通过，实际数据切换及升级后运行态验收尚未执行 |
| [RFC-014](./RFC-014-identity-admin-ux/proposal.md) | 用户与权限、认证 UX：紧凑用户目录与按需角色编辑，登录方式与身份字段分组，接入方配置和诊断重排 | Done · 2026-09-21 T1–T8 完成；44 项定向、共享候选完整门禁与实机布局通过，a1b87a1 的 CI 35543847392 六项成功，见 [证据](./RFC-014-identity-admin-ux/acceptance.md) |
