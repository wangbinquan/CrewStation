# RFC-032 验收记录

最新状态：Done。功能提交 `6c5605c22fa00700ba85b135906d6f3f64343f0b` 已推送；最终版本 `d2852b3274fc7d3e0179cad7b2adaa430ea3e1ae` 六项 CI 全绿且已部署本机。部署后真实页面验收通过；以下早期“未发布／未部署”段落为历史记录。完整回执见 [三项 RFC 部署验收](../RFC-031-console-catalog-ux/deployment-2026-09-27.md)。

2026-09-27，作者批准后的本地实现；尚未提交、推送或部署。

## 行为

应用图标保留并统一为32px外框、留白与contain展示。自动来源是已授权应用入口的 `/favicon.ico`；正式优先、仅 Beta 时使用 Beta origin。负责人／管理员可选择上传 PNG/JPEG/WebP 或填写 HTTP(S)／应用根相对图片 URL；手动源→应用源→平台后备符号，单候选3秒超时，无循环探测。设置同时显示96px预览与32px实际尺寸，加载失败提示保留可修正输入。

上传是一次完整展示资料保存：图片＋描述＋后备符号＋expectedRevision。前端选文件仅本地预览，关窗不丢草稿；后端真实解码≤2MiB、≤4096px静态图片，去元数据并等比例转为≤128px、≤64KiB WebP，来源修订与图像在同一事务内替换。显式改用应用／URL源才删除上传，旧客户端省略来源会保留它。0013迁移已单独入锁，业务接口金样未变化。

读图每次用当前用户和市场可见性授权（允许市场用户，无须开发权限），固定image/webp、nosniff、private/no-store；撤权后返回404。无远程服务端抓图代理，不调整业务入口权限。

## 验证

- 契约3/0、23断言：旧数据／请求兼容、严格来源联合、URL协议／根路径／凭据限制。
- 解码2/0、15断言：真实PNG、JPEG、WebP规范化；空、坏图片、SVG、GIF、过大字节／像素拒绝。
- 真实PostgreSQL与HTTP（含原市场回归）10/0、95断言：原子保存、CAS冲突、旧客户端保留、切源清理、负责人／普通开发成员权限、市场用户读取和撤销、multipart与HTTP状态／响应头。`/tmp/cs-icons-pg.log`。
- 图标候选超时、有限回退、迟到错误事件和换来源重置专项4/0、29断言：`/tmp/cs-icon-timeout.log`。
- 客户端multipart和console来源回退／图片选择包含在19文件140/0中。最后预览和读取失败提示专项26/0，`/tmp/cs-icon-status-tests.log`；已有设置失败、两份草稿、冲突重试和权限变化保护全部保留。
- 真实Chrome市场16组语言×主题×宽度检查，三类图标实际加载；无溢出、首屏8条、75.39px普通行、末行详情Esc／焦点／滚动恢复。`/tmp/cs-icons-market-browser-results.json`。
- 图标设置浏览器：URL草稿、无效协议禁用保存、选文件不写入、关窗保留文件／URL、清空回已保存、1440/390/320弹窗不越界，零业务写入。`/tmp/cs-icon-settings-browser.log`。
- 用真实 `deploy/docker/control-plane.Dockerfile` 构建本地测试镜像成功（sha256:f6e27a9c75c86dd5edee18bd5d2a10bd91958c4c8f367b3d9d081ba0f2a083d9），在该Linux镜像内真实运行解码测试2/0、15断言；测试源及Bun preload只读挂载，容器禁网并自动删除。生产镜像故意排除测试文件，初次未挂载的测试命令未运行，不计通过。
- 最终静态／console生产构建与完整门禁状态见 [RFC-031验收](../RFC-031-console-catalog-ux/acceptance.md)。完整门禁不能由定向通过替代。

AI-01～06 的本地行为由以上证据覆盖。浏览器使用明确HTTP图标夹具，不代表真实业务已公开 `/favicon.ico`；应用自行提供该路径即可被自动读取，没有修改业务仓库／部署或上传真实业务图片。生产部署、线上迁移与精确SHA CI未执行。

截图与矩阵副本：`/Users/wangbinquan/.codex/visualizations/2026/09/27/01a0e2a2-28a2-7773-9445-4996fc329748/implemented/`，包括 `cs-icons-market-zh-CN-light-1440.png`、`cs-icon-settings-390.png`。


## 本次发布候选（2026-09-27）

作者明确要求“提交上库并部署本机”。共享运行镜像118路径先行提交，本任务继续其余97路径；保留共享文件完整输出，排除第三方 `tests/e2e/referenceResources.test.ts`。新增代码防护按本任务精确文件核对：15文件134 pass／0 fail、966断言；双语测试另行收集覆盖，改动可执行行601/606（99.1749%），没有未加载的生产文件，日志 `/tmp/cs-catalog-publication-coverage.log` 和 `/tmp/cs-catalog-patch-check.json`。不重复完整门禁，沿用上述完整终态及模板回归修复证据。提交、精确SHA CI和部署实际结果待后续回执，不以候选通过代替发布完成。
