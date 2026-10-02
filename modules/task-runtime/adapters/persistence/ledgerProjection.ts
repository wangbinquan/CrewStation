import { precondition } from '@crewstation/kernel';
import { sealedDevelopmentParentProjection } from '../../domain/development/parentProjection';
import { readDevelopmentParentEnding } from '../../domain/development/parentEnding';
import { drizzleDevelopmentParentEndings, drizzleDevelopmentParentRebuildClaims } from './developmentParentEndings';
import { drizzleRebuildRepository } from './drizzleRebuildRepository';
import { DevelopmentParentRebuildBindingSchema } from '../../domain/development/parentRebuildBinding';
import { requirePublishedParentRebuild } from '../../domain/development/parentRebuildPublication';
import type { Logger } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import type { ProjectedRecord } from '../../domain/ledgerProjection';
import { projectEnvironment, runnerCondition } from '../../domain/ledgerProjection';
import { hasDevelopmentParentEnding } from '../../domain/development/parentEnding';
import type { TaskEnvironment, WorkloadRender } from '../../domain/taskEnvironment';
import type { EnvironmentLedger, LedgerRecordRef, LedgerWriter } from '../../ports/ledger';
import type { EnvironmentRepository } from '../../ports/repositories';

/** Recognize owner requests from their original SQL binding, without inventing a render. Resolve before any compatibility savepoint catch. */
async function selectedParentProjection(executor: Executor, env: TaskEnvironment): Promise<boolean> {
  if (hasDevelopmentParentEnding(env)) return true;
  const selection = !!env.render?.rebuild && Object.hasOwn(env.render.rebuild, 'developmentParentSelection');
  if (!env.rebuildId) {
    if (selection) throw precondition('原恢复台账请求指针尚未恢复');
    return false;
  }
  const record = await drizzleRebuildRepository(executor).get(env.rebuildId);
  if (!record) throw precondition('原恢复台账记录尚未恢复');
  if (!Object.hasOwn(record, 'developmentParentBinding')) {
    if (selection) throw precondition('原恢复台账严格绑定尚未恢复');
    return false;
  }
  const binding = DevelopmentParentRebuildBindingSchema.parse(record.developmentParentBinding);
  const ending = await drizzleDevelopmentParentEndings(executor).get(binding.endingId);
  if (!ending) throw precondition('原恢复台账完成来源尚未恢复');
  requirePublishedParentRebuild(env, record, ending);
  if (binding.kind === 'completed-ending') {
    const claim = await drizzleDevelopmentParentRebuildClaims(executor).get(ending.id);
    if (!claim || claim.state !== 'published' || claim.currentRebuildId !== record.id || claim.revision !== binding.claimRevision) throw precondition('原恢复台账发布占位已变化');
  }
  return true;
}
/** Same Task transaction and same Executor; selected seals never call a live preview resolver under Project locks. */
async function originalProjection(executor: Executor, env: TaskEnvironment, preview?: (env: TaskEnvironment) => Promise<WorkloadRender['previewRoute']>, selected?: boolean) {
  const pointer = readDevelopmentParentEnding(env);
  selected ??= await selectedParentProjection(executor, env);
  const projection = projectEnvironment(env, selected ? env.render?.previewRoute : await preview?.(env) ?? env.render?.previewRoute);
  if (!pointer) return projection;
  const ending = await drizzleDevelopmentParentEndings(executor).get(pointer.endingId);
  if (!ending) throw precondition('原父结束台账材料未在同一事务受理');
  return sealedDevelopmentParentProjection(projection, env, ending);
}

/**
 * 一条记录的投影：从没进过台账又已经不要了的不补记；已受理释放的期望不再变（台账也拒绝重新声明），
 * 继续同步所属模块的条件与具体释放原因，不重新声明已释放记录。
 */
async function syncRecord(writer: LedgerWriter, record: ProjectedRecord, connected?: boolean, sourceId?: string): Promise<void> {
  const existing = await writer.find(record.ref, record.kind);
  if (!existing && record.release) return;
  if (existing?.desired === 'absent') {
    await writer.report(existing.id, { conditions: record.conditions });
    if (record.release) await writer.requestRelease(existing.id, record.release);
    return;
  }
  const runner = connected === undefined ? [] : runnerCondition(connected, existing?.conditions ?? []);
  const declare = sourceId && writer.splitChildren ? (input: Parameters<LedgerWriter['declare']>[0]) => writer.splitChildren!(sourceId, input) : (input: Parameters<LedgerWriter['declare']>[0]) => writer.declare(input);
  const saved = await declare({
    ...(record.id ? { id: record.id } : {}), kind: record.kind, ref: record.ref, ...(record.projectId ? { projectId: record.projectId } : {}),
    ...(record.parentId ? { parentId: record.parentId } : {}), ...(record.purpose ? { purpose: record.purpose } : {}),
    spec: { children: record.children, ...(record.reclaim ? { reclaim: record.reclaim } : {}), ...record.render }, display: record.display, conditions: [...record.conditions, ...runner],
    ...(record.aliases ? { aliases: record.aliases } : {}),
  });
  if (record.startup) await writer.report(saved.id, { startup: record.startup });
  if (record.release) await writer.requestRelease(saved.id, record.release);
}

/**
 * 在当前事务里把环境投影进资源台账（RFC-025 第二期）。投影包在保存点里：台账写失败只回滚保存点、记一条日志，
 * 未选中原父协议的旧环境保留兼容补投影；选中原父或新恢复 epoch 时失败必须连同 Task 事务回滚。
 */
export async function syncEnvironmentLedger(executor: Executor, ledger: EnvironmentLedger, env: TaskEnvironment, logger: Logger, preview?: (env: TaskEnvironment) => Promise<WorkloadRender['previewRoute']>): Promise<void> {
  const selected = await selectedParentProjection(executor, env);
  try {
    const projection = await originalProjection(executor, env, preview, selected);
    await executor.transaction(async (savepoint) => {
      const writer = ledger.within(savepoint);
      await syncRecord(writer, projection.workload, projection.connected);
      if (projection.volume) await syncRecord(writer, projection.volume);
      if (projection.route) await syncRecord(writer, projection.route, undefined, env.id);
    });
  } catch (error) {
    // RFC-027 的额度释放依赖清理确认条件，投影失败必须与环境状态一起回滚。
    if (env.render?.businessStorage || env.render?.developmentUsageProtection !== undefined || selected) throw error;
    logger.warn('resource ledger projection failed', { taskId: env.id, error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * 经台账受理一个环境（RFC-025 设计 §3）：它的工作负载记录在项目锁下按台账数额度，够才声明。不包保存点——额度不够必须挡住
 * 所属模块的这次写入（同一事务一起回滚）；此后同一事务里的投影照常补上工作卷与启动进度。
 */
export async function admitEnvironment(executor: Executor, ledger: EnvironmentLedger, env: TaskEnvironment): Promise<void> {
  const { workload } = await originalProjection(executor, env);
  await ledger.within(executor).admit({
    ...(workload.id ? { id: workload.id } : {}), kind: workload.kind, ref: workload.ref, ...(workload.projectId ? { projectId: workload.projectId } : {}),
    ...(workload.parentId ? { parentId: workload.parentId } : {}), ...(workload.purpose ? { purpose: workload.purpose } : {}),
    spec: { children: workload.children, ...workload.render }, display: workload.display, conditions: workload.conditions,
  });
}

/**
 * 在当前事务里读这个环境的工作负载记录（资源中心可能已替它改了期望：失败保留期满）。包在保存点里：
 * 台账读不到（暂时不可用）当作没有，不让所属模块的事务因此中止。
 */
export async function findWorkloadRecord(executor: Executor, ledger: EnvironmentLedger, env: TaskEnvironment): Promise<LedgerRecordRef | undefined> {
  const { workload } = await originalProjection(executor, env);
  try { return await executor.transaction((savepoint) => ledger.within(savepoint).find(workload.ref, workload.kind)); } catch { return undefined; }
}

/** 环境仓储的投影装饰：每次落库之后，在同一事务里同步台账。其余读方法原样透传。 */
export function ledgerEnvironmentRepository(inner: EnvironmentRepository, sync: (env: TaskEnvironment) => Promise<void>): EnvironmentRepository {
  return {
    ...inner,
    insert: async (env) => { await inner.insert(env); await sync(env); },
    update: async (env) => { await inner.update(env); await sync(env); },
  };
}
