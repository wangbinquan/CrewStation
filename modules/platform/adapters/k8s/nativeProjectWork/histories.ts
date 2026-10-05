import type { BuildKitHistory } from '@crewstation/filesystem-metrics';
import { precondition } from '@crewstation/kernel';

type ClassifiedHistory = { classification: 'owned' | 'protected' | 'mixed' | 'unattributed'; history: BuildKitHistory };
/** An anonymous completed build predating the independently read project birth
 * cannot belong to that project. Preserve its history, leases and outputs in
 * full. Anonymous later builds and mixed attribution remain blockers. */
export function projectBuildHistories(histories: readonly ClassifiedHistory[], projectCreatedAt: string) {
  const birth = Date.parse(projectCreatedAt);
  if (!Number.isFinite(birth) || new Set(histories.map(row => row.history.ref)).size !== histories.length) throw precondition('原项目或构建历史出生身份不完整');
  const owned: BuildKitHistory[] = [], protectedHistories: BuildKitHistory[] = [];
  for (const row of histories) {
    const created = Date.parse(row.history.createdAt), completed = row.history.completedAt ? Date.parse(row.history.completedAt) : undefined;
    if (!Number.isFinite(created) || completed !== undefined && (!Number.isFinite(completed) || completed < created)) throw precondition('原构建历史出生顺序不符');
    if (row.classification === 'owned') {
      if (created < birth || row.history.event !== 'complete' || completed === undefined) throw precondition('原项目构建尚未完成或早于原项目出生');
      owned.push(row.history);
    } else if (row.classification === 'protected' || row.classification === 'unattributed' && row.history.event === 'complete' && completed !== undefined && completed < birth) protectedHistories.push(row.history);
    else throw precondition('共享构建存在归属不明的原历史，保留完整范围等待');
  }
  return { owned, protectedHistories, projectCreatedAt };
}
