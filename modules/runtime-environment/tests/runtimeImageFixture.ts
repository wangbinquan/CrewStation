import type { RuntimeImageExecutionHistory } from '../ports/executionHistory';
import type { Actor, RuntimeImageSource, UserId } from '@crewstation/contracts';
import { CreateRuntimeImageRevisionSchema, IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { forbidden, newResourceId } from '@crewstation/kernel';
import { createTestDatabase } from '@crewstation/testkit';
import { runtimeImageUnitOfWork } from '../adapters/persistence/unitOfWork';
import { createRuntimeEnvironmentModule, runtimeEnvironmentMigrations } from '../wiring';
import type { RuntimeInitializationSecrets, RuntimeImageValidationContracts } from '../ports/platform';
import type { RuntimeImageValidationExecutor } from '../ports/validationExecutor';
import type { RuntimeImageBuildExecutor } from '../ports/buildExecutor';
import type { RuntimeImageReferenceOwners } from '../ports/referenceOwners';

export const actor = (isAdmin = false): Actor => ({ userId: newResourceId() as UserId, isAdmin });
export const digest = `sha256:${'a'.repeat(64)}`;

export async function runtimeImageFixture(executor?: RuntimeImageBuildExecutor, secrets?: { versions: NonNullable<RuntimeImageValidationContracts['secretVersions']>; values: RuntimeInitializationSecrets }, validationExecutor?: RuntimeImageValidationExecutor, referenceOwners?: RuntimeImageReferenceOwners, executionHistory?: RuntimeImageExecutionHistory) {
  const tdb = await createTestDatabase([runtimeEnvironmentMigrations]);
  const project = newResourceId(), otherProject = newResourceId(), repositoryBindingId = newResourceId();
  const developer = actor(), admin = actor(true), tester = actor(), outsider = actor();
  const admins = new Set([admin.userId]);
  const limits = { platformBuilds: 2, projectBuilds: 1, buildTimeoutSeconds: 600, logRetentionSeconds: 60, logMaxBytes: 1024 };
  const memberships = new Map([[developer.userId, new Set([project, otherProject])], [tester.userId, new Set([project])]]);
  let now = new Date('2026-09-27T00:00:00Z'), prepares = 0, contractFingerprint = digest;
  const mod = createRuntimeEnvironmentModule({
    db: tdb.db, clock: { now: () => now }, isAdmin: async (id) => admins.has(id), referenceOwners, executionHistory,
    authorizer: { authorize: async (a, p, action) => {
      if (a.isAdmin) return;
      if (!memberships.get(a.userId)?.has(p) || action === 'manage' || (a.userId === tester.userId && action !== 'view')) throw forbidden();
    } },
    sources: { prepare: async (_a, _p, source: RuntimeImageSource) => {
      prepares++;
      return source.kind === 'existing' ? { source: { ...source, reference: `registry.test/project/tool@${digest}` } } : { source, commitSha: 'b'.repeat(40), baseImage: `registry.test/platform/task@${digest}` };
    } },
    validationContracts: { fingerprint: async () => contractFingerprint, ...(secrets ? { secretVersions: secrets.versions } : {}) },
    ...(secrets ? { initializationSecrets: secrets.values } : {}),
    ...(validationExecutor ? { validationExecutor } : {}),
    buildExecutor: executor ?? { reconcile: async () => { throw new Error('目录测试不能启动构建'); }, inspect: async () => { throw new Error('目录测试不能检查真实镜像'); } },
    limits,
  });
  const app = createApp({ name: 'runtime-image-test' });
  for (const route of mod.http) app.route('/', route);
  return { ...mod, tdb, app, project, otherProject, developer, admin, tester, outsider, memberships, admins, limits,
    changeContract: (value: string) => { contractFingerprint = value; },
    uow: runtimeImageUnitOfWork(tdb.db), advance: (ms: number) => { now = new Date(now.getTime() + ms); }, prepares: () => prepares,
    headers: (a: Actor) => ({ [IDENTITY_HEADERS.userId]: a.userId, 'Content-Type': 'application/json' }),
    image: async (p = project) => mod.api.createImage(admin, p, { name: `tools-${newResourceId()}`, description: '' }),
    revision: (imageId: string, p = project) => mod.api.createRevision(admin, p, imageId, CreateRuntimeImageRevisionSchema.parse({
      source: { kind: 'source', repositoryBindingId, ref: 'main', architecture: 'linux/amd64', usage: 'task' },
    })),
  };
}
export type RuntimeImageFixture = Awaited<ReturnType<typeof runtimeImageFixture>>;
