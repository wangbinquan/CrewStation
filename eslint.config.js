// 尺寸与导出规则由此执行；依赖方向与目录模板由 tools/arch 执行。
import { existsSync, readdirSync } from 'node:fs';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const moduleRootOnly = { group: ['@crewstation/module-*/*'], message: '模块间只能 import 根入口' };

// 工作台的 feature 目录在配置加载时枚举：新增 feature 自动纳入“feature 之间不互相 import”的检查。
const consoleFeaturesDir = 'apps/console/src/features';
const consoleFeatures = existsSync(consoleFeaturesDir)
  ? readdirSync(consoleFeaturesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  : [];
const consoleFeatureIsolation = consoleFeatures.map((feature) => {
  const others = consoleFeatures.filter((name) => name !== feature).join('|');
  const message = `features 之间不互相 import（${feature} → 其他 feature）；共享代码放 src/shared，路由骨架放 src/app`;
  return {
    files: [`${consoleFeaturesDir}/${feature}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          moduleRootOnly,
          { regex: `^(\\.\\./)+(${others})(/|$)`, message },
          { regex: `(^|/)features/(${others})(/|$)`, message },
        ],
      }],
    },
  };
});

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/generated/**', 'integrations/**', 'templates/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'max-lines': ['error', { max: 600, skipBlankLines: false, skipComments: false }],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true, IIFEs: true }],
      'no-restricted-syntax': ['error', { selector: 'ExportDefaultDeclaration', message: '禁止默认导出（React 组件除外）' }],
      'no-restricted-imports': ['error', { patterns: [moduleRootOnly] }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  { files: ['**/*.test.ts', '**/tests/**/*.ts'], rules: { 'max-lines': ['error', { max: 1000 }], 'max-lines-per-function': 'off' } },
  { files: ['**/*.tsx'], rules: { 'no-restricted-syntax': 'off' } },
  { files: ['**/*.config.ts', '**/*.config.js'], rules: { 'no-restricted-syntax': 'off' } },
  // 工作台：React Hooks 规则（含 React Compiler 检查）；组件是函数，同样受 80 行上限约束。
  { files: ['apps/console/**/*.{ts,tsx}'], plugins: { 'react-hooks': reactHooks }, rules: { ...reactHooks.configs.recommended.rules } },
  ...consoleFeatureIsolation,
  // 工作台 shared/ 是叶子：不 import features 与 app。
  {
    files: ['apps/console/src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [moduleRootOnly, { regex: '^(\\.\\./)+(features|app)(/|$)', message: 'src/shared 不能 import features 或 app' }],
      }],
    },
  },
);
