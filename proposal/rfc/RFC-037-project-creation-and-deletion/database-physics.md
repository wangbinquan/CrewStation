# RFC-037｜PostgreSQL 原数据库物理来源

这是设计 §6.2 的来源适配器补充。实现仍在 data-control L2，由自己的 adapters/postgres 提供原生只读盘点与复核，输出结构落 api/ 并经公开 API 提供组合根，不反向 import ports。不新增模块、layer、跨 schema SQL 或结构例外。当前 data-control 有 30 个生产源码文件；本来源适配器新增两个，保持 40 个／6000 行的边界。

## 原身份和实际文件

台账原 OID 与原名字必须同时匹配才能固定来源；不从当前 slug 猜库，也不把首次读取的 absent 变成完成。来源摘要绑定原管理端点、PostgreSQL system_identifier、data_directory 摘要与原控制／catalog 版本，不保存管理口令。位置清单含 base 原 OID 目录与实际发现的非内置 tablespace 版本目录；不读取任何业务文件内容。

PostgreSQL 的数据库文件位于 base/<OID>，或 tablespace 的 PG_<版本>/<OID>。盘点实际列完整 pg_tablespace 与 pg_ls_dir；未知目录形状、不可读来源或实际位置消失都报错。复核先确认原服务器和每个原 tablespace 的位置、版本目录仍可读，再检查原 OID 目录。原数据库 catalog 消失但原目录存在时仍为 present；源目录／版本目录本身不可访问时拒绝给出 gone。同名新 OID、原 OID 被改名、服务器更换和 tablespace 位置改变均阻断；其他数据库与共享 tablespace 不删除。

读取前后重新核对原服务器、catalog 名称／OID 和位置，不为一次跨越变化的读取签发证明。新增 tablespace 也需完整检查该原 OID；发现未知或残留文件不能通过只复核最初一页遗漏。合法 gone 回执包含原身份摘要、全部实际目录的无残留摘要和观测时间，不是台账 absent、API 404 或一个 DROP 命令的成功回执。

此接口只提供原生来源和文件核对。调用方必须先取得正式 project 删除许可，完成所有原写入／连接回调和消费者排空，然后才能用于 purge／verify；读取适配器自身不签发授权或停止回执。当前不开放数据库删除、产品删除入口，也不把本适配器的通过算作完整数据库 owner 完成。

## 后续执行协议

正式 owner 仍须接齐 resources 的全部历史原记录、data 的旧供给路径、credential 与 pending rotation、实际 CREATE／ALTER／DROP callback 的持久最小意图与原 Pod／容器停止证明。全部平台原生 DDL 必须共用原名称串行屏障；删除仍显式按原 OID 校验，消费者停止后处理临时角色、原库和原运行角色。DROP DATABASE 不能置于事务块内；prepared transaction、逻辑复制槽或 subscription 不靠 FORCE 绕过，失败继续等待或阻断。

在完成原生非事务 DROP 的竞态设计与丢回执恢复前，不将既有按名字的 DROP IF EXISTS/FORCE 暴露为正式销毁入口。来源复核能证明原文件实际消失，但不能替代仍运行的创建／DDL 回调退出；反之，callback 的实际退出也不能代替文件回收。

## 用例与来源

真实 PostgreSQL 用例覆盖 base 原目录、合法 DROP 后物理目录归零、同名新 OID保留、原库改名保留、初始 absent 拒绝、错误 OID 拒绝、原服务器摘要变化拒绝、tablespace 源变化／未知形状拒绝、观测故障不冒充 gone，以及其他数据库 OID／文件保持。用例只创建和清理自己的独立测试库，不删除正式验收项目。

官方来源：[数据库文件布局](https://www.postgresql.org/docs/current/storage-file-layout.html)、[系统管理函数](https://www.postgresql.org/docs/current/functions-admin.html)、[DROP DATABASE](https://www.postgresql.org/docs/current/sql-dropdatabase.htm)。此设计与原生用例不等于部署或正式项目物理回收验收。
