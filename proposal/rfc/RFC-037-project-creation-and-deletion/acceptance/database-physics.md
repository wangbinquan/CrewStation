# RFC-037｜数据库物理来源候选回执

2026-10-01；对应 [原 OID 物理来源](../database-physics.md)。data-control 的原生只读适配器已实施，公开 API 供组合根核对已固定的数据库身份和目录；不签发删除许可，不执行正式项目 DROP。

## 实际执行

7 项真实 PostgreSQL／43 断言通过：原 base 目录在场和正常 DROP 后目录消失、重复实际证明、同名新 OID 与改名保护、初次 absent 和坏身份拒绝、tablespace 完整盘点、catalog 已删但原目录／普通文件仍在的反例、未知根内容阻断、原 tablespace 源消失阻断、连接故障与正式模块连接关闭。保留用例中的另一个独立数据库原 OID／目录。

特殊文件／目录反例只写各用例生成的唯一测试 tablespace 路径；清理先由原生 DROP TABLESPACE 核对无残留，再 rmdir 空根。不修改共享 PostgreSQL 配置，不清理正式项目或未知目录。测试覆盖的是原生来源适配，正式 project 删除的 grant／seal／消费者排空与实际 native DROP 协议仍须接齐。

data-control 组合为 **43 pass／3 skip／0 fail、251 断言、12 文件**；3 skip 为未启用的实际 Garage 环境，不算物理回收成功。新执行行 **67／67，100%**，有运行逻辑的改动文件均加载。第一次结构检查指出 api／index 不能引用 ports，已将公开只读输出结构放入 api 后通过；没有添加例外。

与网关的最终覆盖组合为 **185 pass／3 skip／0 fail、1528 断言、42 文件、51.37 秒**，全部合并改动执行行 **439／439，100%**，30 个改动生产文件均加载或核实为无运行逻辑。完整 `bun run check` 为 **4797 pass／143 skip／0 fail、4940 tests、955 文件、31775 断言、1096.24 秒**，静态四层通过。6 个本批源码／测试指纹前后保持；网关此前冻结的 39 个源码／测试／配置路径也完整保持。前一轮仅网关候选的六项并行界面失败仍保留在其回执，不抹掉旧运行。

共同发布基线为 `50dbd7a7464bbdd7ca304eb82dc2c47146f068fa`：并行 owner 已发布 runtimeFactSources 与开发来源 API，网关、数据库以及合并的精确提交树后端／console 类型均 0 诊断。共享 platform/wiring 保留并发布 RFC-034 的开发统计接线，其来源实现在前述独立提交中；不剥离共享输出。不重复完整门禁；最终候选路径、hash、覆盖与发布记录位于 `/private/tmp/cs-rfc037-gateway-database-*`。native 文件来源和正式 22 owner 删除／实机回收是分别验收的工作。

精确暂存检查额外发现一项格式问题：projectDeletionWork.test.ts 的最终 describe 语句之后多了一空行。只移除该末尾空行，其他字节与门禁快照完全一致；标准化摘要一致，回执 gateway-database-eof-format-proof.json。没有修改运行逻辑或用例断言，不重跑完整门禁；正式提交前重验该文件的真实 PG callback 用例和暂存格式。

## 边界

当前尚未取得合并候选的精确 SHA CI 或部署；原数据库执行步骤、角色清理、旧新供给屏障、对象／SCM 等其余 owner 和管理员二次确认界面继续。专用实际项目仍保留，永久删除入口关闭。模块增长和后续拆分提议见 [ADR-0012](../../../../docs/adr/0012-project-resource-owner-growth.md)，没有实施模块／schema 转移。
