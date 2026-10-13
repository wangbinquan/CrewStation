// CI 38405974297: the complete module layer exceeded its 30-minute job budget.
// Splitting it must preserve every file, original failures and all line-hit evidence.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTierShardResults, tierPopulationDigest, writeTierShardReceipt } from '../tierArtifacts';
import { parseJunit } from '../junitReport';
import { tierTestArgs } from '../testTiers';
import type { TierShardArtifact } from '../tierShards';
import { filesInTierShard, makeTierShardReceipt, mergeTierShardArtifacts, parseTierShard } from '../tierShards';

const files = ['a/one.test.ts', 'b/two.test.ts', 'c/three.test.ts', 'd/four.test.ts'];
const input = { tier: 'module' as const, files, commit: 'current-commit', population: 'complete-source-population' };
const junit = (assigned: readonly string[], status = ''): string => `<testsuites><testsuite>${assigned.map((file) => `<testcase name="original" file="${file}" time="1">${status}</testcase>`).join('')}</testsuite></testsuites>`;
const lcov = (count: number): string => `SF:modules/shared.ts\nDA:1,${count}\nDA:2,0\nend_of_record\n`;
function artifact(index: number, total = 2, status = '', exitCode = 0): TierShardArtifact {
  const shard = { index, total }; const assigned = filesInTierShard(files, shard);
  const report = junit(assigned, status); const coverage = lcov(index);
  return { receipt: JSON.stringify(makeTierShardReceipt({ ...input, shard, files: assigned, junit: report, lcov: coverage, exitCode })), junit: report, lcov: coverage };
}
function amend(art: TierShardArtifact, change: Record<string, unknown>): TierShardArtifact {
  return { ...art, receipt: JSON.stringify({ ...JSON.parse(art.receipt), ...change }) };
}
const merge = (artifacts: readonly TierShardArtifact[]) => mergeTierShardArtifacts({ ...input, artifacts });

describe('complete shard assignment', () => {
  test('the full population is a disjoint union, including populations larger than former batch sizes', () => {
    const population = Array.from({ length: 1007 }, (_, index) => `tests/original-${index}.test.ts`);
    const parts = [1, 2, 3, 4].map((index) => filesInTierShard(population, { index, total: 4 }));
    expect(parts.flat().sort()).toEqual(population.sort());
    expect(new Set(parts.flat()).size).toBe(1007);
    expect(parts.every((part) => part.length > 200)).toBe(true);
    expect(filesInTierShard([...files].reverse(), { index: 1, total: 2 })).toEqual(['a/one.test.ts', 'c/three.test.ts']);
    expect(filesInTierShard(files, { index: 5, total: 5 })).toEqual([]);
  });
  test('reject invalid indices and repeated original files; preserve the unsharded default', () => {
    expect(parseTierShard(undefined)).toBeUndefined();
    expect(parseTierShard('2/4')).toEqual({ index: 2, total: 4 });
    for (const value of ['0/4', '5/4', '1/0', '-1/4', '1.5/4', '1/', '1/9007199254740993']) expect(() => parseTierShard(value)).toThrow();
    expect(() => filesInTierShard([files[0]!, files[0]!], { index: 1, total: 2 })).toThrow('重复');
  });
});

describe('complete artifacts and unchanged coverage merge', () => {
  test('merge every original case and accumulate line hits even when artifacts arrive out of order', () => {
    const result = merge([artifact(2), artifact(1)]);
    expect(result.cases.map((entry) => entry.file).sort()).toEqual(files);
    expect(result.cases).toHaveLength(4);
    expect([...result.coverage.get('modules/shared.ts')!]).toEqual([[1, 3], [2, 0]]);
  });
  test('retain the original Bun zero-line merge rule across shards', () => {
    const second = artifact(2); const coverage = 'SF:modules/shared.ts\nDA:1,2\nend_of_record\n';
    const result = merge([artifact(1), { ...second, lcov: coverage, receipt: JSON.stringify(makeTierShardReceipt({ ...input, shard: { index: 2, total: 2 }, files: filesInTierShard(files, { index: 2, total: 2 }), exitCode: 0, junit: second.junit, lcov: coverage })) }]);
    expect([...result.coverage.get('modules/shared.ts')!]).toEqual([[1, 3]]);
  });
  test('reject missing, repeated, differently sized and absent shard sets', () => {
    expect(() => merge([])).toThrow();
    expect(() => merge([artifact(1)])).toThrow('缺失');
    expect(() => merge([artifact(1), artifact(1)])).toThrow('重复');
    expect(() => merge([artifact(1), artifact(2, 3)])).toThrow('数量');
  });
  test('reject different commits, different source populations, wrong tiers and incomplete assignment', () => {
    for (const change of [{ commit: 'older' }, { population: 'stale' }, { tier: 'console' }, { schemaVersion: 0 }, { files: [files[0]] }, { files: [...files] }]) expect(() => merge([amend(artifact(1), change), artifact(2)])).toThrow();
  });
  test('reject both original failing cases and a child process error without hiding their reports', () => {
    expect(() => merge([artifact(1, 2, '<failure message="original failure"/>'), artifact(2)])).toThrow('失败');
    expect(() => merge([artifact(1, 2, '', 1), artifact(2)])).toThrow('错误');
    const failed = artifact(1, 2, '<failure message="original failure"/>');
    expect(failed.junit).toContain('original failure');
  });
  test('reject changed or truncated artifacts, a missing executed file and a case from another shard', () => {
    const first = artifact(1);
    expect(() => merge([{ ...first, junit: `${first.junit}broken` }, artifact(2)])).toThrow('回执');
    for (const report of [junit(filesInTierShard(files, { index: 1, total: 2 })).replace('</testsuites>', ''), junit([files[0]!]), junit(files)]) {
      const receipt = makeTierShardReceipt({ ...input, shard: { index: 1, total: 2 }, files: filesInTierShard(files, { index: 1, total: 2 }), junit: report, lcov: first.lcov, exitCode: 0 });
      expect(() => merge([{ ...first, junit: report, receipt: JSON.stringify(receipt) }, artifact(2)])).toThrow();
    }
    const broken = 'SF:modules/shared.ts\nDA:1,9\n';
    const receipt = makeTierShardReceipt({ ...input, shard: { index: 1, total: 2 }, files: filesInTierShard(files, { index: 1, total: 2 }), junit: first.junit, lcov: broken, exitCode: 0 });
    expect(() => merge([{ ...first, lcov: broken, receipt: JSON.stringify(receipt) }, artifact(2)])).toThrow('覆盖率');
  });
  test('the original no-skip tier policy also applies to shard output', () => {
    const art = artifact(1, 1, '<skipped/>');
    const receipt = { ...JSON.parse(art.receipt), tier: 'unit' };
    expect(() => mergeTierShardArtifacts({ ...input, tier: 'unit', artifacts: [{ ...art, receipt: JSON.stringify(receipt) }] })).toThrow('未执行');
  });
});

describe('actual original Bun reports through shard storage', () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-complete-tier-shards-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const original = ['a.test.ts', 'b.test.ts'];
  writeFileSync(join(root, 'value.ts'), 'export const twice = (value: number): number => value * 2;\n');
  for (const file of original) writeFileSync(join(root, file), `import { expect, test } from 'bun:test'; import { twice } from './value'; test('original ${file}', () => expect(twice(3)).toBe(6));\n`);

  test('run original cases exactly once, include empty shards and load the downloaded artifact layout', () => {
    const population = tierPopulationDigest(root, original);
    for (const index of [1, 2, 3, 4]) {
      const shard = { index, total: 4 }; const assigned = filesInTierShard(original, shard);
      const outDir = `coverage/module/shards/tier-module-${index}`; mkdirSync(join(root, outDir), { recursive: true });
      const child = assigned.length > 0 ? Bun.spawnSync(['bun', ...tierTestArgs(assigned, outDir)], { cwd: root, stdout: 'pipe', stderr: 'pipe' }) : undefined;
      expect(child?.exitCode ?? 0).toBe(0);
      if (!child) { writeFileSync(join(root, outDir, 'junit.xml'), '<testsuites></testsuites>'); writeFileSync(join(root, outDir, 'lcov.info'), ''); }
      writeTierShardReceipt({ root, tier: 'module', shard, commit: 'original', population, files: assigned, outDir, exitCode: child?.exitCode ?? 0 });
    }
    const results = readTierShardResults({ root, tier: 'module', files: original, commit: 'original' })!;
    expect(results.cases.map((entry) => entry.file).sort()).toEqual(original);
    expect(results.cases.map((entry) => entry.status)).toEqual(['passed', 'passed']);
    expect(results.coverage.get('value.ts')!.get(1)).toBeGreaterThanOrEqual(2);
    expect(parseJunit(junit(original))).toHaveLength(results.cases.length);
  });
  test('reject stale source, missing artifact, repeated shard, mixed layout and the legacy fallback', () => {
    const pureRoot = mkdtempSync(join(tmpdir(), 'cs-legacy-tier-shards-'));
    try { expect(readTierShardResults({ root: pureRoot, tier: 'module', files: [], commit: 'original' })).toBeUndefined(); } finally { rmSync(pureRoot, { recursive: true, force: true }); }
    expect(() => readTierShardResults({ root, tier: 'module', files: original, commit: 'other' })).toThrow('当前提交');
    const output = join(root, 'coverage/module/shards/tier-module-1/lcov.info');
    const actual = readFileSync(output, 'utf8');
    rmSync(output);
    try { expect(() => readTierShardResults({ root, tier: 'module', files: original, commit: 'original' })).toThrow(); } finally { writeFileSync(output, actual); }
    const receiptPath = join(root, 'coverage/module/shards/tier-module-2/receipt.json');
    const actualReceipt = readFileSync(receiptPath, 'utf8');
    const duplicate = readFileSync(join(root, 'coverage/module/shards/tier-module-1/receipt.json'), 'utf8');
    writeFileSync(receiptPath, duplicate);
    try { expect(() => readTierShardResults({ root, tier: 'module', files: original, commit: 'original' })).toThrow(); } finally { writeFileSync(receiptPath, actualReceipt); }
    const before = tierPopulationDigest(root, original);
    writeFileSync(join(root, original[0]!), `// changed source\nimport { test } from 'bun:test'; test('changed', () => {});\n`);
    expect(tierPopulationDigest(root, original)).not.toBe(before);
    expect(() => readTierShardResults({ root, tier: 'module', files: original, commit: 'original' })).toThrow('人口');
    writeFileSync(join(root, 'coverage/module/junit.xml'), '<testsuites></testsuites>');
    expect(() => readTierShardResults({ root, tier: 'module', files: original, commit: 'original' })).toThrow('混用');
  });
});
