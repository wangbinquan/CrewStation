import type { Actor, DecideTaskDataBinding, ProjectId, RequestTaskDataBinding, ServiceId, TaskDataBindingDto, TaskId } from '@crewstation/contracts';
import { newId, notFound, precondition } from '@crewstation/kernel';
import type { TaskDataBinding } from '../domain/taskDataBinding';
import { approve, isUsable, reject, requiresApproval } from '../domain/taskDataBinding';
import { awaitProvisioned, dataControlDsn } from './dataControl';
import type { DataUseCaseDeps } from './dependencies';
import { serviceDataUseCases } from './serviceData';
import { temporaryRoleUseCases } from './temporaryRoles';

const ENV_BY_MODE = { development: 'CS_DATABASE_URL', 'diagnostic-readonly': 'CS_PROD_READONLY_DATABASE_URL', 'production-change': 'CS_PROD_DATABASE_URL' } as const;

/** 三种模式：development 默认直接生效；诊断只读与生产变更由负责人批准，批准后建带到期时间的临时角色（G14 接受容器内共享的风险）。 */
import { withRequesterNames } from './requesterNames';

export function taskBindingUseCases(deps: DataUseCaseDeps) {
  const { bindings, authorizer, services, cipher, clock } = deps;
  const data = serviceDataUseCases(deps);
  const roles = temporaryRoleUseCases(deps);

  /** 没存连接串的绑定（RFC-025 I28）：开发模式照开发库现取；临时角色经端口向 data-control 要口令，用生产库名拼。 */
  const liveDsn = async (binding: TaskDataBinding): Promise<string | undefined> => {
    if (binding.mode === 'development') return (await data.envFor(binding.serviceId as ServiceId, 'development')).CS_DATABASE_URL;
    const prod = await data.productionDatabase(binding.serviceId as ServiceId);
    return prod ? dataControlDsn(deps, binding.id, prod.databaseName) : undefined;
  };

  const load = async (id: string): Promise<TaskDataBinding> => {
    const binding = await bindings.getById(id);
    if (!binding) throw notFound('数据访问绑定', id);
    return binding;
  };

  return {
    requestTaskBinding: async (actor: Actor, ids: { taskId: TaskId; serviceId: ServiceId }, input: RequestTaskDataBinding): Promise<TaskDataBindingDto> => {
      const svc = await services.resolveServiceById(ids.serviceId);
      if (!svc) throw notFound('服务', ids.serviceId);
      await authorizer.authorize(actor, svc.projectId, 'develop');
      const now = clock.now();
      let binding: TaskDataBinding = { id: newId('tdb'), taskId: ids.taskId, serviceId: ids.serviceId, projectId: svc.projectId, mode: input.mode, state: 'requested', ...(input.reason ? { reason: input.reason } : {}), requestedBy: actor.userId, ttlMinutes: input.ttlMinutes, createdAt: now, updatedAt: now };
      if (!requiresApproval(input.mode)) {
        const dsn = (await data.envFor(ids.serviceId, 'development')).CS_DATABASE_URL;
        if (!dsn) throw precondition('开发库尚未供给');
        // 开发库由 data-control 建时（RFC-025 I28）不再存一份连接串副本：渲染时照开发库现取。
        binding = { ...binding, state: 'active', decidedBy: actor.userId, roleName: 'development', ...(deps.provisioning ? {} : { secretBox: await cipher.encrypt(dsn) }) };
      }
      await bindings.insert(binding);
      return toBindingDto(binding);
    },
    decideTaskBinding: async (actor: Actor, bindingId: string, input: DecideTaskDataBinding): Promise<TaskDataBindingDto> => {
      let binding = await load(bindingId);
      await authorizer.authorize(actor, binding.projectId as ProjectId, 'approve-data-access');
      const now = clock.now();
      binding = input.approve ? await roles.grant(approve(binding, actor.userId, now, input.decision)) : reject(binding, actor.userId, now, input.decision);
      await bindings.update(binding);
      // 临时角色由 data-control 建（I28 第二步）：投影已把期望写进台账，等它建好再答复；过了时限照样答复（调和器会接着建）。
      if (deps.provisioning && binding.state === 'active' && binding.roleName !== 'development' && !(await awaitProvisioned(deps, binding.id)).ready) {
        deps.logger.warn('data binding role not ready in time', { bindingId: binding.id });
      }
      return toBindingDto(binding);
    },
    revokeTaskBinding: async (actor: Actor, bindingId: string): Promise<TaskDataBindingDto> => {
      const binding = await load(bindingId);
      await authorizer.authorize(actor, binding.projectId as ProjectId, 'approve-data-access');
      await roles.drop(binding);
      const revoked: TaskDataBinding = { ...binding, state: 'revoked', updatedAt: clock.now() };
      await bindings.update(revoked);
      return toBindingDto(revoked);
    },
    listTaskBindings: async (actor: Actor, taskId: TaskId): Promise<TaskDataBindingDto[]> => {
      const list = await bindings.listByTask(taskId);
      if (list[0]) await authorizer.authorize(actor, list[0].projectId as ProjectId, 'view');
      return withRequesterNames(deps.users, list.map(toBindingDto));
    },
    listProjectBindings: async (actor: Actor, projectId: ProjectId, states?: TaskDataBinding['state'][]): Promise<TaskDataBindingDto[]> => {
      await authorizer.authorize(actor, projectId, 'view');
      return withRequesterNames(deps.users, (await bindings.listByProject(projectId, states)).map(toBindingDto));
    },
    /** 任务容器启动或续期时读取：只含仍有效的绑定。 */
    envForTask: async (taskId: TaskId): Promise<Record<string, string>> => {
      const now = clock.now();
      const values: Record<string, string> = {};
      for (const b of await bindings.listByTask(taskId)) {
        if (!isUsable(b, now)) continue;
        const dsn = b.secretBox ? await cipher.decrypt(b.secretBox) : await liveDsn(b);
        if (dsn) values[ENV_BY_MODE[b.mode]] = dsn;
      }
      return values;
    },
    expireBindings: async (): Promise<number> => {
      const now = clock.now();
      let n = 0;
      for (const b of await bindings.listExpired(now)) {
        await roles.drop(b).catch(() => undefined);
        await bindings.update({ ...b, state: 'expired', updatedAt: now });
        n += 1;
      }
      return n;
    },
  };
}

export function toBindingDto(b: TaskDataBinding): TaskDataBindingDto {
  return {
    id: b.id, taskId: b.taskId, mode: b.mode, state: b.state, ttlMinutes: b.ttlMinutes, ...(b.reason ? { reason: b.reason } : {}), ...(b.decision ? { decision: b.decision } : {}),
    requestedBy: b.requestedBy, ...(b.decidedBy ? { decidedBy: b.decidedBy } : {}), ...(b.expiresAt ? { expiresAt: b.expiresAt.toISOString() } : {}), createdAt: b.createdAt.toISOString(),
  };
}
