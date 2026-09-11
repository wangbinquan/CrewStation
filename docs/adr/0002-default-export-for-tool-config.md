# 0002. 工具配置文件允许默认导出

- 状态：已接受
- 日期：2026-09-11

## 背景

`vite.config.ts` 这类由第三方工具加载的配置文件要求默认导出；仓库规则禁止 `export default`。工作台脚手架为通过检查写成了 `export { config as default }`，这是绕开规则而不是遵守规则。

## 决策

把“工具配置文件”定为禁默认导出规则的唯一结构性例外：文件名匹配 `*.config.ts`／`*.config.js`／`*.config.mjs` 时允许默认导出。规则写进 `tools/arch/policy.ts`（`DEFAULT_EXPORT_ALLOWED`）与 `eslint.config.js` 的覆盖块，不再需要逐文件例外行。

## 后果

- 配置文件用最直接的 `export default` 写法。
- 业务与平台代码依旧只用命名导出；任何试图借 `*.config.ts` 命名放业务逻辑的文件，评审时按滥用处理。
