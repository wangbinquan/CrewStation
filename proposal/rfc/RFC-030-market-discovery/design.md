# RFC-030 技术设计

状态：Done · 2026-09-27 · 已发布并部署本机；最终版本 d2852b32，精确 SHA 六项 CI 全绿，见 acceptance。

## 落位与依赖

遵守 `docs/engineering/repository-structure.md` §4、§7、§8，无新增模块、层级或 ADR 例外。

| 归属 | 变化 |
| --- | --- |
| `apps/console/src/features/capabilities` | MarketPage 编排、MarketAppRow 与 MarketAppDetails 展示、检索状态 model、中英文文案 |
| `apps/console/src/shared/ui` | 复用 DataTable、Button、ExternalButtonLink、Badge、FormField、QueryStatus、EmptyState、PageHeader、dialog/Dialog；仅在确有通用缺口时最小兼容扩展 |
| `packages/contracts/api/market/appListing.ts` | MarketAppsQuery 新增可选 ownerId；响应负责人字段复用，不新增数据存储 |
| `packages/api-client/resources/capabilities.ts` | 沿既有查询传输，不另建客户端过滤目录 |
| `modules/project` L1 | application 校验查询／游标，ports 声明过滤，persistence 在可见性约束下完成搜索及 ownerId 条件 |
| `modules/capabilities` L6 | 沿用聚合及权限复核，转发完整查询条件 |
| `apps/console/src/tests`、各模块 `tests` | 页面旅程、真实数据库分页与权限回归 |

当前另有会话在改算力／运行镜像与 `shared/ui/CapabilityCatalog.module.css`，本 RFC 不将其在制内容作为市场实现依赖，也不覆盖那些改动。CSS module 只承担市场专属列宽、重排、简介截断，公共控件外观复用现有组件。

## 查询契约

`GET /v1/market/apps?q=知识 检索&ownerId=<UUID>&limit=20&cursor=...`

- `q` 仍 trim、最多 120 字，空串为全部。按 Unicode 空白拆词、去掉空词，每个词在项目名或简介内出现；多词 AND。SQL 参数化，`%`／`_` 为普通字符，不当通配符。
- `ownerId` 使用 UserIdSchema，可选，按项目真实 ownerUserId 精确匹配；与现有授权谓词 AND。伪造别人的 ID 不会扩大范围，也不另返回个人资料。
- `limit` 保持 1–50 契约；UI 仅给 20／50。
- 游标绑定 actor.userId、规范化 q、ownerId、limit 与 after 项目 ID；条件变化拒绝旧游标，并引导回第一页。保留稳定项目 ID 排序，不将当前页排序伪装成全局相关性排序。
- 兼容此前无 ownerId 的调用；旧游标如果未包含新增绑定字段，明确作废并提示重新查询，不静默复用错误作用域。
- 不加 total：能力层在项目分页后还会按部署与成员资格过滤，当前页长度不能当总数。空 items 且 nextCursor 存在时明确提示可继续翻页。
- 缺负责人显示名时显示“负责人信息不可用”，不把 UUID 渲染成人名；后端当前存在 name 回退 userId，实现时改为可识别的空显示名，并为此补回归，userId 仍保留身份作用。身份服务失败仍进入既有失败路径，不能伪装成无负责人。

多关键词是搜索语义增强，需明确测试旧单关键词不变、词序改变仍命中、跨名称与用途匹配。

## 页面状态

用既有路由 search 参数校验机制保存 q、ownerId、limit 与当前 cursor；负责人 label 仅作显示、不得作为查询身份。查询键包含全部条件与当前用户。

翻页历史栈保留在当前标签页会话中，以规范化条件为键；直接打开带 cursor 的分享链接时没有前页栈，则给“回到第一页”，不伪造前页 cursor。URL 导航时还原输入，不让尚未提交的草稿和已执行条件混淆。

提交搜索／改负责人／改 page size：清空翻页栈、回第一页；打开详情与关闭详情：不导航、不改 query。浏览器前后退恢复对应结果，滚动保存仅属于当前用户会话；身份变化清掉旧目录结果与详情，前页历史按用户隔离；URL 中的查询条件仍经校验后用于当前用户的授权目录。

保留 `useMarketQuery` 15 秒轮询、聚焦重读、用户隔离和错误撤下数据的现有行为。请求在途不因 isFetching 卸载行／禁用入口。详情打开时从当前授权列表解析所选 ID；查询失败、撤权或该项移出当前结果时关闭并移除过期详情，不能让弹窗继续保留授权内容。

## 展示与动作

- 桌面四列：能力弹性列／负责人约 10rem／状态约 8rem／动作按内容。普通行目标 64–80px，正文 14px 级别，不靠小字号挤密度。
- 能力列名称 h2 与小图标，简介最多两行；空简介显示简短“暂无用途说明”，不保留固定高度。
- 负责人按钮具名“查看某某负责的应用”，无可靠名称时不显示原始 ID。当前筛选有可靠名字时显示名字，没有时显示“已选择负责人”并允许清除。
- 所有外链继续经 marketHref，名称使用引用链接，动作使用 ExternalButtonLink；不增加整行绝对定位覆盖层。
- `entry.status === ready` 且有效 host 且正式维护未 blocked 才显示主入口；Beta 和次级试用入口仍沿既有规则及权限。Beta 数据影响说明紧邻对应入口。
- 维护原因与预计恢复时间为必要决策信息，行高允许增长。运行版本、commit SHA、底层项目状态、轮询时间、容量等不进入默认行。
- Dialog 展示完整描述及同一份负责人、状态、入口；复用共享焦点、Esc、层级、滚动机制。不得用行内详情、原生 alert/confirm 或页尾 append。
- 窄屏按现有响应式列表方式重排，状态仍有文字，所有信息不只靠颜色。实际浏览器核对表格可访问结构与读屏标签。

## 测试与失败路径

1. 先加负责人不可见的红用例，再实现行展示。
2. project 模块真实 PG：多关键词跨列、中文／英文、空白、字面 %/_、超过120字、跨原分页命中、ownerId 过滤、同名负责人按 ID 区分、授权不泄漏、改条件旧游标拒绝、顺序稳定。
3. capabilities：请求过滤完整转发，撤权复核、空分页 continuation、正式／未部署 Beta／未知与维护状态保持。
4. console：加载／空／错／成功，具名负责人及缺名，搜索／筛选组合、分享 URL、前后退、每页数量、长描述详情及焦点恢复；更新原卡片结构测试但保留原行为断言。
5. 轮询扣住回执验证 DOM 不替换、动作可用；错误／身份变更撤下旧行与已打开详情。
6. 浏览器使用至少30条明确标注为夹具的数据测首屏容量，桌面与320/390窄屏、中英文、明暗、键盘、末行开关详情。只有实际部署检查可记为部署证据。
7. 定向测试、lint/typecheck、console build；准备 publication 时按仓库要求完整门禁，不为相同候选反复开全量。共享 WIP 报错归属单列。

工作台契约不属于已部署业务契约金样范围；本次没有迁移，只有确认触及金样覆盖面时才更新相应 lock，禁止无关重刷。
