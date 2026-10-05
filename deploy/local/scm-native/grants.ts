import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import { ProjectDeletionContextSchema } from '../../../packages/contracts';
import type { ProjectDeletionContext } from '../../../packages/contracts';
import { jsonHash } from '../../../packages/kernel';
import { GitLabNativeInventorySchema, GitLabFootprintSchema, GitLabNativeInstanceSchema,
  parseGitLabFootprintOutput, parseGitLabDestructionOutput, parseGitLabActivityOutput } from '../../../packages/gitlab-client';
import type { GitLabNativeInstance, GitLabFootprintObserver, GitLabDestructionObserver, GitLabActivityObserver,
  GitLabFenceRequest, GitLabDestructionRequest, GitLabStorageRemovalRequest } from '../../../packages/gitlab-client';

const materialSchema = z.strictObject({ native: GitLabNativeInventorySchema, footprint: GitLabFootprintSchema });
const envelope = z.strictObject({ context: ProjectDeletionContextSchema, materials: z.array(materialSchema).max(1000), request: z.unknown() });
type Material = z.infer<typeof materialSchema>;
type Grant = z.infer<typeof envelope>;
const identity = (row: Material) => jsonHash({ nativeRevision: row.native.nativeRevision, storageRevision: row.footprint.inventory.revision,
  runtime: { bootId: row.native.runtime.bootId, namespace: row.native.runtime.namespace } });
const epoch = (runtime: { bootId: string; namespace: string }) => jsonHash({ bootId: runtime.bootId, namespace: runtime.namespace });
type Sources = { instance: GitLabNativeInstance; assertGrant(context: ProjectDeletionContext, signal: AbortSignal): Promise<void>;
  footprint: GitLabFootprintObserver; destruction: GitLabDestructionObserver; activity: GitLabActivityObserver };

function admitted(raw: unknown, instance: GitLabNativeInstance): Grant {
  const grant = envelope.parse(structuredClone(raw)), context = grant.context;
  if (context.confirmed.participant !== 'scm' || !['stop', 'purge'].includes(context.phase) || !context.confirmed.complete
    || context.confirmed.blockers.length || context.confirmed.references.length) throw Error('native-source-invalid-controller-context');
  const refs = context.confirmed.resources.filter(row => row.kind === 'gitlab-retained-source');
  const source = jsonHash({ id: instance.id, image: instance.image, startedAt: instance.startedAt });
  if (refs.length !== grant.materials.length || new Set(grant.materials.map(row => row.native.project.id)).size !== grant.materials.length
    || grant.materials.some(row => epoch(row.native.runtime) !== instance.epoch || epoch(row.footprint.inventory.runtime) !== instance.epoch
      || row.footprint.nativeRevision !== row.native.nativeRevision || jsonHash(row.native.roots) !== jsonHash(row.footprint.inventory.roots)
      || !refs.some(ref => ref.id === row.native.project.id && ref.identity === identity(row) && ref.sourceIdentity === source))) throw Error('native-source-unconfirmed-material');
  return grant;
}
const observeFiles = async (input: Sources, row: Material, signal: AbortSignal) => parseGitLabFootprintOutput(await input.footprint.read({ original: row.native,
  retained: row.footprint.inventory }, signal), row.native).inventory;

async function stoppedOriginal(input: Sources, row: Material, signal: AbortSignal, absent: boolean, empty: boolean) {
  const query = { mode: 'observe' as const, original: row.native };
  const before = parseGitLabDestructionOutput(await input.destruction.run(query, signal), query);
  if (before.foreignReferences || absent && before.parentRemaining || empty && before.nativeRemaining) throw Error('native-source-original-records-not-stopped');
  const inventory = await observeFiles(input, row, signal);
  const identities = [...new Map([row.footprint.inventory, inventory].flatMap(value => value.locations.flatMap(location => location.entries))
    .map(entry => [entry.device + ':' + entry.inode, { device: entry.device, inode: entry.inode }])).values()];
  const activityQuery = { original: row.native, identities };
  const activity = parseGitLabActivityOutput(await input.activity.read(activityQuery, signal), activityQuery);
  if (activity.workhorseInFlight || activity.gitalyInFlight || activity.sidekiqInFlight || activity.queuedProjectJobs
    || absent && activity.consumers.length) throw Error('native-source-original-consumers-not-stopped');
  return inventory;
}

/** The private source re-reads the controller's persisted lease; possession of
 * the source credential alone never grants destruction of another project. */
export function nativeGitlabMutationGrants(input: Sources) {
  const instance = GitLabNativeInstanceSchema.parse(input.instance), grants = new AsyncLocalStorage<Grant>();
  const current = (phase: 'stop' | 'purge') => {
    const grant = grants.getStore();
    if (!grant || grant.context.phase !== phase) throw Error('native-source-current-grant-required');
    return grant;
  };
  const original = (request: GitLabDestructionRequest, phase: 'stop' | 'purge') => {
    const grant = current(phase), row = grant.materials.find(value => jsonHash(value.native) === jsonHash(request.original));
    if (!row) throw Error('native-source-original-material-changed'); return row;
  };
  const files = (row: Material, signal: AbortSignal) => observeFiles(input, row, signal);
  return {
    run: <T>(raw: unknown, work: (request: unknown) => Promise<T>) => {
      const grant = admitted(raw, instance);
      return grants.run(grant, () => work(grant.request));
    },
    fence: async (request: GitLabFenceRequest, signal: AbortSignal) => {
      const grant = current('stop');
      if (!grant.materials.some(row => {
        const { archived: _archived, registryEnabled: _registry, ...project } = row.native.project;
        return jsonHash(request) === jsonHash({ project, credentials: row.native.credentials });
      })) throw Error('native-source-unconfirmed-fence');
      await input.assertGrant(grant.context, signal);
    },
    destruction: async (request: GitLabDestructionRequest, signal: AbortSignal) => {
      const phase = request.mode === 'destroy' ? 'stop' : 'purge'; original(request, phase);
      await input.assertGrant(current(phase).context, signal);
    },
    destructionStopped: async (request: GitLabDestructionRequest, signal: AbortSignal) => {
      const phase = request.mode === 'destroy' ? 'stop' : 'purge';
      await stoppedOriginal(input, original(request, phase), signal, request.mode === 'purge', false);
      await input.assertGrant(current(phase).context, signal);
    },
    removal: async (request: GitLabStorageRemovalRequest, signal: AbortSignal) => {
      const grant = current('purge'); let matched = false;
      for (const row of grant.materials) {
        const observed = await files(row, signal);
        if (epoch(request.original.runtime) === instance.epoch && request.original.revision === observed.revision
          && request.original.requestDigest === observed.requestDigest && jsonHash(request.original.roots) === jsonHash(observed.roots)) matched = true;
      }
      if (!matched) throw Error('native-source-unconfirmed-removal'); await input.assertGrant(grant.context, signal);
    },
    removalStopped: async (_request: GitLabStorageRemovalRequest, signal: AbortSignal) => {
      const grant = current('purge');
      for (const row of grant.materials) await stoppedOriginal(input, row, signal, true, true);
      await input.assertGrant(grant.context, signal);
    },
  };
}
