// 用法（在仓库根运行）：
//   bun run test:tier <unit|module|console|e2e> [--cover]   跑某一层；--cover 时把 lcov.info 与 junit.xml 写到 coverage/<层>/ 并做该层的审计
//   bun run test:report [--tiers unit,module,console] [--title <名字>] [--base <sha>] [--skip-coverage]
//                                                          汇总报告；带 --tiers 时合并各层产物并审计「每个用例文件都跑过」，审计不过 exit 1
//   bun run test:patch --base <sha> [--tiers …] [--worktree] 新增代码防护闸门；未通过 exit 1
// 不带 --tiers 时读 coverage/ 下的单份产物（`bun run test:cover` 写出的）。
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseAddedLines, parseRemovedTests } from './changedLines';
import type { TestCase } from './junitReport';
import { areaOf, parseJunit } from './junitReport';
import type { Coverage } from './lcovReport';
import { mergeCoverage, parseLcov, summarizeCoverage } from './lcovReport';
import { evaluatePatch } from './patchCoverage';
import { DEFAULT_JUNIT_PATH, DEFAULT_LCOV_PATH, PATCH_LINE_COVERAGE_MIN, PRODUCTION_ROOTS } from './policy';
import { activeExceptions, hasRuntimeLogic, isExcepted, isProtectedSource, scriptEntrypoints } from './protectionScope';
import { renderCoverage, renderPatch, renderRemovedTests, renderTestReport, renderTiers } from './stepSummary';
import type { TestTier } from './testTiers';
import { TIER_POLICY, isTestTier, testFilesByTier, tierTestArgs } from './testTiers';
import { auditPassed, auditTiers } from './tierAudit';

const root = resolve(import.meta.dir, '..', '..');
const [command, ...rest] = process.argv.slice(2);
const option = (name: string): string | undefined => { const at = rest.indexOf(`--${name}`); return at >= 0 ? rest[at + 1] : undefined; };
const entrypoints = scriptEntrypoints(readFileSync(join(root, 'package.json'), 'utf8'));

function git(args: string[]): { ok: boolean; out: string } {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  return { ok: result.exitCode === 0, out: result.stdout.toString() };
}

/** 推送事件给的 before 在新分支与强推时是全零或不可达；退回到上一个提交。都没有就没有可比的东西。 */
function resolveBase(requested: string | undefined): string | undefined {
  for (const candidate of [requested, 'HEAD~1']) {
    if (!candidate || /^0+$/.test(candidate)) continue;
    const found = git(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]);
    if (found.ok) return found.out.trim();
  }
  return undefined;
}

function publish(markdown: string): void {
  if (markdown.length === 0) return;
  console.log(`${markdown}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n\n`);
}

function readArtifact(path: string, what: string): string | undefined {
  if (existsSync(join(root, path))) return readFileSync(join(root, path), 'utf8');
  publish(`> 没有找到${what} \`${path}\`：用例没有跑完，或不是从仓库根运行的。`);
  return undefined;
}

function requestedTiers(): TestTier[] {
  const names = (option('tiers') ?? '').split(',').map((name) => name.trim()).filter((name) => name.length > 0);
  const unknown = names.filter((name) => !isTestTier(name));
  if (unknown.length > 0) { console.error(`未知的用例分层：${unknown.join('、')}`); process.exit(2); }
  return names as TestTier[];
}

/** 带 --tiers 时读各层目录并合并，否则读 coverage/ 下的单份产物。 */
function loadCases(tiers: readonly TestTier[]): TestCase[] {
  const paths = tiers.length > 0 ? tiers.map((tier) => `coverage/${tier}/junit.xml`) : [option('junit') ?? DEFAULT_JUNIT_PATH];
  return paths.flatMap((path) => parseJunit(readArtifact(path, '用例报告') ?? ''));
}

function loadCoverage(tiers: readonly TestTier[]): Coverage | undefined {
  const paths = tiers.length > 0 ? tiers.map((tier) => `coverage/${tier}/lcov.info`) : [option('lcov') ?? DEFAULT_LCOV_PATH];
  const parts = paths.map((path) => readArtifact(path, '覆盖率'));
  return parts.some((part) => part === undefined) ? undefined : mergeCoverage(parts.map((part) => parseLcov(part ?? '')));
}

function runTier(): number {
  const tier = rest[0];
  if (!isTestTier(tier)) { console.error('用法：main.ts tier <unit|module|console|e2e> [--cover]'); return 2; }
  const expected = testFilesByTier(root);
  const outDir = rest.includes('--cover') ? `coverage/${tier}` : undefined;
  if (outDir) mkdirSync(join(root, outDir), { recursive: true });
  console.log(`${TIER_POLICY[tier].label}（${tier}）：${expected[tier].length} 个用例文件`);
  const run = Bun.spawnSync(['bun', ...tierTestArgs(expected[tier], outDir)], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
  if (!outDir) return run.exitCode;
  const audit = auditTiers(expected, [tier], loadCases([tier]));
  for (const file of audit.notExecuted) console.error(`✗ 没有被执行的用例文件：${file}`);
  for (const skipped of audit.forbiddenSkips) console.error(`✗ ${TIER_POLICY[tier].label}不允许跳过：${skipped.file} › ${skipped.name}`);
  return run.exitCode !== 0 ? run.exitCode : auditPassed(audit) ? 0 : 1;
}

function report(): number {
  const tiers = requestedTiers();
  const cases = loadCases(tiers);
  let passed = true;
  if (tiers.length > 0) {
    const expected = testFilesByTier(root);
    const tierByFile = new Map(tiers.flatMap((tier) => expected[tier].map((file) => [file, tier] as const)));
    const audit = auditTiers(expected, tiers, cases);
    publish(renderTiers(tiers, (file) => tierByFile.get(file), cases, audit));
    passed = auditPassed(audit);
  }
  if (cases.length > 0) publish(renderTestReport(option('title') ?? 'bun test', cases));
  // 实机验收作业只跑 tests/e2e，那里的覆盖率只有几份辅助文件，列出来只会误导。
  const coverage = rest.includes('--skip-coverage') ? undefined : loadCoverage(tiers);
  if (coverage) publish(renderCoverage(summarizeCoverage(coverage, areaOf, (file) => isProtectedSource(file, entrypoints))));
  const base = resolveBase(option('base'));
  if (base) publish(renderRemovedTests(parseRemovedTests(git(['diff', '--unified=0', '--no-color', '--no-ext-diff', base, 'HEAD', '--', '*.test.ts', '*.test.tsx']).out)));
  return passed ? 0 : 1;
}

function patch(): number {
  const coverage = loadCoverage(requestedTiers());
  if (!coverage) return 1;
  const base = resolveBase(option('base'));
  if (!base) { publish('## 新增代码防护\n\n没有可对比的基线提交（仓库只有一个提交），本次不判定。'); return 0; }
  const target = rest.includes('--worktree') ? [] : ['HEAD'];
  const diff = git(['diff', '--unified=0', '--no-color', '--no-ext-diff', '--diff-filter=AMR', base, ...target, '--', ...PRODUCTION_ROOTS]);
  if (!diff.ok) { publish('## 新增代码防护\n\n✗ git diff 失败，无法判定。'); return 1; }
  const adrDir = join(root, 'docs', 'adr');
  const adrs = existsSync(adrDir) ? readdirSync(adrDir).filter((name) => name.endsWith('.md')).map((name) => readFileSync(join(adrDir, name), 'utf8')) : [];
  const exceptions = activeExceptions(adrs, new Date().toISOString().slice(0, 10));
  const verdict = evaluatePatch({
    changes: parseAddedLines(diff.out),
    coverage,
    inScope: (file) => isProtectedSource(file, entrypoints) && !isExcepted(file, exceptions) && existsSync(join(root, file)),
    hasLogic: (file) => hasRuntimeLogic(file, readFileSync(join(root, file), 'utf8')),
    minPercent: PATCH_LINE_COVERAGE_MIN,
  });
  publish(renderPatch(verdict, base, PATCH_LINE_COVERAGE_MIN));
  return verdict.violations.length === 0 ? 0 : 1;
}

if (command === 'tier') process.exit(runTier());
else if (command === 'report') process.exit(report());
else if (command === 'patch') process.exit(patch());
else { console.error('用法：main.ts tier|report|patch（见文件头注释）'); process.exit(2); }
