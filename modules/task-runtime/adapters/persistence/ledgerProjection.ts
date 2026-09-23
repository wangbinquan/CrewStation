import type { Logger } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import type { ProjectedRecord } from '../../domain/ledgerProjection';
import { projectEnvironment, runnerCondition } from '../../domain/ledgerProjection';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import type { EnvironmentLedger, LedgerRecordRef, LedgerWriter } from '../../ports/ledger';
import type { EnvironmentRepository } from '../../ports/repositories';

/**
 * 一条记录的投影：从没进过台账又已经不要了的不补记；已受理释放的期望不再变（台账也拒绝重新声明），
 * 只把后来知道的具体释放原因交给台账补上。
 */
async function syncRecord(writer: LedgerWriter, record: ProjectedRecord, connected?: boolean): Promise<void> {
  const existing = await writer.find(record.ref, record.kind);
  if (!existing && record.release) return;
  if (existing?.desired === 'absent') {
    if (record.release) await writer.requestRelease(existing.id, record.release);
    return;
  }
  const runner = connected === undefined ? [] : runnerCondition(connected, existing?.conditions ?? []);
  const saved = await writer.declare({
    ...(record.id ? { id: record.id } : {}), kind: record.kind, ref: record.ref, projectId: record.projectId,
    ...(record.parentId ? { parentId: record.parentId } : {}), ...(record.purpose ? { purpose: record.purpose } : {}),
    spec: { children: record.children, ...(record.reclaim ? { reclaim: record.reclaim } : {}) }, display: record.display, conditions: [...record.conditions, ...runner],
  });
  if (record.startup) await writer.report(saved.id, { startup: record.startup });
  if (record.release) await writer.requestRelease(saved.id, record.release);
}

/**
 * 在当前事务里把环境投影进资源台账（RFC-025 第二期）。投影包在保存点里：台账写失败只回滚保存点、记一条日志，
 * 环境本身照常提交——迁移期间台账的问题不能挡住开发会话与 CLI 的操作；漏掉的由补投影（ledgerResync）追上。
 */
export async function syncEnvironmentLedger(executor: Executor, ledger: EnvironmentLedger, env: TaskEnvironment, logger: Logger): Promise<void> {
  const projection = projectEnvironment(env);
  try {
    await executor.transaction(async (savepoint) => {
      const writer = ledger.within(savepoint);
      await syncRecord(writer, projection.workload, projection.connected);
      if (projection.volume) await syncRecord(writer, projection.volume);
    });
  } catch (error) {
    logger.warn('resource ledger projection failed', { taskId: env.id, error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * 经台账受理一个环境（RFC-025 设计 §3）：它的工作负载记录在项目锁下按台账数额度，够才声明。不包保存点——额度不够必须挡住
 * 所属模块的这次写入（同一事务一起回滚）；此后同一事务里的投影照常补上工作卷与启动进度。
 */
export async function admitEnvironment(executor: Executor, ledger: EnvironmentLedger, env: TaskEnvironment): Promise<void> {
  const { workload } = projectEnvironment(env);
  await ledger.within(executor).admit({
    ...(workload.id ? { id: workload.id } : {}), kind: workload.kind, ref: workload.ref, projectId: workload.projectId,
    ...(workload.parentId ? { parentId: workload.parentId } : {}), ...(workload.purpose ? { purpose: workload.purpose } : {}),
    spec: { children: workload.children }, display: workload.display, conditions: workload.conditions,
  });
}

/**
 * 在当前事务里读这个环境的工作负载记录（资源中心可能已替它改了期望：失败保留期满）。包在保存点里：
 * 台账读不到（暂时不可用）当作没有，不让所属模块的事务因此中止。
 */
export async function findWorkloadRecord(executor: Executor, ledger: EnvironmentLedger, env: TaskEnvironment): Promise<LedgerRecordRef | undefined> {
  const { workload } = projectEnvironment(env);
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
