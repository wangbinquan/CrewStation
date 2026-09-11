# CrewStation

数字人能力平台：业务团队在平台上用编码 Agent 开发、发布并运行“数字人”业务服务。

- 产品与设计提案：`proposal/`（Proposal、Design、Plan、Tech Evaluation、设计门检视）
- 仓库结构与模块／依赖原则：`docs/engineering/repository-structure.md`（每个新文件都必须遵守）
- 架构决策记录：`docs/adr/`

## 开发命令

```bash
bun install
bun run check          # arch:check + lint + typecheck + test，与 CI 一致
bun run arch:check     # 依赖方向、模块模板、持久化归属、尺寸与命名
bun run scaffold:module <name> <layer> --deps a,b --desc "..."   # 按模板新建模块
```
