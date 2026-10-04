import { ProjectDeletionEvidenceSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { DevelopmentStoppedScopeSchema } from '../../../domain/deletion/projectDeletion';
import type { DevelopmentWorkSources } from '../../../ports/deletion/work';
import { inspection, legacyPending, load, pending } from './scopeStore';

/** The stopped original scope and its witness share one actual PostgreSQL commit. */
export async function captureDevelopmentStopped(tx: Executor, sources: DevelopmentWorkSources, context: ProjectDeletionContext) {
  const state = await load(tx, context);
  if (context.phase !== 'stop' || !state.proofs.seal || state.scope.compacted || await pending(tx, context) || await legacyPending(tx, context))
    throw precondition('开发原回调或原数字排空尚未收尾');
  if (state.proofs.stop) return state.proofs.stop;
  const current = await inspection(tx, sources, context.target);
  const stopped = DevelopmentStoppedScopeSchema.parse({ contents: current.scope.contents, callbacks: current.scope.callbacks,
    count: current.scope.count, digest: jsonHash({ contents: current.scope.contents, callbacks: current.scope.callbacks }) });
  const evidence = ProjectDeletionEvidenceSchema.parse({ kind: 'metadata', count: stopped.count, digest: jsonHash({ operationId: context.operationId, stopped: stopped.digest }),
    description: '原开发回调及数字排空已退出，停止后完整内容与回执在同一事务冻结' });
  await tx.execute(sql`UPDATE dev_session.project_deletions SET generation=${context.generation},body=body||${JSON.stringify({ stopped })}::jsonb,
    phases=phases||${JSON.stringify({ stop: evidence })}::jsonb WHERE project_id=${context.target.id}`);
  return evidence;
}
