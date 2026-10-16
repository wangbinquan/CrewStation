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


## 2026-10-16 推荐方案部署及实机缺陷修复

推荐实现提交 `3c1d2eab1a71430045f18624139991834f5bb8b2` 的 [CI 38887997096](https://github.com/wangbinquan/CrewStation/actions/runs/38887997096) 九项全部成功。四份追加迁移通过独立 Job 应用，八个系统 Deployment Ready；正式 AW 蓝绿 Pod 的 UID 与零重启记录保持。

实际 API 复制档位时发现旧纯摘要引用被存成裸仓库路径，复制返回 400。修复保留 tag/digest，并且只从该修订已冻结摘要补全精确旧平台裸路径。实际恢复页还发现开发数据库被标成当前生产，已将该列表限定为生产数据库。修复提交 `15f6eee2de2878318a75ca2a948c44b7aded8afa`，九个精确路径，[CI 38894628979](https://github.com/wangbinquan/CrewStation/actions/runs/38894628979) 九项全部成功；8 个系统 Deployment 已更新且 Ready。

修复本地集中门禁：结构、lint、两侧类型通过，5950 项中 5773 pass／176 skip／1 fail。唯一失败为未改动的 `modules/task-runtime/tests/deletion/owner.test.ts` 原有 CAS 清理用例超过 5000ms；完整门禁结束后保持文件与超时不变，整文件 6 项通过，原超时项 1959.86ms。原失败记录保留，不写成一次全量全绿。另有档位 33 项、恢复页面 9 项定向检查通过。

按实际 OCI manifest 部署：控制面 `sha256:00753389f3ef28940211ef37e02e000da93f5bee6c4d2ae7b7a3ddeccee70d2e`，Console `sha256:b6b8b7f09cd57f1788bd098b97296ad61ac412c8d9ef242b5f13ae8acd68379f`，Runner 保持 `sha256:5f389279419c1a967aea7dcb57a4f5c4c2d47774b373172a26fb3ce49e3a2268`。镜像源码与已提交 blobs 核对一致；正式 AW 两个 Pod UID `67808ecd-2cb8-418b-98f1-4e7ce338bce3`、`0039a97f-e2ae-4647-9913-a99b4839c1cc` 仍 Running/Ready、0 restarts。

Chrome 正式页面与 390px 窄屏验证：仅有一个原生产数据库世代；开发世代不出现。页面 scrollWidth=390；空恢复版本时禁止创建；取消统一表单后焦点返回新建恢复按钮。截图、结果在 `/private/tmp/cs-rfc042-ui-acceptance-r3.json`。这不替代恢复 Job、独立 verify Job 和显式切换的实际验收。

原验收服务的 v0.1.3（`424645c203a618a73d07f5b8e94a23cd41b1878b`，发布 `01a1446e-1c6f-7000-9db6-4bb60c5ae834`）已完成构建，迁移请求 500m CPU，单节点剩余额度约 295m，故 Pending/Insufficient cpu。已通过正式 pause API 暂停本次旧闲置父任务 `01a14294-79d0-7000-b7d6-f0db13390656`，保留原 PVC UID `67b82c7d-980a-4de0-bedc-7d50428816d9`；没有暂停其他项目。原生产数据库未切换，独立恢复与切换仍未验收。

OpenCode 双模型使用另外的 50m 服务／100m 任务隔离项目 `rfc040-two-model-20261016`（`01a1447f-5806-7000-a736-47bf6783f71f`）。两个隐藏副本已实际复制并保存到 r2：GLM `01a14489-d40c-7000-8179-fd183c445c4b`，DeepSeek `01a14489-d4f8-7000-bbac-f691878394df`。源档位 r3 与默认档位 r16 的 contentHash、内容、凭据状态和默认标记均与原快照相同。真实兼容探针运行中，跨模型内部委派尚未宣称通过。

机器回执：`/private/tmp/cs-rfc040-rfc042-repair-ci-result.json`、`cs-rfc040-rfc042-repair-deployed.json`、`cs-rfc040-digest-gate-reconciled.json`、`cs-rfc040-source-profile-preservation.json`；完整失败日志与之前已通过的实机记录保留。RFC-040/042 继续 In Progress，只验证 OpenCode。
