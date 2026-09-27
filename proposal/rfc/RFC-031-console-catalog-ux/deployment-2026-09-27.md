# RFC-030／031／032 发布与本机部署验收

2026-09-27。作者授权“提交上库并部署本机”，并授权本次必要跨会话协调；共享发布窗口串行执行。

- 共享目录前置：`4f3ee7f5fbce18486e11507f8da80d1b72638509`。
- 本任务98精确文件：`6c5605c22fa00700ba85b135906d6f3f64343f0b`。
- 最终运行版本：`d2852b3274fc7d3e0179cad7b2adaa430ea3e1ae`，在功能提交上仅修正旧E2E标题断言。
- [最终精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/36323815806)：static、unit、module、console、gate、e2e 六作业均 success。首轮6c5605c2五作业成功、E2E63 pass／45 skip／1 fail，唯一失败为“运行镜像目录”旧标题；不将首轮失败写成成功。

本机由同一发布窗口构建部署最终SHA。控制面镜像 `cs-control-plane:platform-images-d2852b32`、前端镜像 `cs-console:platform-images-d2852b32`；cs-api、cs-auth、cs-controller、cs-session、cs-events、mcp-capabilities、mcp-operations、console 共8个 Deployment 均 Ready/Available=1。迁移Job `platform-images-d2852b32-migrate` succeeded=1，包含0013图标迁移。部署会话另核对三项新迁移、原镜像与引用摘要，以及27个任务Pod/PVC UID保留；本任务独立只读复核实际8个部署镜像、就绪状态和迁移Job。

真实浏览器经已有dev-admin OIDC登录独立上下文，直接访问本机部署和真实后端，没有HTTP夹具。能力市场、项目开发、项目目录、能力接入、算力、服务模板、任务模板、运行镜像8类页面，中英两种语言×1440/390/320三种宽度，共48组末行弹窗／焦点／滚动／横向溢出检查通过；另8组Enter搜索、无匹配结果和浏览器返回恢复通过，共56项。无文档横向溢出，弹窗均在视口内。

真实数据下市场16项、项目16项，中文桌面各显示7个完整条目；市场普通行75.39px、项目多状态行94.58px。项目目录首屏9条、普通行63.58px；其余目录实际条目较少，复杂说明／状态允许自适应高度。此前30项夹具的首屏密度证据仍单列，不用实际不足一页的条数推断上限。

图标设置验证URL草稿、无效协议禁用保存、图片文件草稿关闭保留、清空恢复、1440/390/320弹窗布局，均通过。没有上传或保存真实业务图标；上传原子性、权限与图片解码由真实PG/HTTP和Linux镜像测试覆盖。业务自行提供已授权应用入口的 `/favicon.ico` 即可被读取，未替业务修改应用源码。

网络事件显式启用后的专项轨迹：目录操作46个读取请求、0个业务写请求；图标设置7个读取请求、0个写请求。首轮56项几何脚本未启用Network，所打印requests=0不构成零写入证据，已用独立16项目录请求轨迹补证。另一处脚本曾用URL中不存在q判定返回，源码允许合法的q空字符串；按查询值修正后复验通过，未修改产品来迎合脚本。

截图、56项结果、请求轨迹、部署回执、CI终态保存在本机：
`/Users/wangbinquan/.codex/visualizations/2026/09/27/01a0e2a2-28a2-7773-9445-4996fc329748/deployed/`。

所有验收浏览器上下文已关闭。未执行第二轮完整本地门禁；采用原全门禁终态、针对性修复/覆盖和最终权威CI。第三方 `tests/e2e/referenceResources.test.ts` 与运行镜像会话尚未提交的RFC028验收文件保持原样，不纳入本任务收口。
