# RFC-020 验收记录

> 2026-09-23：T3–T10 实施完毕，实机证据如下；作者裁定 D1–D7 见 [plan.md](./plan.md) T2 行。状态与 CI 结论见文末。

## 环境与部署

入口 `http://console.cs.localhost`，context `docker-desktop`，真实 OIDC 身份 `dev-admin`（`CS_E2E_AUTH=dev-oidc`），演示数字人 `01a0c12a-de0c-7009-83f4-d05f95c9a0a2`。
console 镜像 `cs-console:rfc020-20260923b`（节点导入 manifest `sha256:d5feb37a733adadebfc37ab59ca9b3d406308446d7bedc6385e05e69969bc046`），Deployment `console` 1/1 Ready；其余部署未动，无迁移、无契约破坏（`WorkspaceLayout` 只加可选 `tool`）。

量测用同一套 CDP 脚本（无头 Chrome 9333 端口）在 1440／1280／1024／390 四个宽度、明暗两种主题下取数；下表数值是该时点记录，不是将来固定期望。

## 逐项证据

| 编号 | 结论 | 证据 |
|---|---|---|
| WS-01 | 通过 | 左栏五项实测顺序「概览／开发／发布与上线／运行与诊断／项目设置」（四个宽度一致）；`projectNavigation` 用例；e2e `projectWorkspaceIa` WS-01 |
| WS-02 | 通过 | 1440×900 与 1280×900 下 `document.documentElement.scrollHeight = 900`（首版实测 1050，形态卡与最近动态改为并排后一屏）；页头有仓库链接与两槽地址，槽未就绪时不是链接（`projectSummaryPages` 用例） |
| WS-03 | 通过 | 三张卡实测文案：正式版本 v0.1.4、待验证版本 v0.1.2、开发会话「会话运行中 · main · 5 个 CLI」；版本卡与发布页同为 `DeployedVersionCard`（`projectSummaryPages`、`overviewNextStep` 用例） |
| WS-04 | 通过 | 横幅四类各自出现（`overviewNextStep` 用例：首次上线、待验证待切、数据访问待批、失败）；实机只出现对应状态的一类 |
| WS-05 | 通过 | 实机页面文本不含「快捷入口」，无逐卡刷新按钮，`PageRefresh` 一处「读取于」（`projectSummaryPages` 用例） |
| WS-06 | 通过 | 一条工具行：`SplitButton`「＋ 创建开发Agent会话 ▾」、「布局 ▾」（有窗口时）、「⋯」；`devSessionToolbar` 用例（档位与权限随请求发出、重命名、已启动名册）；实机创建了一个 CLI 并出现在名册（会话卡显示 5 个 CLI） |
| WS-07 | 通过 | 实机面板宽度：1440 视口 601px、1280 视口 521px（在旁，终端仍可见）；1024 与 390 视口内容区窄于 800px 自动放大（792／374px，终端区隐藏）；拖宽限制 30%–60%（`devSessionPanel` 用例：方向键 45→48→60→30） |
| WS-08 | 通过 | `view=code&file=` 打开代码面板与文件、`split`＝预览在旁、`diff`＝变更、无参数进入把布局里的面板写回地址（`developmentLocation`、`devSessionPanel`、`workspaceLayout` 用例）；实机 `?view=code` → `data-mode=side`，`&panel=full` → `full` |
| WS-09 | 通过 | 旧布局（只有 `view`）迁移成放大的工具并回填保存（`devSessionPanel` 第二条、`workspaceLayout` 契约用例）；布局冲突沿用 `reapply`／`useRemote`（原用例不变） |
| WS-10 | 通过 | 数据面板同时有资源表与绑定申请（`referencePanel`／`sessionNavigation` 用例）；`resources?section=data` → `dev-session?view=data`（`projectResources` 用例） |
| WS-11 | 通过（部分实机） | 侧栏紧凑只列已授权操作与试调、放大有操作全表、详情栏、申请与折叠 Swagger（`catalogDetail`、`catalogConsumption`、`apiInvocationForm`、`swaggerApiInvocation` 用例；实机放大形态两栏 `790px 380px`）；真实 HTTP 试调仍由 e2e `apiInvocation` 覆盖（本轮通过） |
| WS-12 | 通过 | 会话面板内嵌最近 200 行日志与完整日志链接（`devSessionPanel` 用例文本「最近日志」）；连接异常时 `ConnectionGuide` 仍在页头下（`sessionNavigation` 用例） |
| WS-13 | 通过 | 没有会话：主区开会话表单，面板只有参考可用（`referencePanel` 用例；实机 e2e `projectSettingsUx` 八个地址） |
| WS-14 | 通过 | 实机发布页：时间线 9 条、待验证卡上「回退到 v0.1.2」、页面不再有「切流记录」；`releaseTimeline`／`releaseTimelinePage`／`releaseDelivery` 用例（人名与标签、失败条目日志入口、`switch=1` 进入即核对） |
| WS-15 | 通过 | 实机五个页签「状态／日志／告警与通知／事件投递／调用链回放」，`tab=health`／`topology` 改写为 `tab=status`（e2e `topology`、`projectWorkspaceIa`；`projectNavigation` 用例） |
| WS-16 | 通过 | 左栏无「开发资源」；`resources?section=api\|events\|guide\|data\|project` 五条重定向参数保留（`projectResources` 用例）；实机 `resources?section=events` 落到 `dev-session?view=reference&panel=full&topic=events` 并显示「最近投递」摘要 |
| WS-17 | 通过 | 项目设置五组（环境变量／应用展示／成员与角色／项目信息／高级），项目信息只读、技术详情折叠（`projectResources` 用例；e2e `projectSettingsUx`） |
| WS-18 | 通过（无头 Chrome） | 四个宽度横向溢出 0，控制台错误 0；暗色主题下参考面板放大两栏；面板页签方向键切换、收起后右缘页签栏可打开（e2e `projectWorkspaceIa`）；中英文文案对账（`i18nParity` 用例）。320px 未单独量测 |

**没有做的**：测试者身份只在渲染用例里验证（`releaseDelivery`、`apiInvocationForm` 的 tester 分支），实机只用了 `dev-admin`；Claude Code 登录仍受本机限制，与本 RFC 无关。

## 顺手修掉的缺陷

1. `useDevSession`：没有数据的查询每次重取都被 React Query 置回 pending 并清掉错误，旧页面的开会话表单每 10 秒卸载一次；404 改为数据 `null`，只有第一次读取算「读取中」。
2. `sessionAccess`：身份缺成员列表时整页崩溃。
3. 没有 `taskId` 的会话响应会在连任务流时崩掉整页，现在按无法识别的响应报错。
4. `parseReleaseSearch`：路由把 `switch=1` 解析成数字 1，原判断只认字符串。

## 本机检查与 CI

- `bun run check:static` 绿（arch:check 无违规、eslint、两份 tsc）。
- `CS_E2E_AUTH=dev-oidc CS_E2E_USERNAME=dev-admin bun run test:cover`：**2152 pass／9 skip／0 fail**，13647 assertions，365 个文件，337.8 s；其中 e2e 全套通过（首轮 69 pass 时新增文件 3 条红，修正概览并排与两处断言后该文件 8/8 通过）。
- `bun run test:patch --base origin/main`：本批改动没有触及需要用例防护的生产源码（前四批各自经 CI `gate` 的新增代码防护）。
- 按精确 SHA 的 CI：T5／T6 `b8b64e2` 六项成功（run 35768120059）；T7 `8448a29` 的 `module` 作业红在 `session module > hello 之后紧跟的事件帧不会被当成第二个 hello`（后端会话模块，本 RFC 未触及，`delete session.connections` 查询失败的库竞态），T8 `f1a19bc` 同一后端六项成功（run 35769593471）；验收批 `3b7ec74` 六项全部成功（run 35771402142）。
