import type { BusinessTaskV3Dto, TaskId } from '@crewstation/contracts';
import type { ExecutionOperation } from '../../domain/taskAdmission';
import type { BusinessExecutionDeps } from './dependencies';

/** 查询只投影已存在的环境，不触发准入或状态机副作用。 */
export async function admissionTaskView(deps: BusinessExecutionDeps, operation: ExecutionOperation): Promise<BusinessTaskV3Dto> {
  const lifecycle = await deps.lifecycles.read(operation.serviceId, operation.intent.task.id);
  const task = { ...operation.intent.task, ...(lifecycle ? { generation: lifecycle.generation, state: lifecycle.state } : {}) };
  if (lifecycle?.state === 'closed' && !lifecycle.operationId) return { ...task, state: 'closed', resourceState: 'released', quotaHeld: false };
  let environment;
  try { environment = await deps.environments.getEnvironment(task.id as TaskId); }
  catch { return { ...task, resourceState: 'unknown', quotaHeld: null, message: 'resource_observation_unavailable' }; }
  if (!environment) {
    if (operation.state === 'failed') return { ...task, state: 'failed', resourceState: 'failed', message: operation.errorCode ?? 'admission_failed' };
    return operation.state === 'succeeded' ? { ...task, resourceState: 'unknown', quotaHeld: null, message: 'accepted_resource_missing' } : task;
  }
  const states = { creating: 'creating', running: 'running', paused: 'paused', releasing: 'closing', released: 'closed', failed: 'failed' } as const;
  const resourceStates = { creating: 'creating', running: 'ready', paused: 'released', releasing: 'releasing', released: 'released', failed: 'failed' } as const;
  return { ...task, ...(environment.image ? { image: environment.image } : {}), ...(environment.message ? { message: environment.message } : {}), volumeUid: environment.businessWorkspace?.volumeUid ?? task.volumeUid, state: lifecycle?.operationId ? lifecycle.state : environment.state === 'running' && environment.businessWorkspace?.phase === 'pausing' ? 'pausing' : states[environment.state], taskProfileId: environment.profile, resourceState: resourceStates[environment.state], quotaHeld: ['creating', 'running', 'releasing'].includes(environment.state) };
}
