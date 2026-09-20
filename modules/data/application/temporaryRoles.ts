import type { ServiceId } from '@crewstation/contracts';
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
      const prod = await data.productionDatabase(binding.serviceId as ServiceId);
      if (!prod) throw precondition('生产库尚未供给，不能授予访问');
      const roleName = binding.roleName ?? (binding.legacyResourceId ? `${prod.roleName}_t_${binding.legacyResourceId.slice(-8)}` : `cs_t_${binding.id.replaceAll('-', '')}`);
      const { dsn } = await deps.postgres.createTemporaryRole({ databaseName: prod.databaseName, roleName, ownerRole: prod.roleName, readOnly: binding.mode === 'diagnostic-readonly', validUntil: binding.expiresAt ?? deps.clock.now() });
      return activate(binding, roleName, await deps.cipher.encrypt(dsn), deps.clock.now());
    },
    drop: async (binding: TaskDataBinding): Promise<void> => {
      if (!binding.roleName || binding.roleName === 'development') return;
      const prod = await data.productionDatabase(binding.serviceId as ServiceId);
      await deps.postgres.dropRole({ roleName: binding.roleName, ...(prod ? { databaseName: prod.databaseName, reassignTo: prod.roleName } : {}) });
    },
  };
}
