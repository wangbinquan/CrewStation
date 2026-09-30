import type { Actor, ProjectId, ResourceTargetDescription, ResourceValues, TaskId, UserId } from '@crewstation/contracts';
import { RequestTaskDataBindingSchema, ResourceIdSchema } from '@crewstation/contracts';
import { conflict, forbidden, jsonHash, notFound, precondition } from '@crewstation/kernel';
import type { ProductionAccessTasks } from '../../ports/resource-center/productionTasks';
import { approve } from '../../domain/taskDataBinding';
import type { TaskDataBinding } from '../../domain/taskDataBinding';
import type { DataUseCaseDeps } from '../dependencies';
import { temporaryRoleUseCases } from '../temporaryRoles';

export function productionResourceAccess(deps: DataUseCaseDeps, tasks: ProductionAccessTasks | undefined, isAdmin: (id: UserId) => Promise<boolean>) {
  const loadTask = async (projectId: ProjectId, id: TaskId) => {
    if (!tasks) throw precondition('任务归属查询未就绪');
    const task = await tasks.get(id);
    if (!task || task.projectId !== projectId || task.kind !== 'dev-session') throw notFound('项目开发工作区');
    return task;
  };
  const inspect = async (actor: Actor, projectId: ProjectId, id: TaskId): Promise<ResourceTargetDescription> => {
    await deps.authorizer.authorize(actor, projectId, 'view');
    const task = await loadTask(projectId, id), bindings = await deps.bindings.listByTask(id);
    const now = deps.clock.now().getTime(), active = bindings.filter((b) => b.mode !== 'development' && b.state === 'active' && b.expiresAt && b.expiresAt.getTime() > now);
    const pending = bindings.some((b) => b.mode !== 'development' && (b.state === 'requested' || b.state === 'approved'));
    const running = task.state === 'running', production = await deps.resources.find(task.serviceId, 'production', 'postgres');
    return {
      target: { resourceType: 'production-data', resourceId: id, action: 'production-access' }, name: '工作区生产数据访问',
      revision: jsonHash({ task: { id, podUid: task.podUid, state: task.state }, productionId: production?.id ?? null, bindings: active.map((b) => ({ id: b.id, mode: b.mode, expiresAt: b.expiresAt!.toISOString() })) }),
      current: { mode: active.at(-1)?.mode ?? 'diagnostic-readonly', ttlMinutes: active.at(-1)?.ttlMinutes ?? 120 },
      fields: [{ key: 'mode', label: '访问模式', type: 'select', required: true, options: [{ value: 'diagnostic-readonly', label: '生产诊断只读' }, { value: 'production-change', label: '生产数据变更' }] }, { key: 'ttlMinutes', label: '有效时长', type: 'number', unit: '分钟', min: 5, max: 1440, integer: true, required: true }],
      impact: ['仅授权当前项目的这个开发工作区；凭据不在页面展示', '批准后创建有期限的生产数据库角色，生效和到期状态单独展示', '不创建、重建或终止工作区'],
      owned: active.length > 0, explicitlyRequestable: true, available: running && !!production && !pending,
      ...(!running ? { reason: '工作区须在运行中' } : !production ? { reason: '生产数据库尚未供给' } : pending ? { reason: '工作区已有生产访问申请，请先处理原申请' } : {}),
    };
  };
  const receipt = (binding: TaskDataBinding, ready: boolean) => ({ revision: jsonHash({ id: binding.id, state: binding.state, mode: binding.mode, expiresAt: binding.expiresAt?.toISOString() }), effect: `生产数据访问${ready ? '已生效' : '正在供给临时角色'}；到期 ${binding.expiresAt?.toISOString() ?? '未知'}`, applied: ready });
  const ready = async (binding: TaskDataBinding) => !deps.provisioning || (await deps.provisioning.ledger.get(binding.id))?.phase === 'ready';
  return {
    inspectProductionAccess: inspect,
    listProductionAccessTargets: async (actor: Actor, projectId: ProjectId) => { await deps.authorizer.authorize(actor, projectId, 'view'); return tasks ? Promise.all((await tasks.list(projectId)).map((id) => inspect(actor, projectId, id))) : []; },
    applyProductionAccess: async (actor: Actor, projectId: ProjectId, input: { operationId: string; taskId: TaskId; expectedRevision: string; values: ResourceValues; requestedBy: UserId; reason: string }) => {
      if (!await isAdmin(actor.userId)) throw forbidden('只有平台管理员可以授予生产数据访问');
      await deps.authorizer.authorize(actor, projectId, 'approve-data-access'); ResourceIdSchema.parse(input.operationId);
      if (Object.keys(input.values).some((key) => !['mode', 'ttlMinutes'].includes(key))) throw precondition('生产访问申请包含未知字段');
      const parsed = RequestTaskDataBindingSchema.parse(input.values);
      if (parsed.mode === 'development') throw precondition('开发数据访问不走生产授权');
      const task = await loadTask(projectId, input.taskId);
      let binding = await deps.bindings.getById(input.operationId);
      if (binding) {
        if (binding.projectId !== projectId || binding.taskId !== input.taskId || binding.mode !== parsed.mode || binding.ttlMinutes !== parsed.ttlMinutes || binding.requestedBy !== input.requestedBy) throw conflict('生产访问操作标识对应的内容已变化');
        if (binding.state === 'active') return receipt(binding, await ready(binding));
        if (binding.state !== 'approved') throw precondition('原生产访问已结束或被撤销，不能重复授予');
      } else {
        const view = await inspect(actor, projectId, input.taskId);
        if (!view.available) throw precondition(view.reason ?? '生产数据访问暂不可用');
        if (view.revision !== input.expectedRevision) throw conflict('工作区或生产数据绑定已变化');
        const now = deps.clock.now();
        binding = approve({ id: input.operationId, taskId: input.taskId, serviceId: task.serviceId, projectId, mode: parsed.mode, state: 'requested', reason: input.reason, requestedBy: input.requestedBy, ttlMinutes: parsed.ttlMinutes, createdAt: now, updatedAt: now }, actor.userId, now, '项目资源中心审批');
        await deps.bindings.insert(binding);
      }
      binding = await temporaryRoleUseCases(deps).grant(binding);
      await deps.bindings.update(binding);
      return receipt(binding, await ready(binding));
    },
    observeProductionAccess: async (projectId: ProjectId, operationId: string) => {
      const binding = await deps.bindings.getById(operationId);
      if (!binding || binding.projectId !== projectId) throw notFound('生产数据授权');
      if (binding.state !== 'active' || !binding.expiresAt || binding.expiresAt <= deps.clock.now()) throw precondition('生产数据授权已过期或撤销');
      return receipt(binding, await ready(binding));
    },
    productionAccessReceipt: async (projectId: ProjectId, operationId: string) => { const binding = await deps.bindings.getById(operationId); return binding?.projectId === projectId && binding.state === 'active' ? receipt(binding, await ready(binding)) : undefined; },
  };
}
