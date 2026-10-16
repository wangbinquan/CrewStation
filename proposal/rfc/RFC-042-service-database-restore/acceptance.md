# RFC-042 集中验证记录

> 2026-10-16，In Progress。生产实现和用例已完成，准确 SHA CI、真实独立服务恢复与正式 UI 验收继续。

作者已批准独立空库恢复、独立验证、显式维护及切换、保留原库的推荐方案。此候选同时包含 RFC-040 的平台档位子模型映射和此前恢复页深链补充；只执行 OpenCode 真实模型验收。

集中门禁使用 Bun 1.3.13、独立 PostgreSQL 17.11，max_prepared_transactions=10，未修改正式数据库参数。前一轮门禁保留了日期原始 SQL 绑定、原型键输入、触发器操作符优先级及旧测试断言等失败；已修复并按相关范围复验。最终完整 `bun run check`：结构、lint、根及 console 类型通过；1213 文件／5947 用例，5770 pass、176 skip、1 fail、1 error。唯一失败在未改动的 `modules/resources/tests/projectDeletion.test.ts`：全量历史清理用例 6208.81 ms 超过原 5000 ms，后续清理连接 CONNECTION_ENDED；门禁期间 177 个候选文件摘要均未变化。

全量结束后，未改动该测试、未提高超时，空闲环境仅复验该文件，退出 0，4.56 秒。原失败与跳过证据保留，不把此合并证据表述为一次全量全绿。RFC-040/042 修复范围的最后一次 8 文件复验为 46 pass / 0 fail；最终完整门禁覆盖了这些修复。准确 SHA hosted CI 尚未取得，尤其不把跳过的 e2e/外部服务当作已验收。

三个镜像已从稳定源码构建，候选摘要 `0dc964381d15`；构建前后源码一致，存储兼容预检和按配置／manifest 摘要校验导入完成。配置摘要：

- 控制面：`sha256:612c1c095471c8601ca1d4ec2a5cea0a42f8b959791e31e0846bed63a70e3eb7`
- Console：`sha256:bdc5d63fda3cf972e7595d6c43abda6bad28fbd142481603e8b5cb9f2ad40dbe`
- Runner：`sha256:158dc0d111c5f19040cdeac6c86fa04d8dec7906466ea23cbbd4d70b0bbc4a1c`

新增迁移为 data/0009、gateway/0013、release/0013 和追加修正 release/0014，共四份；历史迁移字节未改。此记录写入时尚未应用到正式控制面。迁移 Job、一个 CS_TASK_IMAGE 配置键和八个系统 Deployment 的 UID／原镜像 CAS 补丁已准备，正式 AW 命名空间不在变更清单中。

后续验收：在隔离服务中验证 GLM-5.2 根与 DeepSeek V4.1 Flash 子代理的实际内部委派和原模型身份；真实备份对象、独立新数据库、恢复 Job 与 verify Job 原 UID／环境／镜像证明、切换前原库继续工作、显式维护后的三方绑定一致、切换后原库保留；正式页面和撤权边界。不能以单元测试或仅同模型探针替代。

本机证据：`/private/tmp/cs-rfc040-rfc042-central-validation-final-20261016.log`、`cs-rfc040-rfc042-final-gate-receipt.json`、`cs-rfc040-rfc042-quiet-project-deletion.log`、`cs-rfc040-rfc042-quiet-project-deletion-receipt.json`、`cs-rfc040-rfc042-built-images.json`、`cs-rfc040-rfc042-targets.json`、`cs-rfc040-rfc042-deployment-plan.json`。

发布前 `git diff --check` 检出新增代码一处行末空格，已仅删除该空格，逻辑词元保持一致；按新原始字节重建候选 `883cc424539e`，控制面配置摘要变为 `sha256:e84b02b3be98f766a9e26bcbb16c96bb6686e64b6362109111f2f4ea7e31c59f`，Console／Runner 配置摘要与前一候选相同。原门禁证据按语义不变复用，不重复全量测试。见 `cs-rfc040-rfc042-whitespace-receipt.json` 和 `cs-rfc040-rfc042-built-images-r2.json`。
