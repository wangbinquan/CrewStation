import { isPlatformError } from '@crewstation/kernel';
import { DevelopmentParentMaterialsSchema } from '../../../domain/development/parentMaterials';
import type { DevelopmentParentEndingJobLease } from '../../../ports/developmentParentEndingScope';
import type { TaskRuntimeUseCaseDeps } from '../../dependencies';
import { advanceDevelopmentParentChildren } from './children';
import { completeDevelopmentParent } from './complete';
import { advanceDevelopmentParent, withDevelopmentParent } from './current';
import { acknowledgeDevelopmentParentObservation, prepareDevelopmentParentObservation, proveDevelopmentParentObservation } from './observation';

/** Normal waiting completes its queue delivery. Durable recovery requeues the original ending with a new real lease. */
export async function runDevelopmentParentEnding(deps: TaskRuntimeUseCaseDeps, id: string, identity: DevelopmentParentEndingJobLease): Promise<void> {
  try {
    for (let step = 0; step < 6; step++) {
      const ending = await deps.uow.read.parentEnding?.endings.get(id);
      if (!ending || ending.phase === 'complete') return;
      if (ending.phase === 'admission-sealed') {
        await withDevelopmentParent(deps, id, identity, async (scope, environment, current) => {
          if (current.phase !== 'admission-sealed') return;
          const now = deps.clock.now();
          await advanceDevelopmentParent(scope, environment, current, { ...current, phase: 'children', status: 'pending', retryAt: now,
            message: '原父新准入已封存，正在排空完整固定成员' }, now);
        });
      } else if (ending.phase === 'children') {
        if (!await advanceDevelopmentParentChildren(deps, id, identity)) return;
        await prepareDevelopmentParentObservation(deps, id, identity);
      } else if (ending.phase === 'prepared') await acknowledgeDevelopmentParentObservation(deps, id, identity);
      else if (ending.phase === 'stop-intent') await proveDevelopmentParentObservation(deps, id, identity);
      else if (ending.phase === 'proved') { await completeDevelopmentParent(deps, id, identity, DevelopmentParentMaterialsSchema.parse(ending.progress['materials'])); return; }
    }
  } catch (error) {
    if (isPlatformError(error) && error.details?.['code'] === 'development_parent_job_lease_lost') throw error;
    await withDevelopmentParent(deps, id, identity, async (scope, environment, ending) => {
      if (ending.phase === 'complete') return;
      const now = deps.clock.now();
      await advanceDevelopmentParent(scope, environment, ending, { ...ending, status: 'blocked', retryAt: new Date(now.getTime() + 2_000),
        message: isPlatformError(error) ? error.message : '原父退出来源暂不可用，保留原实例并等待重试' }, now);
    });
  }
}
