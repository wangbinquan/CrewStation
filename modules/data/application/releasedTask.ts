import type { TaskId } from '@crewstation/contracts';
import type { TaskDataBinding } from '../domain/taskDataBinding';
import type { DataUseCaseDeps } from './dependencies';
import { temporaryRoleUseCases } from './temporaryRoles';

/** 还没结束的绑定：申请中、已批准待生效、生效中。 */
const OPEN_STATES: ReadonlyArray<TaskDataBinding['state']> = ['requested', 'approved', 'active'];

/**
 * 任务（开发会话）释放时，收回它名下还没结束的数据绑定：删掉临时角色，记为已收回。
 * 2026-09-23 作者裁定：释放本身已有弹窗确认，直接收回，不等到期；容器已不在，凭据也用不上了。
 * 由「任务已释放」事件驱动，覆盖用户释放、负责人强制释放、失败会话回收与集群管理删除；至少一次投递，重复处理无副作用。
 */
export function revokeBindingsOfReleasedTask(deps: DataUseCaseDeps) {
  const roles = temporaryRoleUseCases(deps);
  return async (taskId: TaskId): Promise<number> => {
    let revoked = 0;
    for (const binding of await deps.bindings.listByTask(taskId)) {
      if (!OPEN_STATES.includes(binding.state)) continue;
      // 删角色失败就抛出，由事件消费者原地重试；角色删掉之前不记为已收回。
      await roles.drop(binding);
      await deps.bindings.update({ ...binding, state: 'revoked', updatedAt: deps.clock.now() });
      revoked += 1;
    }
    return revoked;
  };
}
