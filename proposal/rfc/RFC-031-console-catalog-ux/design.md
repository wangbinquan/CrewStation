# RFC-031 Design

## 落位与依赖

遵守 `docs/engineering/repository-structure.md` §8–9。仅前端表现与查询状态；不改领域状态、后端权限或数据库。项目行、负责人筛选与路由状态放 `features/projects/components/summary/`、`model/`；管理目录放 `features/admin/components/projects/`；算力放 `components/compute/`；套餐放 `components/plans/`；镜像放 `features/runtime-images/`。不得跨 feature import。

复用 DataTable、Card、Stack、ActionRow、Button/ButtonLink、Badge、QueryStatus、Dialog/FormDialog/ConfirmDialog。共享目录的表头／行间距／响应式样式归 `shared/ui`；在既有 CapabilityCatalog 样式上做兼容演进，避免再造第二套。需要公共工具栏／分页组件时放 `shared/ui/catalog/`，不平铺超过目录文件数限制。列布局由调用者提供；不能靠 nth-child 把所有领域绑在固定四列上。

跨页游标历史若抽公用逻辑，放 `shared/lib/`，键包含用户、目录、规范化筛选与接口页大小。无历史时禁用上一页并提供第一页。服务端 cursor/before 原样传递，绝不从 UUID 推造上一页。所有数据仍经 api-client；返回语义未变无需迁移或业务契约锁。

## 视图与交互

- 以 DataTable 语义保留桌面表格；窄屏按明确字段标签重排，辅助技术仍有列关联，不能只用 CSS 伪元素提供唯一字段名。
- 描述最多两行，详情可读完整内容；负责人缺名显示“负责人信息不可用”，保留可查 ID，不用 UUID 冒充姓名。平台资源无 owner 字段，不造负责人。
- 项目列表的正式与 Beta 可同一列上下排列，但版本、可打开动作、健康分别绑定原槽数据，tester 的 preview 专用投影不变。开发状态与连接状态相关但不互相替代。
- 默认算力的“默认”标识仅有一个语义；启用不等于测试通过；旧成功与本次失败分开。更多管理 Dialog 内保留复制、设默认、启停、可见性、删除原约束与反馈。
- 镜像最新版本不是“当前所有任务正在使用的版本”。最新构建失败不自动将旧可用版本标为不可用；验证要带用途，受限时不伪装未验证。项目目录只呈现有权读取的信息。
- 套餐合并名称／说明，不改规格含义与单位；CPU/内存/存储／副本保持独立对齐便于比较。复制 ID 可在详情／编辑完成。
- 页面读取失败时复用既有身份和错误守卫；保留旧数据必须标为上次读取并禁用动作，401/403/404 清除敏感投影。行级镜像失败局限该数据项。
- URL 保存已应用查询，草稿输入本地管理；Enter 提交避免逐字符请求。无后端支持的筛选不出现；全量算力／套餐的本地搜索通过全量读取成功才启用。
- 弹窗不卸载草稿，业务表单沿用现有 hooks；路由切换通过现有 UnsavedChangesGuard。Dialog 的 focus return 和主内容滚动框架不得重造。

## 并行工作与迁移

2026-09-27 快照：RFC-028 正在改镜像平台目录、项目授权以及算力共享样式；RFC-030 的能力市场实现也未提交。本 RFC 的批准不授权覆盖这些工作。实施前重新检查 diff，保留功能增量，采用小范围 patch；实际重叠冲突才协调，不从 HEAD 重建共享文件。RFC-030 页面可消费兼容的公共样式，但不扩大其业务范围。

本次偿还：重复目录视觉、平铺无效技术信息、算力行内管理、不同页面的响应式和上下文丢失。保留债：镜像 N+1 读取、无总量的游标 API、完整人员搜索端点。无结构例外、无新增后端 facade。

## 验证

组件用例放 `apps/console/src/tests/`，补各目录主要交互与真实失败条件，避免只测试 class 名。浏览器用例放 `tests/e2e/`，使用隔离上下文夹具读数据、记录 API 调用、弹窗位置和 scroll/focus。真实环境只读检查可执行；不以验收名义切换身份、创建资源或结束容器。

CU-01…08 对照 proposal。一个完整候选只跑一次全门禁；候选未变不追逐无关 HEAD。静态 mockup 只验证方案表达，不记为产品验收。
