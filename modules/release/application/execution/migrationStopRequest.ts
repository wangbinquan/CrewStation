import type { Release } from '../../domain/release';
import { JOB_TTL_SECONDS, MIGRATION_RESOURCES, releaseJobName } from '../../domain/releaseJobs';
import type { ReleaseUseCaseDeps } from '../dependencies';

/** Failed releases may crash before declaring their migration Job. Declare its stop intent atomically. */
export async function requestMigrationStop(deps: Pick<ReleaseUseCaseDeps, 'uow' | 'services'>, prior: Release): Promise<void> {
  const service = await deps.services.resolveServiceById(prior.serviceId);
  if (!service || !prior.image || !prior.manifest?.spec.release.migrationCommand?.length) return;
  await deps.uow.run(async (scope) => {
    if (!scope.ledger || (await scope.releases.getById(prior.id))?.status !== 'failed') return;
    const record = await scope.ledger.jobRecord(prior.id, 'migration-job');
    if (!record?.spec.job) {
      const name = releaseJobName(prior, 'migration');
      await scope.ledger.job({ kind: 'migration-job', releaseId: prior.id, tag: prior.tag, projectId: prior.projectId, namespace: service.namespace, jobName: name,
        job: { releaseId: prior.id, purpose: 'migration', image: prior.image!, command: prior.manifest!.spec.release.migrationCommand!, env: {}, envSecret: `${name}-env`,
          resources: { ...MIGRATION_RESOURCES }, activeDeadlineSeconds: 1800, ttlSecondsAfterFinished: JOB_TTL_SECONDS } });
    }
    await scope.ledger.failJob(prior.id, 'migration-job', '失败迁移保持停写，等待 Job 暂停及实际 Pod 清理');
  });
}
