// 尺寸与导出规则由此执行；依赖方向与目录模板由 tools/arch 执行。
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/generated/**', 'apps/console/**', 'integrations/**', 'templates/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'max-lines': ['error', { max: 600, skipBlankLines: false, skipComments: false }],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true, IIFEs: true }],
      'no-restricted-syntax': ['error', { selector: 'ExportDefaultDeclaration', message: '禁止默认导出（React 组件除外）' }],
      'no-restricted-imports': ['error', { patterns: [{ group: ['@crewstation/module-*/*'], message: '模块间只能 import 根入口' }] }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  { files: ['**/*.test.ts', '**/tests/**/*.ts'], rules: { 'max-lines': ['error', { max: 1000 }], 'max-lines-per-function': 'off' } },
  { files: ['**/*.tsx'], rules: { 'no-restricted-syntax': 'off' } },
);
