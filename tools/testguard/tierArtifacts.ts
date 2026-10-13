import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestCase } from './junitReport';
import type { Coverage } from './lcovReport';
import type { TestTier } from './testTiers';
import type { TierShard, TierShardArtifact } from './tierShards';
import { artifactSha256, makeTierShardReceipt, mergeTierShardArtifacts } from './tierShards';

export function tierPopulationDigest(root: string, files: readonly string[]): string {
  return artifactSha256(JSON.stringify([...files].sort().map((file) => [file, artifactSha256(readFileSync(join(root, file), 'utf8'))])));
}

/** Undefined retains the original single-job artifact behavior. Mixed populations are an error. */
export function readTierShardResults(input: {
  root: string; tier: TestTier; files: readonly string[]; commit: string;
}): { cases: TestCase[]; coverage: Coverage } | undefined {
  const base = join(input.root, 'coverage', input.tier);
  const shards = join(base, 'shards');
  if (!existsSync(shards)) return undefined;
  if (existsSync(join(base, 'junit.xml')) || existsSync(join(base, 'lcov.info'))) throw new Error('同一分层不能混用单作业和分片产物');
  const artifacts: TierShardArtifact[] = readdirSync(shards).map((directory) => {
    const dir = join(shards, directory);
    return { receipt: readFileSync(join(dir, 'receipt.json'), 'utf8'), junit: readFileSync(join(dir, 'junit.xml'), 'utf8'), lcov: readFileSync(join(dir, 'lcov.info'), 'utf8') };
  });
  return mergeTierShardArtifacts({ ...input, artifacts, population: tierPopulationDigest(input.root, input.files) });
}

/** Written only after the original Bun process and its assigned-file audit have completed. */
export function writeTierShardReceipt(input: {
  root: string; tier: TestTier; shard: TierShard; commit: string;
  population: string; files: readonly string[]; outDir: string; exitCode: number;
}): void {
  const dir = join(input.root, input.outDir);
  const receipt = makeTierShardReceipt({ ...input, junit: readFileSync(join(dir, 'junit.xml'), 'utf8'), lcov: readFileSync(join(dir, 'lcov.info'), 'utf8') });
  writeFileSync(join(dir, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
}
