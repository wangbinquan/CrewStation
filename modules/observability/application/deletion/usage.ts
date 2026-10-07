import { TaskIdSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext, TaskId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { ObservationDeletionWriter, ObservationOriginalTask, ObservationOriginalUsage } from '../../ports/deletionUsage';
import { runnerPage } from '../usageIngestion';

async function drainBusiness(context: ProjectDeletionContext, taskId: TaskId, task: ObservationOriginalTask, source: ObservationOriginalUsage, writer: ObservationDeletionWriter) {
  let after: string | null = null;
  while (true) {
    const originals = await task.originalBusiness(after);
    if (originals.length > 100 || originals.some((receipt, index) => receipt.executionId <= (index ? originals[index - 1]!.executionId : after ?? ''))) throw precondition('原业务执行目录不连续或重复');
    if (!originals.length) return;
    for (const receipt of originals) {
      let through: number | undefined;
      while (true) {
        const page = await task.offerBusiness(receipt.executionId);
        if (!page) break;
        if (page.runtimeTaskId !== taskId || page.executionId !== receipt.executionId || page.attempt !== receipt.attempt
          || page.incarnation !== receipt.incarnation || page.payloadDigest !== receipt.payloadDigest || page.through > receipt.lastSequence
          || through !== undefined && page.after !== through) throw precondition('观测排空的原业务来源已经变化');
        const identity = await source.business(page);
        if (!identity || identity.projectId !== context.target.id) throw precondition('原业务数字页缺少独立项目归属');
        await writer.business(context, task, page, runnerPage(page, identity));
        await task.acknowledgeBusiness(page.executionId, page.through);
        through = page.through;
      }
    }
    after = originals.at(-1)!.executionId;
  }
}
async function drainDevelopment(context: ProjectDeletionContext, taskId: TaskId, task: ObservationOriginalTask, source: ObservationOriginalUsage, writer: ObservationDeletionWriter) {
  const lookup = await task.lookupDevelopmentUsage(taskId);
  if (lookup.kind === 'absent') return;
  if (lookup.kind !== 'registered') throw precondition('原开发数字登记不可读取');
  const registration = lookup.stored.registration;
  if (registration.runtimeTaskId !== taskId || registration.identity.projectId !== context.target.id) throw precondition('原开发数字登记归属已经变化');
  let through: number | undefined;
  while (true) {
    const page = await task.offerDevelopment(registration.key);
    if (!page) break;
    if (through !== undefined && page.after !== through) throw precondition('原开发数字页没有沿已提交水位继续');
    const owner = await source.development(page.key);
    if (!owner) throw precondition('原开发数字页缺少独立开发 owner');
    await writer.development(context, page, owner, registration, task);
    await task.acknowledgeDevelopment(page.key, page.through);
    through = page.through;
  }
  await writer.developmentPending?.(context, registration, task);
}
/** No ordinary polling caps or swallowed failures: every original directory and numerical source reaches EOF. */
export function drainOriginalObservationUsage(source: ObservationOriginalUsage, writer: ObservationDeletionWriter) {
  return async (context: ProjectDeletionContext): Promise<void> => {
    if (context.phase !== 'stop') throw precondition('原观测消费者只能在停止阶段排空');
    let after: TaskId | null = null;
    while (true) {
      const ids: TaskId[] = (await source.tasks(context, after)).map((id) => TaskIdSchema.parse(id));
      if (ids.length > 200 || ids.some((id, index) => id <= (index ? ids[index - 1]! : after ?? ''))) throw precondition('原会话任务目录不连续或重复');
      if (!ids.length) return;
      for (const id of ids) {
        const task = await source.task(context, id);
        await drainBusiness(context, id, task, source, writer);
        await drainDevelopment(context, id, task, source, writer);
      }
      after = ids.at(-1)!;
    }
  };
}
