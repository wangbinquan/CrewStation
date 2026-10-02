# SCM 原范围和阶段 owner 候选

接续已批准设计 §6.2 与 [独立来源约束](../scm-physics.md)。本批形成内部 owner、自己的不可变范围和阶段存储；独立 GitLab／文件系统来源尚未接线，不代表实际物理回收。产品删除入口仍关闭，原验收项目保持。

## 行为与持久约束

- `scm.api.deletionOwner` 仅在装配独立物理端口与持久控制器许可时提供。盘点包括所有保留绑定、凭据、回调、副作用、仓库来源和别名；跨项目远端引用、未知原时间或机器人、丢失返回值与未登记内容表明确阻断。
- 物理端口必须逐原仓库完整覆盖主／Wiki／design／Snippet／LFS／上传／制品／trace／包／registry／secure file；空类别也要有独立覆盖。原数字 ID、创建时间、路径、来源 epoch 与原文件身份固定到本 schema，重放／新世代不重新认领当前同名仓库。
- seal 关闭写入；stop 先核对平台原回调真实退出，再核对独立生产者／消费者；purge 与 prove 必须按原范围观测。API 对象已经消失而文件尚在仍等待，非独立来源或未退出消费者不能落证明。
- metadata 必须有三项前序持久证明，并再次独立复核；同一事务清除本项目全部内容、凭据及别名。verify 继续读取固定原来源并复核元数据，才删除详细范围并留下不可重开的最小退休墓碑。每项外部动作及事务前后验证原许可。
- 只追加 `0007_project_deletion_scopes.sql`，0005／0006 字节保持。直接 SQL 不能替换原范围、清除退休保护或提前删除回调／来源／别名。旧库已经存在的跨项目远端引用保留并报告；即使本项目当前行为空，也沿固定远端 ID 查询其他项目引用。
- 将源码查询归入既有仓库查询，将构建凭据归入既有凭据生命周期，发布代推／打标归入同一仓库写入概念；原断言保留。SCM 生产文件仍为 40，没有扩大结构上限。

## 当前验证

既有 55337／prepared10 隔离 PostgreSQL：八文件较宽组合 **48 pass／0 fail、346 断言**，包括旧库升级、跨项目保留、全部阶段、受理失回执、新世代、实际许可失效、原文件残留和直接 SQL 拒绝。物理端口为受控夹具，不能计真实 GitLab、消费者或卷回收通过。

18 个 SCM 路径的改动行 **280／286（97.90%）**，全部必要生产文件已加载，无例外；精确 lint 通过。HEAD 提交树叠加本批 SCM 与删除工作流路径的两侧类型均为 0 诊断，`arch:check` 通过。新的迁移按路径入锁，另一会话 0019 条目保留。

失败原件保留：跨项目旧夹具首先重复了路径唯一键，改为各自不同的旧路径并保留重复远端 ID；较宽首轮因严格表清单新增 scope 表而失败，保留全部原表断言并显式增加该表。类型问题按品牌 Schema 与明确阶段结果类型修正，未绕过生产类型检查。

私有原件：`cs-rfc037-scm-owner-coverage-tests-final.log`、`...-coverage-audit.json`、`...-types-final.log`、`...-lint-final.log`、`...-arch-2.log`；UI 自动进度修正后的组合类型回执为 `...-and-auto-progress-types.log`。旧失败日志保留，不能计为通过。

初次候选记录时尚未提交／部署；后续精确终态见下节。仍须完成实际独立来源、全部 owner 和 Root／API／管理员入口、原项目完整回收与 PD 实机对账；内部工厂、阶段存储和协议安装各自不代表永久回收已完成。

## 精确发布部署与只读实机验收

本任务42路径精确提交 `e40330cde9e337a4f1d0617a98bfb2ebd2357384`，其父为观测会话30路径提交 `8cc810915670e32da0da719372e9c7884a662b81`。共同72路径稳定候选V3完整检查 **5118 pass／143 skip／0 fail、34614断言、999文件**；候选内容及既有隔离PG身份保持。前一V2因长门禁已导入旧适配器后新增归档用例而失败，原结果保留；V3覆盖完整冻结候选。所有210项迁移锁依赖均来自这两个精确提交或既有提交，没有包含并行RFC-036文档／原型。

[该SHA的CI36975154942](https://github.com/wangbinquan/CrewStation/actions/runs/36975154942)六项终态成功。2026-10-02T06:59:37.926Z，精确提交树构建的镜像完成八组件部署，Ready均为1；迁移任务成功。原共享PostgreSQL、原只读探针的Pod／镜像／策略、Runner和原项目对象保持。

实际API Pod `ef5ccf8b-0ef8-4dc8-987c-4826ca3e4da1` 的已安装Root、SDK和适配器只读验收通过：SCM `0007_project_deletion_scopes.sql` 校验和 `4ac20b1279ff339586268b87c8aa6801be2d500cc284e6643cc5b36385cefafe`，task_runtime `0019_development_parent_endings.sql` 校验和 `aec14559d1762fab7cd4d05924bb9864b6ea022d7e8c668447b471ba18ae7dbc`，均匹配已发布源文件。原GitLab数字ID383、创建时间与路径保持，`archived=false`；全部旧令牌状态及本项目元数据历史重放稳定。原GitLab容器和项目Namespace／Pod／PVC／PV保持，52个PostgreSQL库与64个角色的全部名字及OID前后相同，原验证库OID276598保持。

首次私有验收脚本把迁移模块名写成 `task-runtime`，没有查到实际 `task_runtime` 行，导致断言失败；两份失败原件保留。只修正验收脚本后V3通过，未改产品代码或迁移、未签发令牌、未POST归档或DELETE。实际Root仍没有装配SCM物理端口／完整删除控制器，管理员永久删除入口关闭；观测父结束producer保持OFF，不能据此称其完整链路已完成。

终态私有回执：`/private/tmp/cs-rfc037-scm-owner-published-and-installed-handoff.json`；安装回执为 `cs-rfc037-e40330cde9e3-scm-scope-readonly-v3-receipt.json`，原失败V1／V2及完整门禁V2均保留。发布后再次fetch核对本地main与origin/main同为本SHA、0／0，索引为空。
