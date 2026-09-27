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
| CE-06 | 40类型真实发布登记、模板UUID物化、两独立镜像构建及实际平台发布通过 |
| CE-07 | 两producer→实际events HTTP入口→真实PG→真实HTTP消费者；重试/dead/replay/切槽与身份保持通过 |
| CE-08 | 三类评论经本机网关、真实events与持久消费者验收通过；不宣称真实GitHub公网回调 |
| CE-09 | 原事件/模板定向绿、静态绿、覆盖绿；两次生产代码精确SHA CI六项全绿 |

## 发布与本机

已有 GitLab 项目不因模板源码更新自动升级；升级步骤在其README。GitHub按需开通，不修改安装默认项目集合。

### 已发布代码与运行产物

- Producer：`c072aef6c4f125ac921a05d9fb0cb33305582a58`，[CI 36327299347](https://github.com/wangbinquan/CrewStation/actions/runs/36327299347) 六项 success。
- 实机发现普通服务鉴权提前返回 `403 unknown-workload`，已补当前正式 EventProducer 精确 POST 入口策略，提交 `493bd47a1b4bc06a019c5b51b331ff2908c82c94`；[CI 36329342501](https://github.com/wangbinquan/CrewStation/actions/runs/36329342501) 六项 success。
- 网关新增回归 19 pass / 0 fail、127断言，包含完整模块装配与真实PG的上线／维护／下线；静态检查通过；新增生产可执行行35/35覆盖。
- 控制面模板已随并行发布 `a12c7d13` 上线；鉴权镜像从 `493bd47a` 的提交归档构建，只滚动 `cs-auth` 到 `cs-control-plane:rfc033-493bd47a`，rollout 成功。其他控制面和console保持并行会话已验收的 `inline-a12c7d13`。

| 本机项目 | 正式版本／发布ID | 源提交 | 结果 |
|---|---|---|---|
| GitLab producer | v0.1.6 / 01a0e364-2615-7000-ae57-9a362e8398ab | 50ff4840fca7430cb581eb5178f4bffe98284a67 | ready，1/1 |
| GitHub producer | v0.1.1 / 01a0e367-d114-7000-86eb-b819ee0e6ac5 | c6a489926be352f5afa088041933d145d7424ea7 | ready，1/1 |
| 隔离消费者 rfc033-webhooks | v0.1.1 / 01a0e366-e7e8-7000-80cf-f6a7ff7842a0 | 2b97dae945b016010c0cf7f91daaaef5c15b12c7 | ready，1/1 |

### 实机事件回执

以下请求由本机直接进入实际 Traefik 服务域，producer验签后调用 cs-events，消费者以自身业务数据库持久保存信封后返回204。原payload逐字段一致，重复请求返回同一个eventId和deduplicated，消费者每条只有一行。完整脱敏回执见 [local-acceptance.json](./local-acceptance.json)。

| 类型 | eventId | 平台结果 |
|---|---|---|
| gitlab.merge-request.comment | 01a0e378-031e-7000-84d1-124940d1af9e | delivered，attempts=1 |
| gitlab.issue.comment | 01a0e378-03b9-7000-961b-13d26f14c2f7 | delivered，attempts=1 |
| github.pull-request.comment | 01a0e378-040d-7000-b91c-ae743fd838dd | delivered，attempts=1 |

GitHub原始正文追加一个空格使签名失效，返回401；精确POST入口缺签名也返回401；GET同路径、POST子路径与普通API均403。更新前事件目录的每个ID与更新后逐项比较一致，现有GitLab订阅身份未改写。

### 资源与证明边界

新建的 `webhook-local` 服务规格为50m CPU／256Mi，三个服务各1副本。GitLab旧v0.1.4待命槽已于15:13:53 UTC经平台入口下线，保留可重新部署的发布记录；新GitHub／消费者的临时旧槽均已结束，未删除其他会话资源。消费者暂保留50m／256Mi用于回执复核：平台删除预检明确拒绝删除承流正式槽，没有绕过保护或直接改Kubernetes资源。本期没有创建真实上游Webhook配置，也没有真实GitHub公网回调；localhost服务域不可被公网GitHub访问。上线接入需按README配置可达域名、相同Secret和订阅，不能把本机协议注入当作公网联网验收。aw未改动。
