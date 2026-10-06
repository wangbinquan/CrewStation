import type { Actor, UserId } from '@crewstation/contracts';
import { forbidden, precondition } from '@crewstation/kernel';
import type { Logger } from '@crewstation/kernel';
import type { ProjectDeletionController } from '../../api/deletion';
import type { ProjectDeletionIntents, ProjectDeletionStopOwner } from '../../ports/projectDeletions';
import { assertDeletionOwners, collectDeletionInventory } from './inventory';
import { advanceProjectDeletion } from './advance';
import { deletionOperatorRepairs } from './operatorRepairs';

export interface DeletionControllerDeps {
  readonly intents: ProjectDeletionIntents; readonly owners: readonly ProjectDeletionStopOwner[]; readonly workerOwner: string;
  readonly isAdmin: (id: UserId) => Promise<boolean>; readonly enqueue: (id: string) => Promise<void>; readonly logger: Logger;
}
export function projectDeletionController(deps: DeletionControllerDeps): ProjectDeletionController {
  assertDeletionOwners(deps.owners);
  const admin = async (actor: Actor) => { if (!(await deps.isAdmin(actor.userId))) throw forbidden('只有管理员可以永久删除项目'); };
  const bestEffortQueue = async (id: string) => { try { await deps.enqueue(id); } catch { deps.logger.warn('project deletion queue delayed; persistent recovery will retry', { operationId: id }); } };
  return {
    repairs: deletionOperatorRepairs(deps.intents, deps.owners, deps.isAdmin),
    prepare: async (actor, id) => { await admin(actor); return deps.intents.prepare(actor, id, await collectDeletionInventory(deps.intents, deps.owners, id)); },
    accept: async (actor, id, input) => {
      await admin(actor); const previous = await deps.intents.replay(actor, id, input); if (previous) return previous;
      const operation = await deps.intents.accept(actor, id, input);
      await bestEffortQueue(operation.id); return operation;
    },
    read: async (actor, id) => { await admin(actor); return deps.intents.read(actor, id); },
    find: async (actor, id) => { await admin(actor); return deps.intents.find(actor, id); },
    retry: async (actor, id) => { await admin(actor); const operation = await deps.intents.retry(actor, id); if (operation.state === 'accepted') await bestEffortQueue(id); return operation; },
    prepareReconfirmation: async (actor, id) => {
      await admin(actor); const operation = await deps.intents.read(actor, id);
      return deps.intents.prepareReconfirmation(actor, id, await collectDeletionInventory(deps.intents, deps.owners, operation.project.id));
    },
    reconfirm: async (actor, id, input) => {
      await admin(actor); const previous = await deps.intents.replayReconfirmation(actor, id, input); if (previous) return previous;
      const current = await deps.intents.read(actor, id);
      const operation = await deps.intents.reconfirm(actor, id, input, await collectDeletionInventory(deps.intents, deps.owners, current.project.id));
      await bestEffortQueue(id); return operation;
    },
    enqueue: deps.enqueue,
    advance: (id, heartbeat) => advanceProjectDeletion(deps.intents, deps.owners, id, deps.workerOwner, heartbeat),
    recover: async () => {
      let after: string | undefined;
      for (let page = 0; page < 10_000; page++) {
        const ids = await deps.intents.pending(after, 100);
        for (const id of ids) await deps.enqueue(id);
        if (ids.length < 100) return;
        const last = ids.at(-1)!; if (last === after) throw precondition('删除操作恢复游标未推进'); after = last;
      }
      throw precondition('项目删除恢复扫描超过单轮上限，保留原操作等待下轮');
    },
  };
}
