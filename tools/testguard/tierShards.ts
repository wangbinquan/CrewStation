import { createHash } from 'node:crypto';
import type { TestCase } from './junitReport';
import type { Coverage } from './lcovReport';
import { mergeCoverage, parseLcov } from './lcovReport';
import type { TestTier } from './testTiers';
import { auditPassed, auditTiers } from './tierAudit';
import { parseShardJunit, validateShardLcov } from './shardArtifactFormats';

export interface TierShard { readonly index: number; readonly total: number }
export interface TierShardReceipt extends TierShard {
  readonly schemaVersion: 1;
  readonly tier: TestTier;
  readonly commit: string;
  readonly population: string;
  readonly files: readonly string[];
  readonly exitCode: number;
  readonly junit: string;
  readonly lcov: string;
}
export interface TierShardArtifact { readonly receipt: string; readonly junit: string; readonly lcov: string }

export const artifactSha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** 1-based shard numbers. Partitioning never limits the tier's population. */
export function parseTierShard(value: string | undefined): TierShard | undefined {
  if (value === undefined) return undefined;
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value);
  const index = Number(match?.[1]); const total = Number(match?.[2]);
  if (!match || !Number.isSafeInteger(index) || !Number.isSafeInteger(total) || index > total) throw new Error(`无效分片：${value}；使用 1/4 这样的编号`);
  return { index, total };
}

export function filesInTierShard(files: readonly string[], shard: TierShard): string[] {
  parseTierShard(`${shard.index}/${shard.total}`);
  const ordered = [...files].sort();
  if (new Set(ordered).size !== ordered.length) throw new Error('完整分层清单有重复文件');
  return ordered.filter((_, index) => index % shard.total === shard.index - 1);
}

export function makeTierShardReceipt(input: {
  tier: TestTier; shard: TierShard; commit: string; population: string;
  files: readonly string[]; exitCode: number; junit: string; lcov: string;
}): TierShardReceipt {
  return {
    schemaVersion: 1, tier: input.tier, ...input.shard, commit: input.commit, population: input.population,
    files: input.files, exitCode: input.exitCode, junit: artifactSha256(input.junit), lcov: artifactSha256(input.lcov),
  };
}

function readShard(input: {
  tier: TestTier; files: readonly string[]; commit: string; population: string;
}, artifact: TierShardArtifact): { receipt: TierShardReceipt; cases: TestCase[]; coverage: Coverage } {
  const receipt = JSON.parse(artifact.receipt) as TierShardReceipt;
  parseTierShard(`${receipt.index}/${receipt.total}`);
  if (receipt.schemaVersion !== 1 || receipt.tier !== input.tier || receipt.commit !== input.commit || receipt.population !== input.population) throw new Error('分片不是当前提交的完整分层人口');
  const assigned = filesInTierShard(input.files, receipt);
  if (JSON.stringify(receipt.files) !== JSON.stringify(assigned)) throw new Error('分片文件清单有遗漏、重复或交叉');
  if (receipt.junit !== artifactSha256(artifact.junit) || receipt.lcov !== artifactSha256(artifact.lcov)) throw new Error('分片产物与完成回执不一致');
  const cases = parseShardJunit(artifact.junit);
  const expected = { unit: [], module: [], console: [], e2e: [], [input.tier]: assigned };
  const audit = auditTiers(expected, [input.tier], cases);
  if (!auditPassed(audit) || cases.some((entry) => !assigned.includes(entry.file))) throw new Error('分片存在未执行或越片用例');
  if (receipt.exitCode !== 0 || cases.some((entry) => entry.status === 'failed')) throw new Error('分片有失败用例或执行错误');
  validateShardLcov(artifact.lcov);
  return { receipt, cases, coverage: parseLcov(artifact.lcov) };
}

/** No missing shards, no overlap, same source population; merge the original line-hit maps. */
export function mergeTierShardArtifacts(input: {
  tier: TestTier; files: readonly string[]; commit: string; population: string;
  artifacts: readonly TierShardArtifact[];
}): { cases: TestCase[]; coverage: Coverage } {
  if (input.artifacts.length === 0) throw new Error('未收到完整分层的分片产物');
  const shards = input.artifacts.map((artifact) => readShard(input, artifact));
  const total = shards[0]!.receipt.total;
  const indices = new Set(shards.map((shard) => shard.receipt.index));
  if (shards.length !== total || indices.size !== total || shards.some((shard) => shard.receipt.total !== total)) throw new Error('分层分片缺失、重复或数量不一致');
  shards.sort((a, b) => a.receipt.index - b.receipt.index);
  return { cases: shards.flatMap((shard) => shard.cases), coverage: mergeCoverage(shards.map((shard) => shard.coverage)) };
}
