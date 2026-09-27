# RFC-033 验收记录

2026-09-27，用户已批准实施、远端上库与本机部署。起点 `a2d019103197bb42bf2c7d2104fca6a07a30d196`。aw 没有改动。

## 自动化证据

- GitLab 评论回归先红：3 fail（缺 Note Hook、编辑指纹冲突、错误评论返回 202）。实现后原事件与评论全部通过。
- 两 producer + 真实 PostgreSQL events 模块：57 pass / 0 fail，364 断言；`/tmp/cs-rfc033-targeted.log`。
- 模板发现／物化：6 pass / 0 fail，46 断言。新 GitHub 模板为不同项目分配独立 Secret UUID。
- 新目录涉及的角色首页／应用权限／约定扫描补验：7 pass / 0 fail，46 断言；`/tmp/cs-rfc033-template-regression.log`。
- `bun run check:static` 通过；两 standalone tsconfig 通过；standalone `eslint --no-ignore` 通过。
- 定向 lcov 的本任务受保护生产改动：147/147 可执行行覆盖，11 文件全部加载；`/tmp/cs-rfc033-patch.json`。
- GitHub 独立 Docker 镜像 `sha256:ec8ae1c445c8656100591707c096ea8f297f099e717cbd2d65baf763cad1a29c`；GitLab `sha256:262a9b1facbd3d0082ad7f2d36a68f0ae8a8fd7671d95741f46e28c22bccb581`。

## 完整门禁与并发边界

共享门禁 `/tmp/cs-rfc028-owned-layout-full-normal.log` 在本任务实现前启动，执行中扫到中间模板状态，最终 3510 pass / 54 skip / 56 fail（3620 tests, 685 files）。本任务导致的4项失败（模板未写完时的两项平台目录、模板数量、约定目录断言）均在完整候选上定向修正／复验。剩余涉及既有实机登录／集群页面、预览进程、GitLab会话权限与并发inline镜像代码；不把该全量报告记绿。自动审批拒绝重复启动第二轮完整门禁，已遵照并复用现有报告，以新增定向检查补齐。最终整仓结论以精确提交SHA的 GitHub CI 为准。

共享 STATE 包含 RFC028 的并发进展，完整保留；运行镜像、工作台、referenceResources 等其他在制源码不纳入本任务提交。

## 验收项

| 标准 | 当前证据 |
|---|---|
| CE-01/02 | GitLab Note 类型/编辑指纹/原 payload/时间与原事件回归通过 |
| CE-03/04 | GitHub 全矩阵、原始UTF-8签名、ping/JSON/事件身份与delivery去重通过 |
| CE-05 | 两producer坏回执拒收；GitHub超时/网络/非2xx；真实PG入库后丢回执重送同一inbox通过 |
| CE-06 | 40类型真实发布登记、模板UUID物化、两独立镜像构建通过；实际平台发布待验 |
| CE-07 | 两producer→实际events HTTP入口→真实PG→真实HTTP消费者；重试/dead/replay/切槽与身份保持通过 |
| CE-08 | 待本机隔离项目协议验收；不宣称真实GitHub公网回调 |
| CE-09 | 原事件/模板定向绿、静态绿、覆盖绿；精确SHA CI待执行 |

## 发布与本机

待补充精确提交、CI、控制面模板部署、独立项目release及投递回执。已有 GitLab 项目不因模板源码更新自动升级；升级步骤在其README。GitHub按需开通，不修改安装默认项目集合。
