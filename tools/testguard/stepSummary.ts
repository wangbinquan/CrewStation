import type { RemovedTest } from './changedLines';
import type { TestCase } from './junitReport';
import { areaOf, titleOf } from './junitReport';
import type { AreaCoverage } from './lcovReport';
import type { PatchVerdict } from './patchCoverage';
import type { TestTier } from './testTiers';
import { TIER_POLICY } from './testTiers';
import type { TierAudit } from './tierAudit';

const SLOWEST = 10;
const cell = (value: string): string => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const percent = (covered: number, total: number): string => (total === 0 ? '—' : `${((covered / total) * 100).toFixed(1)}%`);

/** 用例执行结果：总数、按区域、失败、被跳过的逐条列出（跳过必须看得见）、最慢的几条。 */
export function renderTestReport(title: string, cases: readonly TestCase[]): string {
  const count = (status: TestCase['status'], list: readonly TestCase[] = cases): number => list.filter((testCase) => testCase.status === status).length;
  const lines = [`## 用例执行：${title}`, '', '| 用例 | 通过 | 失败 | 跳过 | 用例文件 |', '|---:|---:|---:|---:|---:|'];
  lines.push(`| ${cases.length} | ${count('passed')} | ${count('failed')} | ${count('skipped')} | ${new Set(cases.map((testCase) => testCase.file)).size} |`);
  const failed = cases.filter((testCase) => testCase.status === 'failed');
  if (failed.length > 0) lines.push('', `### 失败（${failed.length}）`, '', ...failed.map((testCase) => `- \`${testCase.file}\` ${cell(titleOf(testCase))}`));
  lines.push('', '<details><summary>按区域</summary>', '', '| 区域 | 用例 | 失败 | 跳过 |', '|---|---:|---:|---:|');
  for (const area of [...new Set(cases.map((testCase) => areaOf(testCase.file)))].sort()) {
    const inArea = cases.filter((testCase) => areaOf(testCase.file) === area);
    lines.push(`| ${area} | ${inArea.length} | ${count('failed', inArea)} | ${count('skipped', inArea)} |`);
  }
  lines.push('', '</details>', ...renderSkipped(cases), ...renderSlowest(cases));
  return lines.join('\n');
}

function renderSkipped(cases: readonly TestCase[]): string[] {
  const skipped = cases.filter((testCase) => testCase.status === 'skipped');
  if (skipped.length === 0) return ['', '没有被跳过的用例。'];
  const lines = ['', `### 被跳过的用例（${skipped.length}）`, '', '每一条都是这次运行**没有提供的防护**；原因应当是环境能力缺席（docs/engineering/testing.md §5），而不是有人把它关了。', ''];
  for (const file of [...new Set(skipped.map((testCase) => testCase.file))].sort()) {
    const inFile = skipped.filter((testCase) => testCase.file === file);
    lines.push(`<details><summary><code>${file}</code>（${inFile.length}）</summary>`, '', ...inFile.map((testCase) => `- ${cell(titleOf(testCase))}`), '', '</details>');
  }
  return lines;
}

function renderSlowest(cases: readonly TestCase[]): string[] {
  const slowest = [...cases].sort((a, b) => b.seconds - a.seconds).slice(0, SLOWEST);
  return ['', `<details><summary>最慢的 ${slowest.length} 条</summary>`, '', '| 秒 | 用例 |', '|---:|---|', ...slowest.map((testCase) => `| ${testCase.seconds.toFixed(2)} | \`${testCase.file}\` ${cell(titleOf(testCase))} |`), '', '</details>'];
}

/** 按层汇总：方法级 UT、模块级 UT、工作台各跑了多少，一眼看得见；再列出审计发现的问题。 */
export function renderTiers(tiers: readonly TestTier[], tierOfFile: (file: string) => TestTier | undefined, cases: readonly TestCase[], audit: TierAudit): string {
  const lines = ['## 按层汇总', '', '| 层 | 用例文件 | 用例 | 通过 | 失败 | 跳过 |', '|---|---:|---:|---:|---:|---:|'];
  for (const tier of tiers) {
    const inTier = cases.filter((testCase) => tierOfFile(testCase.file) === tier);
    const count = (status: TestCase['status']): number => inTier.filter((testCase) => testCase.status === status).length;
    lines.push(`| ${TIER_POLICY[tier].label}（\`${tier}\`） | ${new Set(inTier.map((testCase) => testCase.file)).size} | ${inTier.length} | ${count('passed')} | ${count('failed')} | ${count('skipped')} |`);
  }
  if (audit.notExecuted.length > 0) {
    lines.push('', `### ✗ 没有被任何作业执行的用例文件（${audit.notExecuted.length}）`, '', '它们属于上面的分层，报告里却一条用例都没有：没被执行，或在加载期就崩了。', '', ...audit.notExecuted.map((file) => `- \`${file}\``));
  }
  if (audit.forbiddenSkips.length > 0) {
    lines.push('', `### ✗ 不允许跳过的分层里出现了跳过（${audit.forbiddenSkips.length}）`, '', '方法级与工作台用例不依赖任何环境；依赖环境的用例放进所属单元的 `tests/`。', '', ...audit.forbiddenSkips.map((testCase) => `- \`${testCase.file}\` ${cell(titleOf(testCase))}`));
  }
  return lines.join('\n');
}

export function renderCoverage(areas: readonly AreaCoverage[]): string {
  const lines = areas.reduce((sum, area) => sum + area.lines, 0);
  const covered = areas.reduce((sum, area) => sum + area.covered, 0);
  return [
    '## 行覆盖率（生产代码）', '', `合计 **${percent(covered, lines)}**（${covered}／${lines} 行）。这里只是汇总，不设存量门槛；阻断的是下面「新增代码防护」。`, '',
    '<details><summary>按区域</summary>', '', '| 区域 | 文件 | 行覆盖率 |', '|---|---:|---:|',
    ...areas.map((area) => `| ${area.area} | ${area.files} | ${percent(area.covered, area.lines)} |`), '', '</details>',
  ].join('\n');
}

export function renderPatch(verdict: PatchVerdict, base: string, minPercent: number): string {
  const lines = ['## 新增代码防护', '', `对比基线 \`${base.slice(0, 12)}\`；下限 ${minPercent}%。`, ''];
  if (verdict.files.length === 0) lines.push('本次改动没有触及需要用例防护的生产源码。');
  else lines.push(`改动的可执行行 ${verdict.executable} 行，被用例执行到 ${verdict.covered} 行${verdict.percent === undefined ? '' : `（**${verdict.percent.toFixed(1)}%**）`}。`);
  if (verdict.violations.length > 0) lines.push('', `### ✗ 未通过（${verdict.violations.length}）`, '', ...verdict.violations.map((violation) => `- ${cell(violation)}`));
  const gaps = verdict.files.filter((file) => file.uncoveredLines.length > 0);
  if (gaps.length > 0) lines.push('', '| 文件 | 未被执行到的改动行 |', '|---|---|', ...gaps.map((file) => `| \`${file.file}\` | ${file.uncoveredLines.join('、')} |`));
  return lines.join('\n');
}

export function renderRemovedTests(removed: readonly RemovedTest[]): string {
  if (removed.length === 0) return '';
  return [
    `## 本次改动删除或改名的用例（${removed.length}）`, '', '不阻断，但每一条都值得看一眼：删掉的是不是一条仍然成立的防护。', '',
    ...removed.map((entry) => `- \`${entry.file}\` ${cell(entry.title)}`),
  ].join('\n');
}
