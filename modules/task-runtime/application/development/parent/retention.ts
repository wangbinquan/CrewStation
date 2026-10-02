import { TaskIdSchema } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import type { ResourceEndingDecision, ResourceEndingSnapshot, ResourceEndingStep } from '../../../api/resourceEnding';
import { terminalDevelopmentMaintenanceOriginal } from '../../../domain/development/removalEvidence';
import { projectEnvironment } from '../../../domain/ledgerProjection';
import { PROFILE_TEST_PROJECT_ID, PROFILE_TEST_SERVICE_ID } from '../../../domain/profileTestEnvironment';
import type { TaskEnvironment, WorkloadRender } from '../../../domain/taskEnvironment';
import type { TaskRuntimeUseCaseDeps } from '../../dependencies';
import { developmentPhysicalStop } from '../workloadStop';

type Preview = (env: TaskEnvironment) => Promise<WorkloadRender['previewRoute']>;
type OwnerDeps = Pick<TaskRuntimeUseCaseDeps, 'uow' | 'workloadSafety'>;
const waiting = (): ResourceEndingDecision => ({ status: 'waiting', reason: 'original-development-ending-pending' });
function selected(env: TaskEnvironment): boolean {
  return Object.hasOwn(env, 'parentEnding') || !!env.native && Object.hasOwn(env.native, 'developmentCleanup')
    || !!env.render && (['developmentUsageProtection', 'developmentRemovalProtection', 'runtimeValidation'].some((key) => Object.hasOwn(env.render!, key))
      || !!env.render.rebuild && Object.hasOwn(env.render.rebuild, 'developmentParentSelection'));
}
function materialHash(env: TaskEnvironment): string {
  const render = env.render && (({ runtimeConnectionDeadline: _connection, runtimeInitializationDeadline: _initialization, ...material }) => material)(env.render);
  return jsonHash({ ...env, render });
}
function belongs(snapshot: ResourceEndingSnapshot, env: TaskEnvironment): boolean {
  if (env.kind !== 'profile-test') return snapshot.projectId !== null && env.projectId === snapshot.projectId;
  if (env.projectId !== PROFILE_TEST_PROJECT_ID || env.serviceId !== PROFILE_TEST_SERVICE_ID) return false;
  const validation = !!env.render && Object.hasOwn(env.render, 'runtimeValidation');
  return snapshot.projectId === null ? !validation : validation;
}
async function capture(deps: OwnerDeps, snapshot: ResourceEndingSnapshot, preview?: Preview) {
  if (snapshot.owner.module !== 'task-runtime') return undefined;
  const taskId = TaskIdSchema.parse(snapshot.owner.ref.split('/')[0]);
  const source = await deps.uow.read.environments.getMaintenanceView?.(taskId);
  if (source?.status !== 'present' || !belongs(snapshot, source.environment)) return undefined;
  const original = source.environment, hash = materialHash(original);
  // The formal preview resolver may query a Service; it runs before acquiring any Task project lock.
  const projection = projectEnvironment(original, await preview?.(original) ?? original.render?.previewRoute);
  return deps.uow.run(async (scope) => {
    await scope.admissions.lock(original.projectId);
    const view = await scope.environments.getMaintenanceView?.(taskId);
    if (view?.status !== 'present' || !belongs(snapshot, view.environment) || materialHash(view.environment) !== hash) return undefined;
    const env = view.environment, record = [projection.workload, projection.volume, projection.route]
      .find((row) => row?.kind === snapshot.kind && row.ref === snapshot.owner.ref && (row.projectId ?? null) === snapshot.projectId);
    if (!record || record.id && record.id !== snapshot.id
      || jsonHash({ children: record.children, ...(record.reclaim ? { reclaim: record.reclaim } : {}), ...record.render }) !== snapshot.specHash) return undefined;
    const isSelected = selected(env);
    if (!isSelected && (!scope.environments.hasProtectedDevelopmentChildren
      || await scope.environments.hasProtectedDevelopmentChildren(env.id))) return undefined;
    return { env, selected: isSelected, hash };
  });
}
/** First owner integration: complete original Agent compaction; parent ending/retention is still pending. */
export function resourceEndingHandler(deps: OwnerDeps, preview?: Preview) {
  return async (step: ResourceEndingStep, snapshot: ResourceEndingSnapshot): Promise<ResourceEndingDecision> => {
    try {
      const before = await capture(deps, snapshot, preview);
      if (!before) return waiting();
      if (!before.selected) return { status: 'unselected' };
      if (step !== 'compaction' || snapshot.kind !== 'agent-execution' || Object.hasOwn(before.env, 'parentEnding')) return waiting();
      const original = terminalDevelopmentMaintenanceOriginal(before.env);
      // Resources proof reads happen only after releasing the Task project transaction.
      await developmentPhysicalStop(deps.workloadSafety, original);
      const after = await capture(deps, snapshot, preview);
      return after?.selected && after.hash === before.hash ? { status: 'permitted', snapshot } : waiting();
    } catch { return waiting(); }
  };
}
