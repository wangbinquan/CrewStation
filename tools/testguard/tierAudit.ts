import type { TestCase } from './junitReport';
import type { TestTier } from './testTiers';
import { TIER_POLICY } from './testTiers';

export interface TierAudit {
  /** 属于这次运行的分层、却没有任何一条用例出现在报告里的文件：没被执行，或在加载期就崩了。 */
  readonly notExecuted: readonly string[];
  /** 出现在「不允许跳过」的分层里的跳过。 */
  readonly forbiddenSkips: readonly TestCase[];
}

/**
 * 把 CI 拆成按层的作业之后，最怕的是某个用例文件不属于任何作业、从此再没跑过，而每个作业都是绿的。
 * 这里拿「分层给出的文件清单」对「报告里真的出现过的文件」，一个都不能少。
 */
export function auditTiers(expected: Readonly<Record<TestTier, readonly string[]>>, tiersRun: readonly TestTier[], cases: readonly TestCase[]): TierAudit {
  const executed = new Set(cases.map((testCase) => testCase.file));
  const tierByFile = new Map(tiersRun.flatMap((tier) => expected[tier].map((file) => [file, tier] as const)));
  return {
    notExecuted: [...tierByFile.keys()].filter((file) => !executed.has(file)).sort(),
    forbiddenSkips: cases.filter((testCase) => testCase.status === 'skipped' && TIER_POLICY[tierByFile.get(testCase.file) ?? 'module'].forbidSkips),
  };
}

export const auditPassed = (audit: TierAudit): boolean => audit.notExecuted.length === 0 && audit.forbiddenSkips.length === 0;
