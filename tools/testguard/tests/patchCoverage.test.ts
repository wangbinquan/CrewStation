import { describe, expect, test } from 'bun:test';
import { parseAddedLines, parseRemovedTests } from '../changedLines';
import { parseLcov, summarizeCoverage } from '../lcovReport';
import { evaluatePatch } from '../patchCoverage';

const LCOV = [
  'TN:', 'SF:modules/orders/application/placeOrder.ts', 'FNF:2', 'FNH:1',
  'DA:1,5', 'DA:2,5', 'DA:10,0', 'DA:11,0', 'DA:12,3', 'LF:5', 'LH:3', 'end_of_record',
  'TN:', 'SF:modules/orders/tests/placeOrder.test.ts', 'DA:1,1', 'LF:1', 'LH:1', 'end_of_record',
].join('\n');

const DIFF = [
  'diff --git a/modules/orders/application/placeOrder.ts b/modules/orders/application/placeOrder.ts',
  '--- a/modules/orders/application/placeOrder.ts',
  '+++ b/modules/orders/application/placeOrder.ts',
  '@@ -9,0 +10,3 @@ export function placeOrder() {',
  '+  if (order.total < 0) {',
  '+    throw invalid();',
  '+  }',
  '@@ -40 +44 @@',
  '-  return old;',
  '+  return next;',
  'diff --git a/modules/orders/domain/refund.ts b/modules/orders/domain/refund.ts',
  '--- /dev/null',
  '+++ b/modules/orders/domain/refund.ts',
  '@@ -0,0 +1,2 @@',
  '+export const refund = () => 1;',
  '+export const partial = () => 2;',
  'diff --git a/modules/orders/domain/gone.ts b/modules/orders/domain/gone.ts',
  '--- a/modules/orders/domain/gone.ts',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-export const gone = 1;',
  '-export const alsoGone = 2;',
].join('\n');

describe('git diff --unified=0 的解析', () => {
  test('取每个文件在新版本里新增或改写的行号；单行 hunk 没有长度；被删除的文件不计', () => {
    expect(parseAddedLines(DIFF)).toEqual([
      { file: 'modules/orders/application/placeOrder.ts', addedLines: [10, 11, 12, 44] },
      { file: 'modules/orders/domain/refund.ts', addedLines: [1, 2] },
    ]);
  });
});

describe('新增代码防护的判定', () => {
  const evaluate = (minPercent: number, hasLogic = true) => evaluatePatch({
    changes: parseAddedLines(DIFF), coverage: parseLcov(LCOV), inScope: () => true, hasLogic: () => hasLogic, minPercent,
  });

  test('只数改动行里可执行的那些：不在覆盖率里的行（空行、类型、括号）既不算分子也不算分母', () => {
    const verdict = evaluate(0, false);
    expect(verdict.files[0]).toEqual({ file: 'modules/orders/application/placeOrder.ts', executable: 3, covered: 1, uncoveredLines: [10, 11], unprotected: false });
    expect(verdict.percent).toBeCloseTo(33.33, 1);
  });

  test('比例低于下限：给出比例、分子分母与下限', () => {
    expect(evaluate(80, false).violations).toEqual(['本次改动的可执行行只有 33.3% 被用例执行到（1／3），下限 80%']);
    expect(evaluate(30, false).violations).toEqual([]);
  });

  // 新文件从没被任何用例 import 过时根本不出现在 lcov 里，拿不到「可执行行」；
  // 如果按 0／0 处理，一整个没有用例的新文件会以「100%」通过。
  test('有逻辑的新文件没有被任何用例加载：单独判违规，不会因为分母为零而漏掉', () => {
    const verdict = evaluate(0, true);
    expect(verdict.files[1]).toMatchObject({ file: 'modules/orders/domain/refund.ts', unprotected: true });
    expect(verdict.violations).toEqual(['modules/orders/domain/refund.ts：有可执行逻辑，但没有任何用例加载它']);
  });

  test('纯类型文件不在覆盖率里是正常的，不算没有防护', () => {
    expect(evaluate(0, false).violations).toEqual([]);
  });

  test('范围之外的文件与没有可执行改动的推送都不判定', () => {
    const verdict = evaluatePatch({ changes: parseAddedLines(DIFF), coverage: parseLcov(LCOV), inScope: () => false, hasLogic: () => true, minPercent: 80 });
    expect(verdict).toEqual({ files: [], executable: 0, covered: 0, percent: undefined, violations: [] });
  });
});

describe('覆盖率汇总', () => {
  test('按区域合计，只统计认可的生产代码', () => {
    const areas = summarizeCoverage(parseLcov(LCOV), (file) => file.split('/').slice(0, 2).join('/'), (file) => !file.includes('/tests/'));
    expect(areas).toEqual([{ area: 'modules/orders', files: 1, lines: 5, covered: 3 }]);
  });
});

describe('被删除或改名的用例', () => {
  const header = (from: string, to: string): string[] => [`--- ${from}`, `+++ ${to}`, '@@ -1,3 +1,2 @@'];
  test('标题在删除行里出现、没有在同文件的新增行里再出现', () => {
    const diff = [
      ...header('a/modules/orders/tests/order.test.ts', 'b/modules/orders/tests/order.test.ts'),
      "-  test('负数金额被拒绝', () => {", "-  test('只是挪了位置', () => {", "+  test('只是挪了位置', () => {",
      "-describe.skipIf(!available)('订单模块', () => {", "+describe.skipIf(!available)('订单模块（真实数据库）', () => {",
    ].join('\n');
    expect(parseRemovedTests(diff)).toEqual([
      { file: 'modules/orders/tests/order.test.ts', title: '负数金额被拒绝' },
      { file: 'modules/orders/tests/order.test.ts', title: '订单模块' },
    ]);
  });
  test('整个用例文件被删除', () => {
    const diff = [...header('a/modules/orders/tests/old.test.ts', '/dev/null'), "-test('旧防护', () => {});"].join('\n');
    expect(parseRemovedTests(diff)).toEqual([{ file: 'modules/orders/tests/old.test.ts', title: '旧防护' }]);
  });
});
