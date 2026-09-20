import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * 用例分层的单一事实源（docs/engineering/testing.md §2）：CI 按这里的分层拆作业，报告按这里的分层汇总。
 * 每个用例文件恰好属于一层，所以各层作业跑的文件合起来就是本机 `bun test` 跑的全部——不会有文件掉在所有作业之外。
 */
export const TEST_TIERS = ['unit', 'module', 'console', 'e2e'] as const;
export type TestTier = (typeof TEST_TIERS)[number];

export interface TierPolicy {
  readonly label: string;
  readonly covers: string;
  /** 这一层不依赖任何外部环境，所以一条跳过都不允许出现。 */
  readonly forbidSkips: boolean;
}

export const TIER_POLICY: Readonly<Record<TestTier, TierPolicy>> = {
  unit: { label: '方法级 UT', covers: '就近放在源码旁、不依赖任何环境的用例：领域规则、判定、解析、纯函数', forbidSkips: true },
  module: { label: '模块级 UT', covers: '各单元 tests/ 下的用例：一个模块或技术包对外的全部行为，含真实 PostgreSQL 与 HTTP 路由', forbidSkips: false },
  console: { label: '工作台', covers: 'apps/console 的渲染、交互与模型用例（happy-dom，网络打桩）', forbidSkips: true },
  e2e: { label: '实机端到端', covers: 'tests/e2e：真网关、真登录、真后端、真浏览器', forbidSkips: false },
};

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', 'build', '.local']);
const TEST_FILE_RE = /\.test\.tsx?$/;

/** 仓库里全部用例文件（相对仓库根，已排序）。只认 `.test.ts(x)`——别的命名由 test-discipline 规则阻断。 */
export function discoverTestFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (TEST_FILE_RE.test(entry)) found.push(relative(root, path));
    }
  };
  walk(root);
  return found.sort();
}

/**
 * 位置决定分层；唯一看内容的地方是「就近放、却带 skipIf」的文件：它依赖环境（数据库、集群），
 * 归到模块级，这样方法级那一层才能做到「不起任何服务、一条都不跳过」。
 */
export function tierOf(file: string, source: string): TestTier {
  if (file.startsWith('tests/e2e/')) return 'e2e';
  if (file.startsWith('apps/console/')) return 'console';
  if (file.split('/').includes('tests')) return 'module';
  return /\bskipIf\s*\(/.test(stripComments(source)) ? 'module' : 'unit';
}

/** 注释里提到 skipIf（解释为什么要有某条用例）不算依赖环境。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

export function testFilesByTier(root: string): Record<TestTier, string[]> {
  const tiers: Record<TestTier, string[]> = { unit: [], module: [], console: [], e2e: [] };
  for (const file of discoverTestFiles(root)) tiers[tierOf(file, readFileSync(join(root, file), 'utf8'))].push(file);
  return tiers;
}

export function isTestTier(value: string | undefined): value is TestTier {
  return (TEST_TIERS as readonly string[]).includes(value ?? '');
}

/** 某一层的 `bun test` 参数：文件逐个点名（`./` 开头才会被当成路径而不是名字筛选）。 */
export function tierTestArgs(files: readonly string[], outDir: string | undefined): string[] {
  const reports = outDir === undefined ? [] : ['--coverage', '--coverage-reporter=lcov', `--coverage-dir=${outDir}`, '--reporter=junit', `--reporter-outfile=${outDir}/junit.xml`];
  return ['test', ...reports, ...files.map((file) => `./${file}`)];
}
