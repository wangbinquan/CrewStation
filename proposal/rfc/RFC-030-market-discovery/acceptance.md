# RFC-030 实施与验收

最新状态：Done。功能提交 `6c5605c22fa00700ba85b135906d6f3f64343f0b` 已推送；最终版本 `d2852b3274fc7d3e0179cad7b2adaa430ea3e1ae` 六项 CI 全绿且已部署本机。部署后真实页面验收通过；以下早期“未发布／未部署”段落为历史记录。完整回执见 [三项 RFC 部署验收](../RFC-031-console-catalog-ux/deployment-2026-09-27.md)。

日期：2026-09-27。作者已批准 RFC 及 Beta 布局稿。生产代码已实现，未提交／推送／部署。

## 实施结果

- 市场由大卡片改为共享 DataTable 四列目录：名称／用途、项目负责人、版本状态、动作。负责人复用原 DTO，支持点击筛选。简介两行，完整内容使用共享 Dialog。
- 名称／用途多关键词 AND、空白规范化与不区分大小写；负责人条件与可见性都在 SQL 分页前生效。游标绑定用户、关键词、负责人及页大小；旧游标明确失效。
- 查询条件和分页进入 URL，20／50 项、上一页／分享页回第一页、具名负责人条件及独立清除。前页历史在标签页按用户与完整条件隔离。
- 正式＋Beta 同一条目、Beta-only 标记与尚未发布提示、Beta 不可用保留正式入口。试用入口保留真实业务数据说明；普通用户不获得额外权限。
- 没有负责人姓名时不把 UUID 当人名。授权结果失败、消失或换用户时关闭详情；数据恢复不自动重开。
- 真实 Chrome 发现 StrictMode 双次布局副作用会把弹窗自身当成 opener：在共享 Dialog 中用 ref 只记录首次触发者。补模拟 Chrome 模态 inert 的红用例后修绿，不另建弹窗。

## 自动化证据

| 检查 | 结果 |
| --- | --- |
| 负责人显示红用例 | 旧页面稳定失败，实际文本没有“应用负责人” |
| StrictMode 焦点红用例 | 模态仍打开时 Chrome 拒绝移焦，旧实现关闭后丢失原触发者；修后通过 |
| 真实 PostgreSQL `modules/project/tests/appVisibility.test.ts` | 7 pass / 0 fail，70 assertions；独立测试库自动清理；无跳过 |
| 最终市场／角色／试用／Dialog／i18n／聚合 HTTP 定向组合 | 72 pass / 0 fail，380 assertions（7 文件） |
| 工作台整层 | 首次 945 pass / 2 fail，6532 assertions，947 tests / 144 files，93.27 秒 |
| 整层失败处理 | 本任务 testerPreview 的旧 `main section` 卡片选择器改为 `main tbody`，原未知状态无 Beta 断言保留，定向通过；另一项 platformSurface 由并行 runtime-image-catalog／project-image-policy 7 条路由引起，单独复验仍失败，未改他人输出 |
| 最终定向 ESLint | 通过，涵盖本任务生产与用例路径以及共享 Dialog |
| 后端及工作台 TypeScript | 通过；中途运行镜像 ImageHistory 的并行类型错误已由其后续变更消除 |
| 最终 arch:check | 通过，58 单元／2827 源文件；中途运行镜像迁移的 6 项检查错误已由其后续变更消除 |
| 最终 console 生产 build | 通过，保留现有大 bundle 提示 |
| Git | fetch 后 main 与 origin/main 为 0/0；未暂存、提交或推送 |

最终候选的共享 Dialog 修复和显示细节变化由定向组合与浏览器覆盖；未为了消除另一任务的接口面失败重复启动工作台整层，更未宣称整仓门禁全绿。

## 真实浏览器

实际工作台组件与路由，通过独立 Chrome 上下文打开本地 Vite 候选。API 以30条演示数据替身响应；不是部署页面／真实业务 API 验收，没有切换共享身份、打开业务应用或改集群资源。

中英文 × 明暗 × 1440／1024／390／320，共16组通过；[逐组量测](./browser-measurements.json)。

- 1440×900 首屏完整8条，普通行约71.39px；1024×900同样8条。
- 所有组合文档横向溢出0px，窄屏重排保留负责人、状态及操作。
- 长列表末行详情在统一模态、完整描述可见；窄屏正文内部滚动；Esc关闭后焦点回末行按钮，列表滚动值完全一致。
- 16组均无浏览器控制台错误。正式／Beta 两入口独立，Beta不可用时正式入口仍可见。
- 旧部署页面无身份请求返回401，本轮未切换登录身份取得同夹具旧版截图；旧版布局对照仅依据原源码，未声称测得密度提升百分比。

本机日志：`/tmp/cs-market-final-targeted.log`、`/tmp/cs-market-console-full.log`、`/tmp/cs-market-surface-final.log`、`/tmp/cs-market-browser.log`；截图保留在本聊天的可视化目录 `market-implemented-desktop.png` 与 `market-implemented-mobile.png`。

## 剩余边界

- MD-01 新版密度已测；同夹具旧版截图未取得。MD-02～MD-07 由数据库／页面用例及上述浏览器证据覆盖，当前详情没有二次确认动作。
- MD-08 的本任务验证完成，整仓接口面门禁仍受并行输出影响。托管精确 SHA CI 和部署验收未执行。
- 提交、推送和共享环境部署待相应授权／可发布候选。本 RFC 暂保留 In Progress，不将本地实现等同已上线。


## 本次发布候选（2026-09-27）

作者明确要求“提交上库并部署本机”。共享运行镜像118路径先行提交，本任务继续其余97路径；保留共享文件完整输出，排除第三方 `tests/e2e/referenceResources.test.ts`。新增代码防护按本任务精确文件核对：15文件134 pass／0 fail、966断言；双语测试另行收集覆盖，改动可执行行601/606（99.1749%），没有未加载的生产文件，日志 `/tmp/cs-catalog-publication-coverage.log` 和 `/tmp/cs-catalog-patch-check.json`。不重复完整门禁，沿用上述完整终态及模板回归修复证据。提交、精确SHA CI和部署实际结果待后续回执，不以候选通过代替发布完成。
