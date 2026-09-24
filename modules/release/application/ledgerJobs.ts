import type { Manifest } from '@crewstation/contracts';
import type { Release } from '../domain/release';
import type { JobPurpose, JobRender } from '../domain/releaseJobs';
import { BUILD_RESOURCES, JOB_TTL_SECONDS, MIGRATION_RESOURCES, buildScript, jobOutcomeOf, releaseJobName } from '../domain/releaseJobs';
import type { ReleaseUseCaseDeps } from './dependencies';
import type { PipelineContext, ResolvedService, StepResult } from './pipelineContext';
import { WAIT } from './pipelineContext';

/** Job 自己的截止时间之外再留的余量：Job 一直没建出来（调和器停着）时流水线也会结束。 */
const GRACE_SECONDS = 300;
const KIND = { build: 'build-job', migration: 'migration-job' } as const;
const WORDS = { build: { failed: '构建失败', timeout: '构建超时' }, migration: { failed: '迁移失败，未切流', timeout: '迁移超时，未切流' } } as const;

export interface LedgerJobSteps {
  /** 这个装配里 Job 由资源中心建：开关打开，且拿得到仓库地址与构建令牌。 */
  readonly enabled: boolean;
  startBuild(release: Release, svc: ResolvedService): Promise<StepResult>;
  startMigration(release: Release, svc: ResolvedService, manifest: Manifest, configVersion: number): Promise<StepResult>;
  /** 照 Job 记录判结果：成功交给 next，失败与超时判发布失败（并给记录报 Failed，调和器随即删凭据），其余接着等。 */
  poll(release: Release, svc: ResolvedService, purpose: JobPurpose, next: () => Promise<StepResult>): Promise<StepResult>;
}

/**
 * 资源中心建的构建、迁移 Job（RFC-025 T8）：流水线只写期望——镜像、命令、不含凭据的明文变量、资源与时限、这一次的凭据 Secret 名，
 * 凭据在调和器建 Secret 时向本模块要（构建的 Git 令牌、迁移的槽环境）。先把发布推进到这一步再写期望，调和器要凭据时发布已在这一步。
 */
export function ledgerJobSteps(deps: ReleaseUseCaseDeps, ctx: PipelineContext): LedgerJobSteps {
  const { settings, clock } = deps;
  const renderOf = async (release: Release, purpose: JobPurpose): Promise<JobRender> => {
    const envSecret = `${releaseJobName(release, purpose)}-env`, base = { releaseId: release.id, purpose, activeDeadlineSeconds: settings.buildTimeoutSeconds, ttlSecondsAfterFinished: JOB_TTL_SECONDS, envSecret };
    if (purpose === 'migration') return { ...base, image: release.image ?? '', command: release.manifest?.spec.release.migrationCommand ?? [], env: {}, resources: { ...MIGRATION_RESOURCES } };
    const { httpUrl } = await deps.repo.buildSource!(release.serviceId);
    return { ...base, image: settings.builderImage, command: ['sh', '-c', buildScript(settings.buildkitAddress)], env: { REPO_URL: httpUrl, REF: release.tag, IMAGE: release.image ?? '' }, resources: { ...BUILD_RESOURCES } };
  };
  const declare = async (release: Release, svc: ResolvedService, purpose: JobPurpose): Promise<void> => {
    const job = await renderOf(release, purpose);
    await deps.uow.run(async (scope) => { await scope.ledger?.job({ kind: KIND[purpose], releaseId: release.id, tag: release.tag, projectId: release.projectId, namespace: svc.namespace, jobName: releaseJobName(release, purpose), job: { ...job, command: [...job.command] } }); });
  };
  const giveUp = async (release: Release, purpose: JobPurpose, message: string): Promise<StepResult> => {
    await deps.uow.read.ledger?.failJob(release.id, KIND[purpose], message);
    return ctx.fail(release, message);
  };
  return {
    enabled: deps.creation === 'ledger' && !!deps.repo.buildSource && !!deps.repo.buildToken,
    startBuild: async (release, svc) => {
      const image = `${settings.registryBase}/${svc.slug}:${release.tag}`, now = clock.now().toISOString();
      const saved = await ctx.save(release, 'building', { image, pipeline: { ...release.pipeline, buildRef: releaseJobName(release, 'build'), jobs: 'ledger', buildStartedAt: now } });
      await declare(saved, svc, 'build');
      return WAIT;
    },
    startMigration: async (release, svc, manifest, configVersion) => {
      const saved = await ctx.save(release, 'migrating', { manifest, configVersion, pipeline: { ...release.pipeline, migrationRef: releaseJobName(release, 'migration'), jobs: 'ledger', migrationStartedAt: clock.now().toISOString() } });
      await declare(saved, svc, 'migration');
      return WAIT;
    },
    poll: async (release, svc, purpose, next) => {
      const record = await deps.uow.read.ledger?.jobRecord(release.id, KIND[purpose]);
      // 期望没写进台账（那一次投影失败只告警）：再写一次，下一轮接着判。
      if (!record?.spec.job) await declare(release, svc, purpose);
      const outcome = jobOutcomeOf(record?.spec.job ? record : undefined);
      if (outcome.state === 'succeeded') return next();
      if (outcome.state === 'failed') return giveUp(release, purpose, `${WORDS[purpose].failed}：${outcome.message}`);
      const started = purpose === 'build' ? release.pipeline.buildStartedAt : release.pipeline.migrationStartedAt;
      if (started && clock.now().getTime() - Date.parse(started) > (settings.buildTimeoutSeconds + GRACE_SECONDS) * 1000) return giveUp(release, purpose, WORDS[purpose].timeout);
      await ctx.bump(release);
      return WAIT;
    },
  };
}
