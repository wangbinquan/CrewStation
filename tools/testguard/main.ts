// 用法（都要在跑完全量 `bun run test:cover` 之后执行，读的是 coverage/ 下的产物）：
//   bun run test:report [--title <作业名>] [--base <sha>] [--skip-coverage]   用例执行、跳过、覆盖率与删除用例的汇总；只报告，不阻断
//   bun run test:patch --base <sha> [--worktree]            新增代码防护闸门；未通过 exit 1
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseAddedLines, parseRemovedTests } from './changedLines';
import { areaOf, parseJunit } from './junitReport';
import { parseLcov, summarizeCoverage } from './lcovReport';
import { evaluatePatch } from './patchCoverage';
import { DEFAULT_JUNIT_PATH, DEFAULT_LCOV_PATH, PATCH_LINE_COVERAGE_MIN, PRODUCTION_ROOTS } from './policy';
import { activeExceptions, hasRuntimeLogic, isExcepted, isProtectedSource, scriptEntrypoints } from './protectionScope';
import { renderCoverage, renderPatch, renderRemovedTests, renderTestReport } from './stepSummary';

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

function report(): number {
  const junit = readArtifact(option('junit') ?? DEFAULT_JUNIT_PATH, '用例报告');
  if (junit) publish(renderTestReport(option('title') ?? 'bun test', parseJunit(junit)));
  // 实机验收作业只跑 tests/e2e，那里的覆盖率只有几份辅助文件，列出来只会误导。
  const lcov = rest.includes('--skip-coverage') ? undefined : readArtifact(option('lcov') ?? DEFAULT_LCOV_PATH, '覆盖率');
  if (lcov) publish(renderCoverage(summarizeCoverage(parseLcov(lcov), areaOf, (file) => isProtectedSource(file, entrypoints))));
  const base = resolveBase(option('base'));
  if (base) publish(renderRemovedTests(parseRemovedTests(git(['diff', '--unified=0', '--no-color', '--no-ext-diff', base, 'HEAD', '--', '*.test.ts', '*.test.tsx']).out)));
  return 0;
}

function patch(): number {
  const lcov = readArtifact(option('lcov') ?? DEFAULT_LCOV_PATH, '覆盖率');
  if (!lcov) return 1;
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
    coverage: parseLcov(lcov),
    inScope: (file) => isProtectedSource(file, entrypoints) && !isExcepted(file, exceptions) && existsSync(join(root, file)),
    hasLogic: (file) => hasRuntimeLogic(file, readFileSync(join(root, file), 'utf8')),
    minPercent: PATCH_LINE_COVERAGE_MIN,
  });
  publish(renderPatch(verdict, base, PATCH_LINE_COVERAGE_MIN));
  return verdict.violations.length === 0 ? 0 : 1;
}

if (command === 'report') process.exit(report());
else if (command === 'patch') process.exit(patch());
else { console.error('用法：main.ts report|patch（见文件头注释）'); process.exit(2); }
