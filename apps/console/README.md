# console

工作台前端（React 19 ＋ Vite ＋ TanStack Router／Query）。目录结构与规则见 `docs/engineering/repository-structure.md` §8–§10。

```text
src/
├─ main.tsx                 # 入口：挂载 Provider 与路由
├─ app/                     # 路由骨架（rootRoute、/projects/$projectId）、Provider、布局、主题、app 级 i18n 与消息目录合并
├─ features/<feature>/      # 每个功能自足：pages/ components/ i18n/{zh-CN,en-US}.ts routes.ts；index.ts 只导出路由
├─ shared/ui                # 无业务含义的基础组件（Button、Card、PageHeader、EmptyState、Badge）
├─ shared/lib               # i18n 合并与 useT、按概念命名的格式化函数
└─ shared/api               # apiFetch（错误体 { error, message, details }）与 React Query 客户端工厂
```

约定：`features/*` 之间不互相 import（ESLint 阻断），只能经 `shared/` 与 `app/`；每个 feature 的消息在 `i18n/zh-CN.ts`、`i18n/en-US.ts` 中各自维护，由 `app/i18n/messageCatalog.ts` 在构建时合并，键以 feature 名为前缀，重复键在启动时报错；默认语言 zh-CN。只依赖工作区包 `@crewstation/contracts` 与 `@crewstation/api-client`（`tools/arch` 白名单）。

```bash
bun run dev          # 开发服务器，/api → localhost:8080（cs-api），/auth → localhost:8081（cs-auth）
bun run build        # 产物在 dist/
bun run typecheck    # 等价于仓库根的 bun run typecheck:console
bun run lint
```
