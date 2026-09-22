# 0008. 退役 egress 模块

- 状态：已接受；作者于 2026-09-22 批准 RFC-018 完整实现，含历史数据清理
- 日期：2026-09-22
- 关联：[RFC-018](../../proposal/rfc/RFC-018-remove-egress-allowlist/proposal.md)、取代 [ADR-0001](./0001-repository-structure.md) 模块清单中的 `egress` 行

## 背景

`modules/egress`（L3）拥有出站 FQDN 白名单条目、追加申请与被阻请求记录，是 Design D47／设计门裁定 G23 的落地。
按设计，这份清单应由出站代理（tech-evaluation E23、Design Q23）对任务容器、构建与服务槽按域名执行。

出站代理从未落地。开发会话、业务任务与构建 Pod 的 NetworkPolicy 自项目开通起就是出向全放行，
唯一真实执行点是 RFC-003 附件 `proxy-egress.md` 记录的 I9(a) 通道，即 cs-api 为 APIProxy 提供的受控 HTTP 转发。
作者 2026-09-22 裁定该约束整体下线，接入容器改为直连上游，因此这个模块没有任何留存理由。

本文只记录结构性后果；产品行为变更由 RFC-018 承担（开发规则 §6：改产品行为立 RFC，改结构规则立 ADR，两样都改就两样都要）。

## 决策

1. **删除 `modules/egress` 整个目录**，包括 `api/ domain/ application/ ports/ adapters/ http/ workers/ tests/`、`wiring.ts`、`index.ts`、`package.json` 与 `README.md`。
2. **删除依赖边**：`modules/platform` 与 `modules/task-runtime` 的 `package.json` 去掉 `@crewstation/module-egress`。
   `task-runtime` 的这条依赖在代码里从未使用，删除不影响其行为；仓库结构 §5 的模块清单与分层图同步去掉该模块。
3. **迁移锁按例外路径处理**：`testing.md` §7 规定已入锁的迁移不可删除，这是为了防止有人改写历史迁移。
   模块整体退役是该规则预留的手工例外，因此手工编辑 `tools/arch/migrations.lock.json` 删除四条 `modules/egress/...` 条目，
   并在提交说明写明原因。不得借此顺手改动其他模块的条目。
4. **数据库清理**：按 RFC-018 的 Q2(b)，升级平台代码后停写备份，再 `DROP SCHEMA egress CASCADE`
   并删除 `platform_infra.migrations` 中 `module = 'egress'` 的四行。删除顺序固定为先升代码、再备份、再删库。
5. **不新增模块**。网络策略对象留在 `packages/k8s`，启动重下发工作器落在已拥有开通步骤的 `modules/provisioning`（L6），
   组合根只做装配。本 ADR 不改任何尺寸上限、分层规则或命名规则。

## 后果

- 模块总数从 19 降到 18；L3 少一个模块，`task-runtime` 的依赖从五个降到四个。
- `platform_infra.migrations` 与磁盘迁移文件重新一一对应，`modules/platform/tests/migrationCoverage.test.ts` 继续以锁文件为准。
- 退役后若需回退平台版本，旧版本会重新应用四个迁移并重建空表；功能数据不会回来，回退前须从备份恢复。这一点写进 RFC-018 的失败模式表。
- 本仓首次出现「删除一个已上线模块」，流程由本 ADR 固定：ADR 记结构后果、RFC 记产品影响、锁文件手工退出并在提交说明留痕、数据清理有备份与复查。

## 例外

无。本 ADR 不申请任何 `tools/arch` 规则例外。
