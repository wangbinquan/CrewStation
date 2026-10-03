import { TaskIdSchema } from '@crewstation/contracts';
import { sealedDevelopmentParentProjection } from '../../../domain/development/parentProjection';
import { readDevelopmentParentEnding } from '../../../domain/development/parentEnding';
import { systemClock } from '@crewstation/kernel';
import { completedDevelopmentParent, observeCompletedDevelopmentParent } from './completed';
import { wakeDevelopmentParentEnding } from './admission';
import { admitDevelopmentParentEnding, prepareDevelopmentParentEnding, selectedDevelopmentParent } from './request';
import { jsonHash } from '@crewstation/kernel';
import type { ResourceEndingDecision, ResourceEndingSnapshot, ResourceEndingStep } from '../../../api/resourceEnding';
import { terminalDevelopmentMaintenanceOriginal } from '../../../domain/development/removalEvidence';
import { projectEnvironment } from '../../../domain/ledgerProjection';
import { PROFILE_TEST_PROJECT_ID, PROFILE_TEST_SERVICE_ID } from '../../../domain/profileTestEnvironment';
import type { TaskEnvironment, WorkloadRender } from '../../../domain/taskEnvironment';
import type { TaskRuntimeUseCaseDeps } from '../../dependencies';
import { developmentPhysicalStop } from '../workloadStop';

type Preview = (env: TaskEnvironment) => Promise<WorkloadRender['previewRoute']>;
type OwnerDeps = Pick<TaskRuntimeUseCaseDeps, 'uow' | 'workloadSafety'> & Partial<Pick<TaskRuntimeUseCaseDeps, 'clock' | 'developmentParentInspector' | 'developmentParentPhysical'>>;
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
  const pointer = readDevelopmentParentEnding(original), ending = pointer ? await deps.uow.read.parentEnding?.endings.get(pointer.endingId) : undefined;
  const plain = projectEnvironment(original, pointer ? original.render?.previewRoute : await preview?.(original) ?? original.render?.previewRoute);
  const projection = ending ? sealedDevelopmentParentProjection(plain, original, ending) : plain;
  if (pointer && !ending) return undefined;
  return deps.uow.run(async (scope) => {
    await scope.admissions.lock(original.projectId);
    const view = await scope.environments.getMaintenanceView?.(taskId);
    if (view?.status !== 'present' || !belongs(snapshot, view.environment) || materialHash(view.environment) !== hash) return undefined;
    const env = view.environment, record = [projection.workload, projection.volume, projection.route]
      .find((row) => row?.kind === snapshot.kind && row.ref === snapshot.owner.ref && (row.projectId ?? null) === snapshot.projectId);
    if (!record || record.id && record.id !== snapshot.id
      || jsonHash({ children: record.children, ...(record.reclaim ? { reclaim: record.reclaim } : {}), ...record.render }) !== snapshot.specHash) return undefined;
    const isSelected = selected(env) || await selectedDevelopmentParent(scope, env);
    if (!isSelected && !scope.environments.hasProtectedDevelopmentChildren) return undefined;
    return { env, selected: isSelected, hash };
  });
}
async function parentDecision(deps: OwnerDeps, step: ResourceEndingStep, before: NonNullable<Awaited<ReturnType<typeof capture>>>, snapshot: ResourceEndingSnapshot, preview?: Preview) {
  const pointer = readDevelopmentParentEnding(before.env);
  if (pointer?.phase === 'complete') {
    const ending = await deps.uow.read.parentEnding?.endings.get(pointer.endingId);
    if (!ending) return waiting();
    const source = await completedDevelopmentParent(deps.uow.read, before.env, ending);
    await observeCompletedDevelopmentParent(deps, source);
    // Compaction must retain the sealed spec until the original failed Task has its verified retirement receipt.
    if (step === 'compaction' && source.witness.outcome === 'compensation'
      && (before.env.state !== 'released' || !Object.hasOwn(ending.progress, 'retentionTransition'))) return waiting();
    const after = await capture(deps, snapshot, preview);
    return after?.selected && after.hash === before.hash ? { status: 'permitted' as const, snapshot } : waiting();
  }
  const prepared = await prepareDevelopmentParentEnding(deps, before.env);
  if (!prepared) return waiting();
  await deps.uow.run(async (scope) => {
    await scope.admissions.lock(before.env.projectId);
    const current = await scope.environments.getForUpdate(before.env.id);
    if (!current || materialHash(current) !== before.hash) return;
    if (await wakeDevelopmentParentEnding(scope, current)) return;
    await admitDevelopmentParentEnding(scope, prepared, 'retention', { resourceId: snapshot.id, kind: snapshot.kind,
      generation: snapshot.generation, specHash: snapshot.specHash, retainUntil: snapshot.retainUntil }, (deps.clock ?? systemClock).now());
  });
  return waiting();
}
/** Original parent retention is queued before any Resources CAS; only actual completed numeric/physical sources permit retirement. */
export function resourceEndingHandler(deps: OwnerDeps, preview?: Preview) {
  return async (step: ResourceEndingStep, snapshot: ResourceEndingSnapshot): Promise<ResourceEndingDecision> => {
    try {
      const before = await capture(deps, snapshot, preview);
      if (!before) return waiting();
      if (!before.selected) return { status: 'unselected' };
      if (before.env.kind === 'dev-session' && !before.env.native) return await parentDecision(deps, step, before, snapshot, preview);
      if (step !== 'compaction' || snapshot.kind !== 'agent-execution' || Object.hasOwn(before.env, 'parentEnding')) return waiting();
      const original = terminalDevelopmentMaintenanceOriginal(before.env);
      // Resources proof reads happen only after releasing the Task project transaction.
      await developmentPhysicalStop(deps.workloadSafety, original);
      const after = await capture(deps, snapshot, preview);
      return after?.selected && after.hash === before.hash ? { status: 'permitted', snapshot } : waiting();
    } catch { return waiting(); }
  };
}
