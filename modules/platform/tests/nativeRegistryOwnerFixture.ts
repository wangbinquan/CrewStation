import { randomUUID } from 'node:crypto';
import { writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { ProjectDeletionTargetSchema, ProjectIdSchema } from '@crewstation/contracts';
import type { NativeRegistryDeletionSource, ProjectDeletionContext } from '@crewstation/contracts';
import { captureRegistryHistory, registryHistoryIdentity } from '@crewstation/filesystem-metrics';
import type { RegistryDeletionHistory } from '@crewstation/filesystem-metrics';
import { runtimeImageRegistryDeletionPhysics as createRuntimeImageRegistryDeletionPhysics } from '../../runtime-environment/adapters/registry/deletionPhysics';
import { releaseRegistryDeletionPhysics as createReleaseRegistryDeletionPhysics } from '../../release/adapters/registry/deletionPhysics';
import { RuntimeImagePhysicalScopeSchema, runtimeImagePhysicalOrigins, RUNTIME_IMAGE_PHYSICAL_KINDS } from '../../runtime-environment/domain/records';
import type { RuntimeImageDeletionPhysics, RuntimeImagePhysicalScope } from '../../runtime-environment/ports/projectDeletion';
import type { RuntimeImageProjectContent } from '../../runtime-environment/ports/repositories';
import { ReleasePhysicalScopeSchema, RELEASE_PHYSICAL_KINDS } from '../../release/domain/release';
import type { ReleaseDeletionContent, ReleasePhysicalScope } from '../../release/domain/release';
import type { ReleaseDeletionPhysics } from '../../release/ports/unitOfWork';
import { registryArtifactFixture } from '../adapters/k8s/nativeRegistry/artifactFixture';
import { nativeRegistryJournal } from '../../../deploy/local/registry-native/journal';
import { nativeRegistryService } from '../../../deploy/local/registry-native/service';

const report = { complete: true, blockers: [], references: [] };
interface Controls { independent: boolean; closed: boolean; stopped: boolean; native: number; storage: number; grants: boolean; reclaimed: number; malformed: boolean }
const proof = (scope: RuntimeImagePhysicalScope | ReleasePhysicalScope, controls: Controls) => ({ kind: 'done' as const, digest: jsonHash({ scope, controlledWork: controls }), scopeDigest: jsonHash(scope), sourceIdentity: scope.source.identity,
  independent: controls.independent, producersClosed: controls.closed, consumersStopped: controls.stopped, nativeRemaining: controls.native, storageRemaining: controls.storage, callbackExits: [] });
function runtimeWork(projectId: string, controls: Controls): RuntimeImageDeletionPhysics {
  return { capture: async (_target, content) => ({ ...report, scope: { version: 1, projectId, originDigest: runtimeImagePhysicalOrigins(projectId, content.inventory.resources, content.callbacks),
    source: { identity: jsonHash('controlled-work-source'), epoch: jsonHash('controlled-work-birth'), version: 'controlled-work/1' }, objects: [],
    coverage: RUNTIME_IMAGE_PHYSICAL_KINDS.map(kind => ({ kind, identity: jsonHash(kind), complete: true })) } }),
    inspect: async () => report, stop: async (_context, scope) => proof(scope, controls), purge: async (_context, scope) => proof(scope, controls), prove: async scope => proof(scope, controls) };
}
function releaseWork(projectId: string, controls: Controls): ReleaseDeletionPhysics {
  return { capture: async (_target, content) => ({ ...report, scope: ReleasePhysicalScopeSchema.parse({ version: 1, projectId, originDigest: jsonHash({ projectId, bindings: [], identityLinks: content.identityLinks }), bindings: [],
    source: { identity: jsonHash('controlled-work-source'), epoch: jsonHash('controlled-work-birth'), version: 'controlled-work/1' }, objects: [],
    coverage: RELEASE_PHYSICAL_KINDS.map(kind => ({ kind, identity: jsonHash(kind), complete: true })) }) }),
    inspect: async () => report, stop: async (_context, scope) => proof(scope, controls), purge: async (_context, scope) => proof(scope, controls), prove: async scope => proof(scope, controls) };
}
export async function nativeRegistryOwnerFixture(procRoot: string, mode: 'runtime-environment' | 'release') {
  const projectId = ProjectIdSchema.parse(newResourceId()), buildId = newResourceId(), repository = mode === 'release' ? 'original' : `runtime/projects/${projectId}/${buildId}/image`;
  const operationId = newResourceId(), registryBase = 'registry.test:5000';
  const controls: Controls = { independent: true, closed: true, stopped: true, native: 0, storage: 0, grants: true, reclaimed: 0, malformed: false };
  const target = ProjectDeletionTargetSchema.parse({ id: projectId, slug: 'original', name: 'Original', namespace: 'cs-original', kind: 'DigitalWorker', state: 'active', revision: '1', prodHost: 'original.test', previewHost: 'preview.original.test', serviceHost: 'original.svc' });
  const f = await registryArtifactFixture(procRoot, repository);
  const inventory = { ...report, participant: mode, revision: jsonHash('controlled-content'), resources: [] };
  const assertGrant = async (context: ProjectDeletionContext) => { if (!controls.grants || context.operationId !== operationId || context.target.id !== projectId) throw Error('Original fixture grant changed'); };
  let handler: ((request: Request) => Promise<Response>) | undefined, journal: ReturnType<typeof nativeRegistryJournal> | undefined, history: RegistryDeletionHistory | undefined;
  const artifacts: NativeRegistryDeletionSource = { capture: async (id, query) => { history = await f.source.capture(id, query); return history; },
    inspect: async raw => { const current = await f.source.inspect(captureRegistryHistory(raw as RegistryDeletionHistory)); return controls.malformed ? { ...current, native: 0, storage: 0 } : current; } };
  const transport = { baseUrl: 'http://private-registry', token: 'private-registry-original-token-1234567890', fetch: async (url: URL, init: RequestInit) => {
    controls.reclaimed++; if (!handler) throw Error('Private original source is unavailable'); return handler(new Request(url, init)); } };
  const runtimeContent: RuntimeImageProjectContent = { inventory, rows: [], consumers: [], callbacks: [], dependencies: [], artifacts: [{ kind: 'version', id: newResourceId(), repository: `${registryBase}/${repository}`, digest: f.manifest, projectOwned: true }] };
  const releaseContent: ReleaseDeletionContent = { inventory, rows: [], consumers: [], callbacks: [], identityLinks: [], artifacts: [{ releaseId: newResourceId(), reference: `${registryBase}/${repository}@${f.manifest}` }] };
  const rebuild = () => {
    const image = createRuntimeImageRegistryDeletionPhysics({ work: runtimeWork(projectId, controls), artifacts, transport, registryBase, assertGrant });
    const release = createReleaseRegistryDeletionPhysics({ work: releaseWork(projectId, controls), artifacts, transport, registryBase, assertGrant });
    return mode === 'runtime-environment' ? { runtimePhysics: image,
    capture: () => image.capture(target, runtimeContent), inspect: (raw: unknown) => image.inspect(RuntimeImagePhysicalScopeSchema.parse(raw)),
    stop: (context: ProjectDeletionContext, raw: unknown) => image.stop(context, RuntimeImagePhysicalScopeSchema.parse(raw)),
    purge: (context: ProjectDeletionContext, raw: unknown) => image.purge(context, RuntimeImagePhysicalScopeSchema.parse(raw)), prove: (raw: unknown) => image.prove(RuntimeImagePhysicalScopeSchema.parse(raw)),
  } : { runtimePhysics: image, capture: () => release.capture(target, releaseContent), inspect: (raw: unknown) => release.inspect(ReleasePhysicalScopeSchema.parse(raw)),
    stop: (context: ProjectDeletionContext, raw: unknown) => release.stop(context, ReleasePhysicalScopeSchema.parse(raw)),
    purge: (context: ProjectDeletionContext, raw: unknown) => release.purge(context, ReleasePhysicalScopeSchema.parse(raw)), prove: (raw: unknown) => release.prove(ReleasePhysicalScopeSchema.parse(raw)) };
  };
  const api = rebuild();
  const context = (scope: RuntimeImagePhysicalScope | ReleasePhysicalScope, phase: 'stop' | 'purge'): ProjectDeletionContext => ({ target, phase, operationId, generation: 1,
    confirmed: { ...inventory, revision: jsonHash(scope), resources: scope.objects.map(row => ({ kind: (mode === 'release' ? 'release-native:' : 'runtime-native:') + row.kind, id: row.id, identity: row.identity,
      sourceIdentity: mode === 'release' ? row.sourceIdentity : jsonHash({ nativeSource: row.sourceIdentity, consumerId: 'consumerId' in row ? row.consumerId ?? null : null, consumerIdentity: 'consumerIdentity' in row ? row.consumerIdentity ?? null : null }), scope: 'physical', count: row.count })) } });
  const install = () => {
    if (!history) throw Error('Original scope was not captured');
    journal = nativeRegistryJournal(join(f.root, 'native-registry-work.sqlite'), history.sourceIdentity);
    handler = nativeRegistryService({ root: f.root, token: transport.token, sourceIdentity: history.sourceIdentity, journal, assertGrant,
      assertOriginalSource: async raw => { await f.source.inspect(raw); }, authority: () => ({ exclusive: async (_raw, work) => work(), assertClosed: async () => {
        if (!controls.closed || !controls.stopped || controls.native || !controls.independent) throw Error('Controlled original native work is not closed');
      } }) });
  };
  return { ...f, target, runtimeContent, releaseContent, controls, api, rebuild, context, install, history: () => history!, drop: async () => { journal?.close(); await f.drop(); },
    exists: async (digest: string) => { try { await stat(f.path(digest)); return true; } catch (error) { if ((error as { code?: string }).code === 'ENOENT') return false; throw error; } },
    artifactIdentity: () => registryHistoryIdentity(history!), prepareProc: async () => { await writeFile(join(procRoot, 'sys/kernel/random/boot_id'), randomUUID() + '\n'); } };
}
