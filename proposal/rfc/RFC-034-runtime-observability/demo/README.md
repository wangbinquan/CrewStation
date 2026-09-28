# CrewStation 两级运行观测 Demo

RFC-034 Draft；合成任务、资源采样与虚构人民币（CNY）费率。独立静态设计原型，不注册生产路由、不调用真实 API、不切换真实身份。

## 启动

在 CrewStation 主检出执行（仅使用已安装依赖）：

```sh
bun run proposal/rfc/RFC-034-runtime-observability/demo/build.ts
python3 proposal/rfc/RFC-034-runtime-observability/demo/serve.py
```

- [项目层级](http://127.0.0.1:48372/?scope=project&project=code)
- [系统管理层级](http://127.0.0.1:48372/?scope=admin&project=all)
- [人民币 Token 单价配置](http://127.0.0.1:48372/?scope=admin&page=pricing)
- [多 Agent 泳道](http://127.0.0.1:48372/?scope=project&project=code&tab=runs&run=CS-0928-01)

服务仅监听 loopback，白名单暴露 HTML、bundle 与品牌图，不提供源码目录。停止服务器用启动终端 Ctrl+C。`dist/` 可重建且不进版本控制。

## 可交互范围

顶部演示视角切换；项目、环境与 24h/7d 筛选；两级各五个页签；系统项目对比排序与进入项目/返回；任务搜索与状态过滤；任务独立详情、执行泳道/Agent 汇总/逐次执行；缩放与失败强调、容器生命周期；片段/Agent/价格/组件详情复用 Dialog；URL 回放与浏览器返回；算力档位人民币单价配置、新价格版本、生效时间校验和版本历史。

复用 CrewStation 的 Brand、Card、Stack、Button、ActionRow、Tabs、Segmented、Badge、DataTable、TimeSeries、FormField、PageHeader、DefinitionList、EmptyState、Dialog、DialogHost、I18nProvider 与主题变量。示例中文为主，完整双语列入正式验收。

## 对账样本

主任务 CS-0928-01：4 个 Agent、6 次执行；规划 Agent 19K、依赖分析 31K、实现 92K、验证 46K，共 188K。实现 Agent 失败 28K 与重试 64K 都保留，规划第二段为续聊，不算重试。

业务完成 1,120s（18m40s）；Agent 累计 1,570s（26m10s）；父容器存活 1,600s（26m40s）。活动并集 1,040s + 启动 40s + 人工确认 40s = 业务历时 1,120s。该互斥分解只针对这个样本成立。

四桶：非缓存输入 78,960 + 缓存读 75,200 + 缓存写 11,280 + 输出 22,560 = 188,000。

## 演示边界

图的 Token 按任务开始时间归桶，完整生产设计按用量 occurredAt 归桶。服务和平台指标为独立合成样本，平台快照不随项目筛选。普通 CLI 用量未知，纯命令 Token 不适用。系统价格与模型名为虚构示例，直接录入人民币而非实时换汇；项目页面不显示采购模型/单价。

配置路径：系统管理 → 算力档位 → Token 成本；成本页有“配置 Token 单价”。单价单位为元 / 百万 Token，四桶分别配置，空值/负数/超过6位小数和过去生效时间会被拒绝。保存追加待生效版本，历史费用不变。配置只在当前页面会话保存，刷新恢复示例。

未实现真实权限、后端采集、自动刷新、日志查询、导出任务、告警通知、生产虚拟化、完整依赖关键路径或实时模型调用采集。其余侧栏项为位置示意。验收证据见 [plan.md](../plan.md)。
