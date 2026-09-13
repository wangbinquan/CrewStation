import { COMPARISON_TTL_MS } from '@crewstation/contracts';
import type { ComparisonFile, RunnerComparison, WorkspaceReady } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';

export interface ComparisonSnapshot {
  id: string; targetSha: string | undefined; workspace: WorkspaceReady; createdAt: number;
  result: RunnerComparison; files: ComparisonFile[] | undefined;
}

/** 仅用于有界短期详情恢复；Runner 重启或过期后要求重算，不伪装继续使用旧比较。 */
export function comparisonSnapshots(capacity = 32, now: () => number = Date.now) {
  const entries = new Map<string, ComparisonSnapshot>();
  return {
    find(workspace: WorkspaceReady, targetSha?: string): ComparisonSnapshot | undefined {
      return [...entries.values()].find((entry) => entry.createdAt + COMPARISON_TTL_MS >= now()
        && entry.targetSha === targetSha && entry.workspace.fingerprint === workspace.fingerprint && entry.workspace.shallow === workspace.shallow
        && entry.result.commits.status !== 'unavailable' && (entry.result.files.status === 'ready' || !targetSha));
    },
    save(snapshot: ComparisonSnapshot) {
      entries.set(snapshot.id, snapshot);
      for (const [id, entry] of entries) if (entry.createdAt + COMPARISON_TTL_MS < now()) entries.delete(id);
      while (entries.size > capacity) entries.delete(entries.keys().next().value!);
    },
    get(id: string): ComparisonSnapshot {
      const entry = entries.get(id);
      if (!entry || entry.createdAt + COMPARISON_TTL_MS < now()) throw new RunnerCommandError('comparison_expired', '比较已过期，请重新计算');
      return entry;
    },
    clear() { entries.clear(); },
  };
}
