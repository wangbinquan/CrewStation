import type { ProjectId, ServiceId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { TaskDataBinding } from '../domain/taskDataBinding';
import { activate } from '../domain/taskDataBinding';
import type { DataUseCaseDeps } from './dependencies';
import { serviceDataUseCases } from './serviceData';

/** 批准后的临时数据库角色：只读走 pg_read_all_data，可写继承运行角色；到期由数据库执行，撤权时先转移对象再删除。 */
export function temporaryRoleUseCases(deps: DataUseCaseDeps) {
  const data = serviceDataUseCases(deps);
  return {
    grant: async (binding: TaskDataBinding): Promise<TaskDataBinding> => {
      await deps.generations?.store.assertUnreserved(binding.serviceId as ServiceId);
      const prod = await data.productionDatabase(binding.serviceId as ServiceId);
      if (!prod) throw precondition('生产库尚未供给，不能授予访问');
      if (binding.databaseName && binding.databaseName !== prod.databaseName) throw precondition('生产数据库世代已变化，原申请不能重新授予');
      binding = { ...binding, databaseName: prod.databaseName };
      const roleName = binding.roleName ?? (binding.legacyResourceId ? `${prod.roleName}_t_${binding.legacyResourceId.slice(-8)}` : `cs_t_${binding.id.replaceAll('-', '')}`);
      // 由 data-control 建（RFC-025 I28 第二步）：这里只记下角色名、置为生效，投影把期望（到期、只读与否、所在的库）写进台账。
      if (deps.provisioning) return activate(binding, roleName, undefined, deps.clock.now());
      const { dsn } = await deps.postgres.createTemporaryRole({ databaseName: prod.databaseName, roleName, ownerRole: prod.roleName, readOnly: binding.mode === 'diagnostic-readonly', validUntil: binding.expiresAt ?? deps.clock.now(), origin: { projectId: binding.projectId as ProjectId, resourceId: binding.id } });
      return activate(binding, roleName, await deps.cipher.encrypt(dsn), deps.clock.now());
    },
    drop: async (binding: TaskDataBinding): Promise<void> => {
      if (!binding.roleName || binding.roleName === 'development') return;
      const prod = binding.databaseName ? { databaseName: binding.databaseName, roleName: binding.databaseName } : await data.productionDatabase(binding.serviceId as ServiceId);
      await deps.postgres.dropRole({ roleName: binding.roleName, origin: { projectId: binding.projectId as ProjectId, resourceId: binding.id }, ...(prod ? { databaseName: prod.databaseName, reassignTo: prod.roleName } : {}) });
    },
  };
}
