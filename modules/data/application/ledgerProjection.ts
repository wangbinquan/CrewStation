import type { ServiceId } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import type { DataResource } from '../domain/dataResource';
import type { Projection, ReleaseReason } from '../domain/dataRecords';
import { bindingProjection, databaseProjection } from '../domain/dataRecords';
import type { TaskDataBinding } from '../domain/taskDataBinding';
import type { DataLedger } from '../ports/ledger';
import type { DataResourceRepository, TaskDataBindingRepository } from '../ports/repositories';

const GONE: ReleaseReason = { code: 'binding-missing', message: '访问绑定已不在' };

/**
 * 数据资源与访问绑定投影进资源台账（RFC-025 第四期第一步）：台账记期望与领域条件，data-control 观测数据面写实况；
 * 按 I28 裁定，byDataControl 时生产库、开发库与访问绑定的临时角色由 data-control 建（期望里标明），旧形状仍由 data 建。投影跟在仓储写入之后；台账写失败只告警——
 * 数据资源的操作照常完成，每 5 分钟的补投影会追上。
 */
export function dataLedgerProjection(ledger: DataLedger, logger: Logger, byDataControl = false) {
  const apply = async <D extends { readonly id: string }>(projection: Projection<D> | undefined, declare: (input: D) => Promise<unknown>): Promise<void> => {
    if (!projection) return;
    if (!projection.release) {
      await declare(projection.declaration);
      return;
    }
    // 已结束：记录还「要」才受理释放；从没声明过的（台账接上之前就结束了）不补记录。
    const record = await ledger.get(projection.declaration.id);
    if (record?.desired === 'present') await ledger.requestRelease(record.id, projection.release);
  };
  const projectResource = (resource: DataResource) => apply(databaseProjection(resource, byDataControl), ledger.declare);
  // 临时角色建在生产库上：期望里带上库名与运行角色（同名），data-control 删角色时据此转交它拥有的对象。
  const projectBinding = async (binding: TaskDataBinding, resources: Pick<DataResourceRepository, 'find'>) => {
    const prod = await resources.find(binding.serviceId as ServiceId, 'production', 'postgres');
    const target = prod?.state === 'ready' ? { database: prod.objectName, ownerRole: prod.objectName } : undefined;
    await apply(bindingProjection(binding, target, byDataControl), ledger.declare);
  };
  const safely = async (id: string, project: () => Promise<void>): Promise<boolean> => {
    try { await project(); return true; }
    catch (error) { logger.warn('data ledger projection failed', { id, error: error instanceof Error ? error.message : String(error) }); return false; }
  };
  return {
    /** 包一层仓储：写入之后投影。 */
    resources: (repo: DataResourceRepository): DataResourceRepository => ({
      ...repo,
      insert: async (resource) => { await repo.insert(resource); await safely(resource.id, () => projectResource(resource)); },
      update: async (resource) => { await repo.update(resource); await safely(resource.id, () => projectResource(resource)); },
    }),
    bindings: (repo: TaskDataBindingRepository, resources: Pick<DataResourceRepository, 'find'>): TaskDataBindingRepository => ({
      ...repo,
      insert: async (binding) => { await repo.insert(binding); await safely(binding.id, () => projectBinding(binding, resources)); },
      update: async (binding) => { await repo.update(binding); await safely(binding.id, () => projectBinding(binding, resources)); },
    }),
    /**
     * 补投影：全部数据资源；还没结束的绑定；以及台账里还「要」、绑定却已结束或已不在的记录（释放那一步写失败的）。返回处理的条数。
     */
    resync: async (resources: DataResourceRepository, bindings: TaskDataBindingRepository): Promise<number> => {
      let synced = 0;
      for (const resource of await resources.listAll()) if (await safely(resource.id, () => projectResource(resource))) synced += 1;
      const open = await bindings.listOpen();
      for (const binding of open) if (await safely(binding.id, () => projectBinding(binding, resources))) synced += 1;
      const known = new Set(open.map((binding) => binding.id));
      for (const record of await ledger.presentBindings()) {
        if (known.has(record.id)) continue;
        const binding = await bindings.getById(record.id);
        if (await safely(record.id, () => (binding ? projectBinding(binding, resources) : ledger.requestRelease(record.id, GONE).then(() => undefined)))) synced += 1;
      }
      return synced;
    },
  };
}
