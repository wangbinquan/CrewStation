import type { ComparisonDetailQuery, ComparisonDetails, ComparisonFile, ComparisonFileSummary, RunnerComparison } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';
import type { FileComparisonDeps } from './untrackedDiff';
import { compareCommits } from './commitComparison';
import { comparisonDetails } from './comparisonDetails';
import type { ComparisonSnapshot } from './comparisonSnapshots';
import { comparisonSnapshots } from './comparisonSnapshots';
import { readWorkspaceStatus } from './workspaceStatus';
import { workspaceFiles } from './workspaceFiles';
import { gitWithin } from './gitCommand';

export interface WorkspaceComparisons {
  compare(targetSha?: string): Promise<RunnerComparison>;
  details(comparisonId: string, query: ComparisonDetailQuery): Promise<ComparisonDetails>;
  clear(): void;
}

export function createWorkspaceComparisons(source: FileComparisonDeps): WorkspaceComparisons {
  const snapshots = comparisonSnapshots();
  const requireCurrent = async (deps: FileComparisonDeps, snapshot: ComparisonSnapshot): Promise<void> => {
    const current = await readWorkspaceStatus(deps.git, deps.paths);
    if (current.status !== 'ready' || current.fingerprint !== snapshot.workspace.fingerprint) throw new RunnerCommandError('comparison_stale', '工作树已变化，旧比较失效，请重新计算');
  };
  return {
    async compare(targetSha) {
      const deps = { ...source, git: gitWithin(source.git, 60_000) };
      const workspace = await readWorkspaceStatus(deps.git, deps.paths);
      const base = { comparisonId: null, ...(targetSha ? { targetSha } : {}), workspace, checkedAt: new Date().toISOString(), freshness: 'current' as const };
      if (workspace.status === 'unavailable') return { ...base, commits: { status: 'unavailable', reason: workspace.reason }, files: { status: 'unavailable', reason: workspace.reason } };
      const existing = snapshots.find(workspace, targetSha);
      if (existing) return { ...existing.result, workspace, checkedAt: base.checkedAt };
      const commits = await compareCommits(deps.git, workspace, targetSha);
      const net = await readNetFiles(deps, targetSha);
      const result: RunnerComparison = { ...base, comparisonId: crypto.randomUUID(), commits, files: net.summary };
      const snapshot: ComparisonSnapshot = { id: result.comparisonId!, targetSha, workspace, createdAt: Date.now(), result, files: net.files };
      try { await requireCurrent(deps, snapshot); } catch { return { ...result, comparisonId: null, freshness: 'stale' }; }
      snapshots.save(snapshot);
      return result;
    },
    async details(comparisonId, query) {
      const deps = { ...source, git: gitWithin(source.git, 60_000) };
      const snapshot = snapshots.get(comparisonId);
      await requireCurrent(deps, snapshot);
      const result = await comparisonDetails(deps, snapshot, query);
      await requireCurrent(deps, snapshot);
      return result;
    },
    clear: () => snapshots.clear(),
  };
}

async function readNetFiles(deps: FileComparisonDeps, targetSha?: string): Promise<{ summary: ComparisonFileSummary; files?: ComparisonFile[] }> {
  if (!targetSha) return { summary: { status: 'unavailable', reason: '尚无目标部署版本' } };
  try {
    const files = await workspaceFiles(deps, targetSha);
    return { summary: { status: 'ready', count: files.length, untrackedCount: files.filter((file) => file.untracked).length }, files };
  } catch (error) {
    return { summary: { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) } };
  }
}
