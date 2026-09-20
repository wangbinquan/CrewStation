# CrewStation

数字人能力平台：业务团队在平台上用编码 Agent 开发、发布并运行“数字人”业务服务。

- **接力状态**：`STATE.md`（新 session 先读这个）
- **开发规则**：`docs/engineering/development-rules.md`（主干开发、提交纪律、门禁、测试要求、RFC 流程）
- 产品与设计提案：`proposal/`（Proposal、Design、Plan、Tech Evaluation、设计门检视）
- RFC：`proposal/rfc/`（基线之后的变更都从这里开始）
- 仓库结构与模块／依赖原则：`docs/engineering/repository-structure.md`（每个新文件都必须遵守）
- **用例防护体系**：`docs/engineering/testing.md`（用例放哪、每类改动必须带哪些用例、CI 怎么执行、已知的防护缺口）
- 架构决策记录：`docs/adr/`
- 踩坑记录：`docs/engineering/dev-gotchas.md`

## 开发命令

```bash
bun install
bun run check          # arch:check + lint + typecheck + test，与 CI 一致
bun run arch:check     # 依赖方向、模块模板、持久化归属、尺寸与命名、用例纪律、迁移锁
bun run migrations:lock  # 新迁移入锁（只追加）
bun run contracts:lock   # 业务契约面金样入锁；破坏性变更要 --breaking "<依据>"
bun run test:cover       # 全部用例并产出 coverage/lcov.info 与 junit.xml（CI 的 check:ci 用的就是它）
bun run test:report      # 把上一次 test:cover 渲染成 CI 摘要同款的报告
bun run scaffold:module <name> <layer> --deps a,b --desc "..."   # 按模板新建模块
```
