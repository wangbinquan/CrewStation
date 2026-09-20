import { describe, expect, test } from 'bun:test';
import { areaOf, parseJunit } from '../junitReport';
import { activeExceptions, hasRuntimeLogic, isExcepted, isProtectedSource, scriptEntrypoints } from '../protectionScope';
import { renderCoverage, renderPatch, renderRemovedTests, renderTestReport } from '../stepSummary';

// 形状取自 bun 1.3.13 的真实输出：describe 嵌套成 testsuite，用例自闭合表示通过。
const JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="4" failures="1" skipped="1">
  <testsuite name="modules/orders/tests/order.test.ts" file="modules/orders/tests/order.test.ts" tests="3">
    <testsuite name="订单 &amp; 退款" file="modules/orders/tests/order.test.ts" line="9">
      <testcase name="负数金额被拒绝 &lt;0&gt;" classname="订单 &amp; 退款" time="0.25" file="modules/orders/tests/order.test.ts" line="10" assertions="3" />
      <testcase name="并发下单只有一笔成功" classname="订单 &amp; 退款" time="1.5" file="modules/orders/tests/order.test.ts" line="20" assertions="2">
        <failure type="AssertionError" />
      </testcase>
      <testcase name="真实 GitLab 建仓" classname="订单 &amp; 退款" time="0" file="modules/orders/tests/order.test.ts" line="30" assertions="0">
        <skipped />
      </testcase>
    </testsuite>
  </testsuite>
  <testsuite name="tests/e2e/smoke.test.ts" file="tests/e2e/smoke.test.ts" tests="1">
    <testcase name="首页可达" classname="" time="0.01" file="tests/e2e/smoke.test.ts" line="3" assertions="1" />
  </testsuite>
</testsuites>`;

describe('JUnit 报告解析', () => {
  const cases = parseJunit(JUNIT);
  test('通过、失败、跳过各自识别，XML 实体还原', () => {
    expect(cases.map((testCase) => [testCase.name, testCase.status])).toEqual([
      ['负数金额被拒绝 <0>', 'passed'], ['并发下单只有一笔成功', 'failed'], ['真实 GitLab 建仓', 'skipped'], ['首页可达', 'passed'],
    ]);
    expect(cases[0]).toMatchObject({ suite: '订单 & 退款', file: 'modules/orders/tests/order.test.ts', seconds: 0.25 });
  });
  test('区域：工作区单元取两段，其余取顶层目录', () => {
    expect(areaOf('modules/orders/tests/order.test.ts')).toBe('modules/orders');
    expect(areaOf('tests/e2e/smoke.test.ts')).toBe('tests');
    expect(areaOf('deploy/local/installPlatform.test.ts')).toBe('deploy');
  });
  test('汇总把失败与每一条被跳过的用例逐条列出，表格里的竖线被转义', () => {
    const markdown = renderTestReport('check', cases);
    expect(markdown).toContain('| 4 | 2 | 1 | 1 | 2 |');
    expect(markdown).toContain('### 失败（1）');
    expect(markdown).toContain('### 被跳过的用例（1）');
    expect(markdown).toContain('订单 & 退款 › 真实 GitLab 建仓');
    expect(renderTestReport('e2e', [{ ...cases[0]!, name: 'a|b' }])).toContain('a\\|b');
  });
  test('没有跳过时明说没有，而不是什么都不写', () => {
    expect(renderTestReport('check', [cases[0]!])).toContain('没有被跳过的用例。');
  });
});

describe('哪些文件需要用例防护', () => {
  const entrypoints = scriptEntrypoints(JSON.stringify({ scripts: {
    'arch:check': 'bun run tools/arch/check.ts', check: 'bun run arch:check && bun test', 'contracts:lock': 'bun run packages/contracts/tests/lockSurface.ts', typecheck: 'tsc -p tsconfig.json --noEmit',
  } }));
  test('根 scripts 里点名的脚本文件就是入口，不需要另列清单', () => {
    expect([...entrypoints].sort()).toEqual(['packages/contracts/tests/lockSurface.ts', 'tools/arch/check.ts']);
  });
  test('生产源码在范围内；用例、生成代码、类型声明、进程入口与仓库说明不在', () => {
    const inScope = (file: string): boolean => isProtectedSource(file, entrypoints);
    expect(['modules/release/application/switchTraffic.ts', 'apps/console/src/features/release/pages/ReleasePage.tsx', 'templates/minimal-sample/src/platform/identity.ts', 'tools/arch/rules/cycles.ts'].every(inScope)).toBe(true);
    expect([
      'modules/release/tests/releaseModule.test.ts', 'modules/release/domain/slot.test.ts', 'apps/console/src/tests/renderApp.tsx', 'apps/console/src/generated/client.ts',
      'apps/cs-api/src/main.ts', 'apps/console/src/main.tsx', 'apps/console/serve.ts', 'apps/console/vite.config.ts', 'tools/arch/check.ts',
      'packages/kernel/globals.d.ts', 'docs/engineering/testing.md', 'deploy/local/installPlatform.test.ts', 'eslint.config.js',
    ].filter(inScope)).toEqual([]);
  });
  test('纯类型文件与只做转发的桶文件没有可执行逻辑', () => {
    expect(hasRuntimeLogic('ports/clock.ts', "import type { X } from './x';\nexport interface Clock { now(): Date }\nexport type Y = X | string;\n")).toBe(false);
    expect(hasRuntimeLogic('index.ts', "export type { Api } from './api/moduleApi';\nexport { createOrders, ordersMigrations } from './wiring';\nexport * from './ids';\n")).toBe(false);
    expect(hasRuntimeLogic('domain/total.ts', 'export const total = (items: number[]): number => items.reduce((a, b) => a + b, 0);\n')).toBe(true);
    expect(hasRuntimeLogic('Card.tsx', 'export function Card() { return <div className="card" />; }\n')).toBe(true);
  });
});

describe('本机门禁与 CI 门禁是同一批检查', () => {
  // CI 跑 check:ci、本机跑 check。两条脚本一旦各改各的，「本机绿、CI 红」就会回来；
  // 这里要求它们共用同一段静态检查，用例那一步只允许多出报告参数，不允许多出路径或筛选。
  test('check 与 check:ci 只差报告参数', async () => {
    const scripts = ((await Bun.file(new URL('../../../package.json', import.meta.url)).json()) as { scripts: Record<string, string> }).scripts;
    expect(scripts.check).toBe('bun run check:static && bun test');
    expect(scripts['check:ci']).toBe('bun run check:static && bun run test:cover');
    const cover = scripts['test:cover']!.replace(/^mkdir -p coverage && /, '');
    expect(cover.startsWith('bun test ')).toBe(true);
    expect(cover.split(' ').slice(2).every((argument) => /^--(coverage|coverage-reporter|coverage-dir|reporter|reporter-outfile)(=|$)/.test(argument))).toBe(true);
  });
});

describe('ADR 例外', () => {
  const adr = ['# 0009', '- exception: patch-coverage modules/scm/adapters/gitlab/** until 2026-12-31', '- exception: patch-coverage packages/k8s/watch.ts until 2026-01-01', '- exception: size-limit packages/kernel/big.ts until 2999-01-01'].join('\n');
  test('只认本规则、只认未过期的行；支持精确路径与 glob', () => {
    const exceptions = activeExceptions([adr], '2026-09-20');
    expect(exceptions).toEqual([{ pattern: 'modules/scm/adapters/gitlab/**', until: '2026-12-31' }]);
    expect(isExcepted('modules/scm/adapters/gitlab/projects.ts', exceptions)).toBe(true);
    expect(isExcepted('packages/k8s/watch.ts', exceptions)).toBe(false);
  });
});

describe('闸门与删除用例的说明', () => {
  test('未通过时列出每条违规与未被执行到的改动行', () => {
    const markdown = renderPatch({
      files: [{ file: 'modules/orders/application/placeOrder.ts', executable: 3, covered: 1, uncoveredLines: [10, 11], unprotected: false }],
      executable: 3, covered: 1, percent: 33.3, violations: ['本次改动的可执行行只有 33.3% 被用例执行到（1／3），下限 80%'],
    }, '0123456789abcdef0123', 80);
    expect(markdown).toContain('对比基线 `0123456789ab`');
    expect(markdown).toContain('### ✗ 未通过（1）');
    expect(markdown).toContain('| `modules/orders/application/placeOrder.ts` | 10、11 |');
  });
  test('覆盖率汇总给出合计与各区域，并写明它不是门槛', () => {
    const markdown = renderCoverage([{ area: 'modules/orders', files: 2, lines: 200, covered: 150 }, { area: 'packages/kernel', files: 1, lines: 0, covered: 0 }]);
    expect(markdown).toContain('合计 **75.0%**（150／200 行）');
    expect(markdown).toContain('| modules/orders | 2 | 75.0% |');
    expect(markdown).toContain('| packages/kernel | 1 | — |');
    expect(markdown).toContain('不设存量门槛');
  });
  test('没有触及生产源码的推送如实说明；没有删除用例时不输出这一节', () => {
    expect(renderPatch({ files: [], executable: 0, covered: 0, percent: undefined, violations: [] }, 'abc', 80)).toContain('没有触及需要用例防护的生产源码');
    expect(renderRemovedTests([])).toBe('');
    expect(renderRemovedTests([{ file: 'a.test.ts', title: '旧防护' }])).toContain('- `a.test.ts` 旧防护');
  });
});
