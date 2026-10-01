# RFC-036 发布与部署后验收

2026-10-01 拓扑聚合修正的后续发布、部署与实机验收见 [同类资源聚合修正验收](./grouping.md)。

状态：Done · 2026-10-01。资源中心主体和部署后自查修正均已发布并部署，实际管理员变更已生效；精确 SHA `d66371fd89195fa252c9b7e8b44de2bf9e2cd743` 六项 CI 成功，更新后的实际页面复验通过。

## 已发布的主体与依赖

自有实现提交 `b16f5140898352a6218bba0618d3c856fb3d5fd3`、组合接线提交 `cc56ee8818bdb87d76932a5fe3affd947d7e39ef` 均已进入远端主干。原先缺失的 16 个外部根依赖已全部提交，`/private/tmp/rfc036-publication-dependencies-resolved.json` 保存实际 Git 对账。此前的未提交、池耗尽、超时与门禁失败是历史记录，不再代表当前发布状态。

资源中心组合回归在当前接线上为 **11 pass／0 fail、137 断言**：命名空间调和与清理、资源目录、真实关系。日志 `/private/tmp/rfc036-post-integration-regressions.log`。未代改并行删除准入代码。

已核对 `333e631ddfaac5b34ec44ee8d7fcd2fa7de420c0` 的 [CI 36783829899](https://github.com/wangbinquan/CrewStation/actions/runs/36783829899)：unit、module、static、console、e2e、gate 六项均为 completed／success。此 SHA 包含资源中心全部主体与组合接线。

本机 `docker-desktop / crewstation-system` 的八组件在独立读取时均 Ready=1，generation 与 observedGeneration 一致。控制面摘要 `22b5c24b1bb23732ec1a9bcad9324668140833a8567821bb29961aaa8f8619ed`，console 摘要 `2a4b295bdea071b44e5120ad85fe3e2bc1d7ef02793483eb66fc05bb8106edee`。迁移 Job `rfc037-migrate-333e631ddfaa` 为 Complete=True；实际读取证据 `/private/tmp/rfc036-deployed-source-proof.json`。这次部署由共享主干的 RFC-037 发布完成，本任务独立核验实际集群与页面。

## 实际页面与持久回执

使用既有 `dev-admin` 管理员会话，检查已有项目 `RFC035 服务对象存储验收`（`01a0e955-7714-7000-8e27-16c2372b16a5`）。只刷新同一账号的登录，没有切换真实身份、新增访问授权或创建／终结工作负载。

- 项目侧 `/projects/:id/resource-center` 与管理员侧 `/admin/projects/:id/resources` 均实际加载。快照有 22 个来源、80 项已有能力；未开放的目录不伪装为可申请资源，当前可申请数为 0。管理员完整清单含不可申请目录，总计 127 行，不能把这两个计数相加。
- 管理员在资源节点的同页弹窗中核对并提交执行配额 **3 → 3**。记录 `01a0f4aa-28c3-7000-8ea8-86ff6fc68534` 从「已批准 · 待应用」转为「已生效」。实际 PostgreSQL 记录为 applied、version=4、attempt=1，base／requested／approved 均为 3，持久 receipt.applied=true；应用时间 `2026-09-30T23:33:07.609Z`。`/private/tmp/rfc036-live-durable-receipt.json` 保存读库回执。这证明真实提交、调度、应用和审计接线，不将它称为实际扩容。
- 变更前后项目的 4 个 blue／green Pod UID、镜像完全一致，没有新增 Pod 或 PVC。`/private/tmp/rfc036-resource-validation-before.json` 与 `after.json` 保存对账，missing／changed 均为空。
- 同页管理员改值批准／驳回／重试、负责人申请／撤回、开发者禁止提交、失去角色后拒绝旧表单，由真实隔离 PostgreSQL＋HTTP 及正式路由渲染回归覆盖。本次实际浏览器仍使用管理员身份，不把模拟角色或隔离库验收写成真实账号切换证明。

## 实际拓扑与交互

生产对象空间详情显示双槽及服务使用同一个空间，开发数据库独立。20 GiB 空间、1 GiB 单对象、4 个并发传输、已用／预留及计量范围分别展示。生产数据库显示共享容量。图上的 4 个 Pod 节点逐一匹配 kubectl 所见 UID，证据 `/private/tmp/rfc036-browser-pod-matches.json`；物理 Deployment 与 Service 保持独立身份。

1280×720 下放大拓扑的弹窗为 x=16…1264、y=16…704，页面横向溢出为 0。资源清单连续加载至 127 行，末行打开统一弹窗；Esc 后仍保留全部行、筛选和原行焦点。配额详情／表单／确认三层弹窗均在视口内；Esc 只关闭最上层，草稿保留，清空回到原值。

项目页 390×844 自动回退清单，详情为 x=16…374、y=77.02…766.97；320×720 时为 x=16…304、y=16…704。管理员英文页实际 320×720 检查相同边界。均无页面横向溢出；验收后恢复中文。实际浏览器检查浅色主题，深色与完整角色旅程的隔离预览证据仍单独保留，不混作实际身份或集群证明。

## 部署后发现的修正

1. SVG 节点打开详情后关闭，焦点落到 main。通用弹窗的触发者类型只识别 HTMLElement，现支持 SVGElement；用红回归复现后修正，并保留既有 HTML／嵌套弹窗行为。
2. 已生效记录的指标显示参数名，且把申请时数值称为当前配置。现使用已有双语指标标签，将只读历史值明确标为「申请时配置值」，批准后不用旧检查缓存冒充当前生效值，原申请与批准值独立保留。

这 8 个源码／用例文件已精确提交并推送 `d66371fd`，提交清单、署名、空暂存区、远端同步已核对。修正没有改后端合同或数据库迁移；只需更新已提交来源的 console 镜像。

同一稳定候选于 `2026-09-30T23:42:34Z…23:58:03Z` 完成一次完整 `bun run check`：结构、lint、两次类型检查均通过，**4694 pass／143 skip／0 fail，30884 断言、940 文件**。8 个候选文件前后指纹完全相同；日志 `/private/tmp/rfc036-deployed-fix-full-check.log`，回执 `/private/tmp/rfc036-deployed-fix-full-check-receipt.json`。本机跳过项保持明确记录，实际浏览器验收单独列证。外层证据脚本在保存成功回执后曾因对只读子进程属性赋值而报错，原门禁退出值是 0；已修正记录器，没有重跑同一稳定候选或把其错误藏成测试结果。

从该提交的 Git 归档构建 `cs-console:rfc036-d66371fd8919`，镜像 revision 标签与提交 SHA 一致，没有使用共享工作树中的其他在制内容。[CI 36793848612](https://github.com/wangbinquan/CrewStation/actions/runs/36793848612) 的 unit、module、static、console、e2e、gate 六项均 completed／success；精简逐项回执 `/private/tmp/rfc036-d66371fd-ci.json`。

2026-10-01T00:16:21.383Z 完成 console 独立更新：源镜像 config ID `20eb351b0d5aad425204824e37f0c143839266105df4aa45c6a3c2274d223a76`，实际导入 manifest 摘要 `a2094cfebb47e7438531240267d7a05b8cda9bbeaf31fa7340d35854a4d82e9c`，两者不混用。console generation=observedGeneration=214、Ready=1，Pod 模板 source-sha 为 `d66371fd`；storage contract=1。其余七组件保持本次读取到的就绪状态和控制面摘要 `159a1469fedb96d92d22912833078a7c928f5fb1226733cfcdba9b6be07664fe`，未以旧 `333e631d` 镜像冒充当前值。该批仅更新 console，无新增迁移；八组件实际回执 `/private/tmp/rfc036-console-deployment-receipt.json`。本次更新前后 Runner 摘要 `e7b0153ee23280606b90f88f6cf198543f1fb8d467e13f904c089d0f2cdd6da4` 保持；验收项目原四个 Pod UID／镜像无丢失或变化。

实际管理员资源页刷新后，鼠标点击和 Enter 键打开执行额度 SVG 节点，再用原生 Esc 关闭，两条路径均回到原 `g[data-node-id]`，namespaceURI 为 `http://www.w3.org/2000/svg`。已生效记录显示「执行并发上限」与「申请时配置值」，不再出现原始参数名；原申请、申请时配置与本次目标值分别保留。1280×720 下记录弹窗 x=200…1080、y=73.20…646.79，横向溢出 0，实际浏览器警告／错误为空；`/private/tmp/rfc036-postdeploy-ui-proof.json` 保存 DOM 与焦点证明。最终截图已更新为该已部署版本，临时视口已恢复。

## 截图

- [实际数据拓扑](acceptance-screenshots/deployed-data-topology.jpg)
- [实际配额二次核对](acceptance-screenshots/deployed-quota-review.jpg)
- [实际变更已生效](acceptance-screenshots/deployed-quota-applied.jpg)
- [项目页窄屏详情](acceptance-screenshots/deployed-mobile-detail.jpg)
- [管理员页英文窄屏详情](acceptance-screenshots/deployed-mobile-english.jpg)
