# 部署架构资源原型

状态：2026-10-01 形成的可审核原型；2026-10-15 作者已批准按设计实施。对应[设计修订](../deployment-architecture.md)，正式实现与实机证据见[本次验收](../deployment-architecture-acceptance.md)。

从仓库根启动：

```sh
bun proposal/rfc/RFC-036-project-resource-workspace/deployment-prototype/preview.ts
```

访问 `http://127.0.0.1:5226/`。只提供本地静态文件；提交只改变 React 中的演示状态，刷新重置。编译产物位于 `/private/tmp/crewstation-rfc036-deployment-prototype`。不接真实 API，不需要切换真实账号。

## 审阅路径

1. 默认服务部署视角：双槽及聚合副本、共享生产库／对象空间、平台 API 和事件推送。图内只显示已经存在或已声明的部署依赖。
2. 点「正式服务」：资源与权限列表显示平台默认、项目分配、可申请、在途变更。查看运行对象与原有关系。
3. 点对象空间的「申请调额」，提交 20 → 40 GiB：当前额度仍为 20，原有已使用状态和在途申请同时显示。
4. 顶部切换「平台管理员」，直接点击内存额度调整；点击已有 CPU 申请进行批准／驳回。演示批准后等待回执，点击原型按钮「模拟生效回执」才更新当前额度。
5. 切换「开发者 · 只读」：权限列表仅保留详情和进度。开发者不显示申请、直接调整或审批动作。
6. 切换开发工作区、业务任务、构建与迁移：保留容器边界、真实父子和挂载关系。点「运行与诊断基线」对照同一演示数据生成的原始图。

## 本轮检查

- 原型 Bun 构建和 TypeScript 检查通过。
- 浏览器检查服务、开发、业务、交付四视角，默认服务图 8 节点、开发 6、业务 3、交付 4。
- 默认 1280 × 720：服务图 viewBox 高度 328；横向无页面溢出。对象详情 880 × 688，正文内部滚动。
- 负责人调额与能力申请、管理员审批及直接调额、演示生效回执、开发者只读分别走过；批准前后的当前值保持到回执才改变。
- 权限列表筛选保持；嵌套 Esc 只关闭表单并返回原按钮，草稿再次打开仍在。
- 390 × 844、320 × 740：页面宽度与视口一致。390px 对象列表保持 8 个聚合入口；申请弹窗宽 358px，位于视口内。
- 浅色／深色目视检查；浏览器未记录 error／warn。

这些是固定演示场景的原型检查，不是正式接口、身份鉴权、集群调额或部署验收。正式实现仍需设计文档列出的稳定身份桥接、部分失败、空场景、规模验证及原有回归。

## 截图

- [部署主图](./screenshots/overview.png)
- [部署对象权限列表](./screenshots/permissions.png)
- [负责人调额](./screenshots/owner-quota.png)
- [管理员审批](./screenshots/admin-approval.png)
- [管理员直接调整](./screenshots/admin-adjust.png)
- [开发工作区](./screenshots/development.png)
- [深色](./screenshots/dark.png)
- [窄屏](./screenshots/mobile.png)
- [窄屏申请](./screenshots/mobile-quota.png)
