# 当前 PostgreSQL 基线等待独立采样

2026-10-07，884b13a实际管理员界面已保存76条严格保留确认，唯一当前PG基线在保存及重读时被独立存储探针409拒绝。冻结实际源码完整77条只读复现`native_postgres_source_busy`；独立单项原生读取成功。当前探针TCP对端为平台controller，30秒定时采集与原生来源共享互斥入口；不停止平台采集或放宽身份校验。原项目仍active，尚无删除操作。

本增量仅在当前基线captureCurrent的来源capture／verify中共享60秒总预算，50ms至1秒退避，尝试前核对原保留backend的名字锁。只有明确采样409可等待；原卷替换、不可用、依赖、消费者和持续冲突均继续阻断。普通capture及实际回收阶段保持。

真实PG反例先为1 pass／3 fail，再为34 pass／0 fail、254断言、4文件、92.16秒；持续冲突用例实测61009ms后退出并验证原名字锁已释放。等待期间原卷替换被拒绝，所有原库及角色保持。结构、精确lint、后端／工作台类型通过；官方新增行防护17／17、100%、0违规。两个功能文件冻结指纹前后不变，原专用PG容器d12386b3保持；没有操作原项目。

此前HTTP候选唯一完整check的6306 pass／157环境skip／2 fail、并行观测WIP失败及全部原始日志继续保留，不能记成本增量的完整门通过。按development-rules §3精确本增量检查接干净提交树的确切六CI，保留全部并行内容；提交／CI／部署及原项目全部22方清理和独立AFTER仍待实际完成。

私有回执：cs-rfc037-i36-http-idle-full-repair-diagnostics-v1.jsonl；cs-rfc037-i36-pg-sampling-red-v1.log；cs-rfc037-i36-pg-sampling-targeted-v1.json；cs-rfc037-i36-pg-sampling-static-v1.json；cs-rfc037-i36-pg-sampling-patch-v1.json。
