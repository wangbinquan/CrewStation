import { precondition } from '@crewstation/kernel';
import type { BusinessExecutionApi, BusinessExecutionCaller } from '../../api/executionApi';
import { controlDto } from '../../domain/executionControl';
import type { ControlSnapshot } from '../../ports/executionControl';
import type { BusinessExecutionDeps } from './dependencies';
import { executionSource } from './source';

export function executionControlUseCases(deps: BusinessExecutionDeps): Pick<BusinessExecutionApi, 'control' | 'claim' | 'renew' | 'release' | 'activate' | 'handoffReady' | 'migrationReady'> {
  const source = executionSource(deps);
  const fenced = async (caller: BusinessExecutionCaller) => {
    const context = await source(caller);
    if (context.registration.tasksSpec?.executionControl !== 'fenced') throw precondition('此发布未声明 fenced 执行控制');
    return context;
  };
  const dto = (value: ControlSnapshot) => controlDto(value.control, value.now);
  return {
    migrationReady: async (caller, input) => { const context = await fenced(caller); return dto(await deps.controls.migrationReady(context.serviceId, context.authority, input)); },
    control: async (caller) => dto(await deps.controls.read((await source(caller)).serviceId)),
    claim: async (caller, input) => { const context = await fenced(caller); return dto(await deps.controls.claim(context.serviceId, context.authority, input)); },
    renew: async (caller, input) => { const context = await fenced(caller); return dto(await deps.controls.renew(context.serviceId, context.authority, input)); },
    release: async (caller, input) => { const context = await fenced(caller); return dto(await deps.controls.release(context.serviceId, context.authority, input)); },
    activate: async (caller, input) => { const context = await fenced(caller); return dto(await deps.controls.activate(context.serviceId, context.authority, input)); },
    handoffReady: async (caller, input) => {
      const context = await fenced(caller);
      if (input.acceptedTaskContractVersions.some((version) => !context.registration.tasksSpec!.acceptedTaskContractVersions?.includes(version))) throw precondition('准备回执超出发布声明的任务版本', { code: 'task_contract_unsupported' });
      return dto(await deps.controls.handoffReady(context.serviceId, context.authority, input));
    },
  };
}
