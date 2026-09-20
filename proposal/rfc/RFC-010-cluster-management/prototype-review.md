# RFC-010｜交互预览核对

> 日期：2026-09-20；只验证本轮方案预览，不是 CM 生产验收。

本会话附带“集群资源”的可操作预览，使用明确标注的演示数据，没有平台 HTTP 请求与集群写入。
设计源保存在本任务的 visualization 目录，文件名为 `crewstation-cluster.html`；不属于生产 console 构建。

已在 Codex 内置浏览器验证：

- 工作负载、Pod、网络、存储与配置、命名空间、操作记录六个视图可切换。
- 平台系统范围显示 cs-api、PostgreSQL、BuildKit；核心组件删除不可用，原因可见。
- Pod 的“需要关注”筛选定位业务 Agent 子任务，Pending／0 of 1 Ready／Insufficient cpu 保留；日志面板解释尚未调度。
- 副本 9 被明确拒绝，输入 3 后示例列表与详情显示 3／3，并产生 `demo-operation-001`。
- PostgreSQL 的模拟重启产生 `demo-operation-002`；模拟残留 ConfigMap 删除产生 `demo-operation-003`，清单由 3 项变成 2 项。
- 输入框与确认按钮在预览容器中完成实际点击，结果记录明确写明“演示已完成／未请求真实集群”。
- 预览内层 viewport 1024px：document scrollWidth=1024；390px：scrollWidth=390。
- 320px 下逐个切换六个视图，document scrollWidth 均为 320，无整页横向溢出；390px 截图中列表按资源卡片展示。
- 本次浏览器 error／warn 记录为空。

本轮预览核对的是中文浅色；中英文、深色、全键盘和真实 API 的完整核对归 CM-24 与实施验收。
演示数量与本机只读资源盘点是两套数据，不能把预览的示例数字视为集群实际数量。
