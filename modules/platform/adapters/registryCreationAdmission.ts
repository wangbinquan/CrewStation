import { NATIVE_REGISTRY_ADMISSION, ResourceIdSchema, RuntimeImageBuildRenderSchema } from '@crewstation/contracts';
import type { ProjectId } from '@crewstation/contracts';
import { nativeRegistryWriterAdmission } from '@crewstation/filesystem-metrics';
import { precondition } from '@crewstation/kernel';
import { withSharedDatabaseAdmissions, assertSharedDatabaseAdmissionActive } from '@crewstation/persistence';
import type { Database } from '@crewstation/persistence';
import { z } from 'zod';

interface CreationRecord { id: string; kind: string; projectId?: string; owner?: { module: string; ref: string }; spec: Readonly<Record<string, unknown>> }
const releaseRef = z.object({ releaseId: ResourceIdSchema, serviceId: ResourceIdSchema.optional(), purpose: z.enum(['build', 'migration']).optional(), physical: z.enum(['blue', 'green']).optional() });
/** The actual owner records its callback through Secret and Job/Deployment
 * apply. Both owner and resource locks use one original PostgreSQL backend. */
export function registryCreationAdmission(input: { db: Database; registry?: Parameters<typeof nativeRegistryWriterAdmission>[0];
  resources: { withAdmission(id: ProjectId, work: () => Promise<void>): Promise<boolean> };
  images: { withBuildCreationAdmission<T>(ref: { recordId: string; buildId: string; executionEpoch: number }, work: () => Promise<T>): Promise<T> };
  release: { withResourceCreationAdmission<T>(ref: { recordId: string; releaseId: string; kind: 'slot' | 'pipeline'; serviceId?: string }, work: () => Promise<T>): Promise<T> };
}) {
  const native = input.registry ? nativeRegistryWriterAdmission(input.registry) : undefined;
  return async (projectId: string | undefined, work: () => Promise<void>, record?: CreationRecord): Promise<boolean> => {
    const protectedApply = () => withSharedDatabaseAdmissions(input.db, [NATIVE_REGISTRY_ADMISSION, ...(projectId ? ['resources.project-admission:' + projectId] : [])], async () => {
      await native?.assertAvailable(); assertSharedDatabaseAdmissionActive(input.db, NATIVE_REGISTRY_ADMISSION);
      const result = projectId ? await input.resources.withAdmission(projectId as ProjectId, work) : (await work(), true);
      assertSharedDatabaseAdmissionActive(input.db, NATIVE_REGISTRY_ADMISSION); return result;
    });
    if (record && (record.projectId !== projectId || !ResourceIdSchema.safeParse(record.id).success)) throw precondition('原集群创建记录的项目身份变化');
    if (record?.spec['runtimeImageBuild'] !== undefined) {
      const plan = RuntimeImageBuildRenderSchema.parse(record.spec['runtimeImageBuild']);
      if (record.kind !== 'build-job' || record.owner?.module !== 'runtime-environment' || record.owner.ref !== plan.buildId || plan.resourceId !== record.id || plan.projectId !== projectId) throw precondition('原镜像构建台账归属变化');
      return input.images.withBuildCreationAdmission({ recordId: record.id, buildId: plan.buildId, executionEpoch: plan.executionEpoch }, protectedApply);
    }
    const ref = record?.kind === 'service-slot' ? record.spec['slot'] : record?.spec['job'];
    if (ref !== undefined) {
      const parsed = releaseRef.parse(ref);
      const expected = record?.kind === 'service-slot' && parsed.serviceId && parsed.physical ? parsed.serviceId + '/' + parsed.physical
        : (record?.kind === 'build-job' && parsed.purpose === 'build' || record?.kind === 'migration-job' && parsed.purpose === 'migration') ? parsed.releaseId + '/' + parsed.purpose : undefined;
      if (!expected || record?.owner?.module !== 'release' || record.owner.ref !== expected) throw precondition('原发布台账归属变化');
      return input.release.withResourceCreationAdmission({ recordId: record.id, ...parsed, kind: record.kind === 'service-slot' ? 'slot' : 'pipeline' }, protectedApply);
    }
    return protectedApply();
  };
}
