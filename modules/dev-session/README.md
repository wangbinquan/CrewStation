# dev-session（L5）

一项目一会话、分支与落后提交数、空闲提醒、强制释放、发布入口

模板与规则见 `docs/engineering/repository-structure.md` §3。

原生 CLI 以持久启动身份对应独立执行环境；后台串行准入、派发和退出末屏回收，历史父 Runner 名册继续兼容。动态按各 Runner 的来源游标汇入工作区统一序号，末屏另行按需读取。
