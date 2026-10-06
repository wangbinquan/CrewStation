import type { ProjectId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { appendContentConfirmation, readContentConfirmation, withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import type { NativeDeletionConfirmations, NativeDeletionScope } from '../../ports/dataPlane';
import { nativeAdmissionKey } from './nativeWork';

export function nativeOperatorConfirmations(db: Database): NativeDeletionConfirmations {
  return {
    read: async (context: ProjectId, source, evidence) => {
      const saved = await readContentConfirmation(db, 'data_control', { context, key: 'postgres-current', source, evidence });
      if (!saved || saved.decision !== 'reclaim' || !saved.value || typeof saved.value !== 'object') return undefined;
      const scope = (saved.value as { scope?: NativeDeletionScope }).scope;
      return scope ? { scope, actor: saved.actor, at: saved.at } : undefined;
    },
    save: (projectId, actor, source, evidence, scope, verify) => withExclusiveDatabaseAdmission(db, nativeAdmissionKey(projectId), async (tx) => {
      if (!actor.isAdmin) throw precondition('数据库重新确权只允许当前管理员');
      await verify();
      const saved = await appendContentConfirmation(tx, 'data_control', { context: projectId, key: 'postgres-current', source, evidence, decision: 'reclaim', actor: actor.userId,
        at: new Date().toISOString(), value: { version: 'operator-confirmed/v1', scope } });
      await verify(); return { actor: saved.actor, at: saved.at };
    }),
  };
}
