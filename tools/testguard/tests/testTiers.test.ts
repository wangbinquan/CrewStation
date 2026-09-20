import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { TestCase } from '../junitReport';
import { mergeCoverage, parseLcov } from '../lcovReport';
import { renderTiers } from '../stepSummary';
import { TEST_TIERS, discoverTestFiles, isTestTier, testFilesByTier, tierOf, tierTestArgs } from '../testTiers';
import { auditPassed, auditTiers } from '../tierAudit';

const PURE = "import { test } from 'bun:test';\ntest('x', () => {});\n";
const GATED = "import { describe, test } from 'bun:test';\nconst available = false;\ndescribe.skipIf(!available)('真实数据库', () => { test('x', () => {}); });\n";

describe('用例分层：位置决定，就近却依赖环境的归模块级', () => {
  test('四层的判定', () => {
    expect(tierOf('modules/release/domain/slot.test.ts', PURE)).toBe('unit');
    expect(tierOf('integrations/reference-api-proxy/src/proxy/catalog.test.ts', PURE)).toBe('unit');
    expect(tierOf('modules/release/tests/releaseModule.test.ts', GATED)).toBe('module');
    expect(tierOf('packages/mcp-server/tests/protocol.test.ts', PURE)).toBe('module');
    expect(tierOf('apps/cli/src/tests/projectCommands.test.ts', PURE)).toBe('module');
    expect(tierOf('apps/console/src/tests/appMarket.test.tsx', PURE)).toBe('console');
    expect(tierOf('tests/e2e/platformCapabilities.test.ts', GATED)).toBe('e2e');
  });

  // 方法级那一层在 CI 上不起任何服务、一条跳过都不允许。就近放的用例一旦依赖数据库，
  // 留在那一层就只会整组跳过；所以它归模块级，那里有真实 PostgreSQL 且被点名要求。
  test('就近放、却带 skipIf 的文件归模块级；注释里提到 skipIf 不算', () => {
    expect(tierOf('packages/queue/queue.test.ts', GATED)).toBe('module');
    expect(tierOf('packages/testkit/capability.test.ts', `// 约 60 个 describe.skipIf(!available) 整组跳过\n/* test.skipIf(x) */\n${PURE}`)).toBe('unit');
  });

  test('分层名校验与 bun test 参数：文件逐个点名，./ 开头；带产物目录时多出报告参数', () => {
    expect(TEST_TIERS.every((tier) => isTestTier(tier))).toBe(true);
    expect(isTestTier('integration')).toBe(false);
    expect(tierTestArgs(['a/x.test.ts', 'b/y.test.tsx'], undefined)).toEqual(['test', './a/x.test.ts', './b/y.test.tsx']);
    expect(tierTestArgs(['a/x.test.ts'], 'coverage/unit')).toEqual(['test', '--coverage', '--coverage-reporter=lcov', '--coverage-dir=coverage/unit', '--reporter=junit', '--reporter-outfile=coverage/unit/junit.xml', './a/x.test.ts']);
  });
});

describe('在真实目录上发现与分层', () => {
  const root = mkdtempSync(join(tmpdir(), 'crewstation-tiers-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const put = (rel: string, content: string): void => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), content); };
  put('modules/orders/domain/total.test.ts', PURE);
  put('modules/orders/tests/ordersModule.test.ts', GATED);
  put('packages/queue/queue.test.ts', GATED);
  put('apps/console/src/tests/page.test.tsx', PURE);
  put('tests/e2e/smoke.test.ts', GATED);
  put('modules/orders/node_modules/dep/dep.test.ts', PURE);
  put('coverage/unit/stale.test.ts', PURE);
  put('modules/orders/domain/total.ts', 'export const total = 1;\n');

  test('只认 .test.ts(x)，跳过 node_modules 与 coverage；每个文件恰好落在一层', () => {
    expect(discoverTestFiles(root)).toEqual(['apps/console/src/tests/page.test.tsx', 'modules/orders/domain/total.test.ts', 'modules/orders/tests/ordersModule.test.ts', 'packages/queue/queue.test.ts', 'tests/e2e/smoke.test.ts']);
    const tiers = testFilesByTier(root);
    expect(tiers).toEqual({ unit: ['modules/orders/domain/total.test.ts'], module: ['modules/orders/tests/ordersModule.test.ts', 'packages/queue/queue.test.ts'], console: ['apps/console/src/tests/page.test.tsx'], e2e: ['tests/e2e/smoke.test.ts'] });
    expect(Object.values(tiers).flat().sort()).toEqual(discoverTestFiles(root));
  });
});

describe('真实仓库的分层', () => {
  const tiers = testFilesByTier(resolve(import.meta.dir, '..', '..', '..'));
  test('四层都有用例，方法级与模块级是主体', () => {
    expect(tiers.unit.length).toBeGreaterThan(40);
    expect(tiers.module.length).toBeGreaterThan(100);
    expect(tiers.console.length).toBeGreaterThan(50);
    expect(tiers.e2e.length).toBeGreaterThan(3);
  });
});

const passed = (file: string): TestCase => ({ name: 'x', suite: '', file, seconds: 0, status: 'passed' });

describe('分层审计', () => {
  const expected = { unit: ['a/one.test.ts', 'a/two.test.ts'], module: ['m/tests/mod.test.ts'], console: [], e2e: ['tests/e2e/smoke.test.ts'] };

  // 拆成按层的作业之后最怕的事：某个文件不属于任何作业、或在加载期崩掉，而每个作业都是绿的。
  test('属于本次分层却没有任何用例出现在报告里的文件', () => {
    const audit = auditTiers(expected, ['unit', 'module'], [passed('a/one.test.ts'), passed('m/tests/mod.test.ts')]);
    expect(audit.notExecuted).toEqual(['a/two.test.ts']);
    expect(auditPassed(audit)).toBe(false);
  });

  test('不在本次运行的分层不要求出现', () => {
    expect(auditPassed(auditTiers(expected, ['unit'], [passed('a/one.test.ts'), passed('a/two.test.ts')]))).toBe(true);
  });

  test('方法级出现跳过是违规；模块级的跳过允许（环境缺席由能力闸门负责）', () => {
    const cases: TestCase[] = [passed('a/one.test.ts'), { ...passed('a/two.test.ts'), status: 'skipped' }, { ...passed('m/tests/mod.test.ts'), status: 'skipped' }];
    const audit = auditTiers(expected, ['unit', 'module'], cases);
    expect(audit.forbiddenSkips.map((testCase) => testCase.file)).toEqual(['a/two.test.ts']);
    const markdown = renderTiers(['unit', 'module'], (file) => (file.startsWith('a/') ? 'unit' : 'module'), cases, audit);
    expect(markdown).toContain('| 方法级 UT（`unit`） | 2 | 2 | 1 | 0 | 1 |');
    expect(markdown).toContain('| 模块级 UT（`module`） | 1 | 1 | 0 | 0 | 1 |');
    expect(markdown).toContain('不允许跳过的分层里出现了跳过（1）');
    expect(renderTiers(['unit'], () => 'unit', [passed('a/one.test.ts')], auditTiers(expected, ['unit'], [passed('a/one.test.ts')]))).toContain('没有被任何作业执行的用例文件（1）');
  });
});

describe('合并各层的覆盖率', () => {
  test('同一行的命中次数相加；只在某一层出现的文件与行照样保留', () => {
    const unit = parseLcov(['SF:m/a.ts', 'DA:1,2', 'DA:2,0', 'end_of_record'].join('\n'));
    const moduleTier = parseLcov(['SF:m/a.ts', 'DA:2,3', 'DA:9,1', 'end_of_record', 'SF:m/b.ts', 'DA:1,0', 'end_of_record'].join('\n'));
    const merged = mergeCoverage([unit, moduleTier]);
    expect([...merged.get('m/a.ts')!]).toEqual([[1, 2], [2, 3], [9, 1]]);
    expect([...merged.get('m/b.ts')!]).toEqual([[1, 0]]);
  });
});
