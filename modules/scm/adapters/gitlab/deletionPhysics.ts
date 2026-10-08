import { jsonHash, precondition } from '@crewstation/kernel';
import { z } from 'zod';
import { GitLabNativeInventorySchema, GitLabNativeInstanceSchema, GitLabFootprintSchema, GitLabActivityReceiptSchema, GitLabDestructionReceiptSchema,
  GitLabStorageRemovalRequestSchema, GitLabDestructionRequestSchema } from '@crewstation/gitlab-client';
import type { createGitLabNativeClient, createGitLabFootprintClient, createGitLabActivityClient, createGitLabFenceClient,
  createGitLabDestructionClient, createGitLabStorageRemovalClient, GitLabNativeInstance, GitLabStorageInventory, GitLabActivityReceipt } from '@crewstation/gitlab-client';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { SCM_STORAGE_KINDS } from '../../ports/projectDeletion';
import type { ScmDeletionPhysics, ScmDeletionPlan, ScmDeletionScope, ScmDeletionProof } from '../../ports/projectDeletion';

type Sources = { instance: GitLabNativeInstance; native: ReturnType<typeof createGitLabNativeClient>;
  files: ReturnType<typeof createGitLabFootprintClient>; activity: ReturnType<typeof createGitLabActivityClient>;
  fence: ReturnType<typeof createGitLabFenceClient>; destruction: ReturnType<typeof createGitLabDestructionClient>;
  removal: ReturnType<typeof createGitLabStorageRemovalClient>; assertGrant(context: ProjectDeletionContext): Promise<void> };
const materialSchema = z.strictObject({ native: GitLabNativeInventorySchema, footprint: GitLabFootprintSchema });
type Material = z.infer<typeof materialSchema>;
const sourceIdentity = (instance: GitLabNativeInstance) => jsonHash({ id: instance.id, startedAt: instance.startedAt, image: instance.image });
const materialIdentity = (material: Material) => jsonHash({ nativeRevision: material.native.nativeRevision, storageRevision: material.footprint.inventory.revision,
  runtime: { bootId: material.native.runtime.bootId, namespace: material.native.runtime.namespace } });
const issue = (code: string, message: string) => ({ participant: 'scm' as const, code, message });
const clear = { complete: true, blockers: [], references: [] };
const pathKind = (location: GitLabStorageInventory['locations'][number]) => location.root === 'repository'
  ? location.relative.includes('.wiki.git') ? 'wiki' : location.relative.includes('.design.git') ? 'design' : location.relative.startsWith('@snippets/') || location.relative.includes('+removed-') && location.key.includes('snippet') ? 'snippet' : 'repository'
  : location.root;
const identities = (inventories: GitLabStorageInventory[]) => [...new Map(inventories.flatMap(value => value.locations.flatMap(row => row.entries))
  .map(row => [row.device + ':' + row.inode + ':' + row.birthtimeNs, { device: row.device, inode: row.inode, birthtimeNs: row.birthtimeNs }])).values()]
  .sort((a, b) => (a.device + ':' + a.inode + ':' + a.birthtimeNs).localeCompare(b.device + ':' + b.inode + ':' + b.birthtimeNs));
const idle = (value: GitLabActivityReceipt) => value.workhorseInFlight === 0 && value.gitalyInFlight === 0 && value.sidekiqInFlight === 0 && value.queuedProjectJobs === 0;

type Verify = (value: { before: GitLabNativeInstance; after: GitLabNativeInstance }) => void;
type Grant = (context: ProjectDeletionContext, scope: ScmDeletionScope, phase: 'stop' | 'purge') => Promise<void>;
type Materials = (raw: ScmDeletionScope) => ReturnType<typeof retainedMaterials>;

function retainedMaterials(raw: ScmDeletionScope, source: ScmDeletionScope['source'], instance: GitLabNativeInstance) {

const scope = structuredClone(raw);
if (jsonHash(scope.source) !== jsonHash(source) || !scope.retained || scope.retained.length !== scope.repositories.length) throw precondition('GitLab 原持久来源未绑定本安装与全部仓库');
const result = scope.retained.map(row => {
  const material = materialSchema.parse(JSON.parse(row.contents)), native = material.native;
  if (row.identity !== materialIdentity(material) || row.repositoryId !== native.project.id || material.footprint.nativeRevision !== native.nativeRevision
    || jsonHash(material.footprint.inventory.roots) !== jsonHash(native.roots)
    || jsonHash({ bootId: native.runtime.bootId, namespace: native.runtime.namespace }) !== instance.epoch
    || jsonHash({ bootId: material.footprint.inventory.runtime.bootId, namespace: material.footprint.inventory.runtime.namespace }) !== instance.epoch
    || !scope.repositories.some(repo => repo.remoteProjectId === native.project.id && repo.pathWithNamespace === native.project.pathWithNamespace && repo.createdAt === native.project.createdAt)) throw precondition('GitLab 原持久物理材料被替换或属于其他仓库');
  return material;
});
if (new Set(result.map(row => row.native.project.id)).size !== result.length) throw precondition('GitLab 原持久材料重复');
return { scope, result };
}
function nativeObservation(options: Sources, verifyInstance: Verify) {
  return async (material: Material) => {
    
    const native = await options.destruction.run({ mode: 'observe', original: material.native }); verifyInstance(native);
    const receipt = GitLabDestructionReceiptSchema.parse(native.receipt);
    if (receipt.foreignReferences) throw precondition('GitLab 原资源仍被其他项目引用');
    const files = await options.files.observe(material.native, material.footprint.inventory); verifyInstance(files);
    const footprint = GitLabFootprintSchema.parse(files.footprint);
    if (footprint.nativeRevision !== material.native.nativeRevision || jsonHash(footprint.inventory.roots) !== jsonHash(material.native.roots)) throw precondition('GitLab 原文件范围变化到其他来源');
    const activity = await options.activity.observe({ original: material.native, identities: identities([material.footprint.inventory, footprint.inventory]) }); verifyInstance(activity);
    return { native: receipt, files: footprint.inventory, activity: GitLabActivityReceiptSchema.parse(activity.receipt) };
  };
}
function nativeProof(options: Sources, source: ScmDeletionScope['source'], materials: Materials,
  observe: ReturnType<typeof nativeObservation>, verifyInstance: Verify): ScmDeletionPhysics['prove'] {
  return async (raw: ScmDeletionScope): Promise<ScmDeletionProof> => {
    
    const { scope, result } = materials(raw), observations = [];
    for (const material of result) observations.push(await observe(material));
    if (observations.some(row => row.native.parentRemaining || !idle(row.activity))) return { kind: 'waiting', reason: '原 GitLab 项目或在途请求尚未退出' };
    if (observations.some(row => row.activity.consumers.length)) return { kind: 'waiting', reason: '原 GitLab 文件仍被进程线程持有，等待实际退出' };
    for (let index = 0; index < result.length; index++) {
      // File absence measured before the last producer exited is insufficient.
      const material = result[index]!, previous = observations[index]!;
      const native = await options.destruction.run({ mode: 'observe', original: material.native }); verifyInstance(native);
      const files = await options.files.observe(material.native, material.footprint.inventory); verifyInstance(files);
      if (native.receipt.revision !== previous.native.revision || files.footprint.inventory.revision !== previous.files.revision)
        return { kind: 'waiting', reason: '原 GitLab 排空期间元数据或文件变化，按同一原范围重新核对' };
    }
    return { kind: 'done', digest: jsonHash(observations.map(row => ({ native: row.native.revision, files: row.files.revision, activity: row.activity.revision }))),
      scopeDigest: jsonHash(scope), sourceIdentity: source.identity, independent: true, producersClosed: true, consumersStopped: true,
      nativeRemaining: observations.reduce((sum, row) => sum + row.native.nativeRemaining, 0),
      storageRemaining: observations.reduce((sum, row) => sum + row.files.locations.reduce((count, location) => count + location.entries.length, 0), 0) };
  };
}
function nativeCapture(options: Sources, source: ScmDeletionScope['source'], verifyInstance: Verify): ScmDeletionPhysics['capture'] {
  return async (raw: ScmDeletionPlan) => {
    
    const plan = structuredClone(raw), repositories: ScmDeletionScope['repositories'][number][] = [], objects: ScmDeletionScope['objects'][number][] = [],
      coverage: ScmDeletionScope['coverage'][number][] = [], retained: NonNullable<ScmDeletionScope['retained']>[number][] = [];
    if (plan.currentOrigins && jsonHash(plan.currentOrigins.source) !== jsonHash(source)) throw precondition('GitLab 当前归属不是同一原安装');
    for (const repository of plan.repositories) {
      const current = plan.currentOrigins?.repositories.find(row => row.remoteProjectId === repository.remoteProjectId), birth = repository.createdAt ?? current?.createdAt;
      if (!birth) throw precondition('GitLab 原项目出生身份缺失');
      const tokenIds = [...new Set([...plan.credentials, ...plan.currentOrigins?.credentials ?? []].filter(row => row.remoteProjectId === repository.remoteProjectId).map(row => row.remoteTokenId))];
      const native = await options.native.observe({ projectId: repository.remoteProjectId, pathWithNamespace: repository.pathWithNamespace, createdAt: birth, tokenIds }); verifyInstance(native);
      const inventory = GitLabNativeInventorySchema.parse(native.inventory);
      GitLabDestructionRequestSchema.parse({ mode: 'destroy', original: inventory });
      if (inventory.project.id !== repository.remoteProjectId || inventory.project.pathWithNamespace !== repository.pathWithNamespace || inventory.project.createdAt !== birth) throw precondition('GitLab 原仓库身份变化');
      const files = await options.files.observe(inventory); verifyInstance(files);
      const footprint = GitLabFootprintSchema.parse(files.footprint), material = materialSchema.parse({ native: inventory, footprint });
      if (footprint.nativeRevision !== inventory.nativeRevision || jsonHash(footprint.inventory.roots) !== jsonHash(inventory.roots)
        || footprint.inventory.locations.some(row => row.entries.some(entry => entry.kind === 'file' && entry.links !== 1))) throw precondition('GitLab 完整文件范围缺失或存在共享硬链接');
      const fields = { remoteProjectId: repository.remoteProjectId, pathWithNamespace: repository.pathWithNamespace, createdAt: birth };
      const identity = jsonHash({ source: source.identity, ...fields });
      if (current && current.identity !== identity) throw precondition('GitLab 当前原身份与物理盘点不符');
      repositories.push({ ...fields, identity }); retained.push({ repositoryId: repository.remoteProjectId, identity: materialIdentity(material), contents: JSON.stringify(material) });
      for (const location of footprint.inventory.locations) objects.push({ repositoryId: repository.remoteProjectId, kind: pathKind(location), id: location.key,
        identity: jsonHash(location), sourceIdentity: jsonHash(footprint.inventory.roots.find(root => root.kind === location.root)), count: location.entries.length });
      for (const kind of SCM_STORAGE_KINDS) coverage.push({ repositoryId: repository.remoteProjectId, kind, identity: jsonHash({ native: inventory.categories.find(row => row.kind === kind),
        files: footprint.inventory.locations.filter(location => pathKind(location) === kind) }), complete: true });
    }
    return { ...clear, scope: { version: 1, plan, source, repositories, objects, coverage, retained } };
  };
}
function nativeStop(options: Sources, materials: Materials, verifyInstance: Verify, grant: Grant, proof: ScmDeletionPhysics['prove']): ScmDeletionPhysics['stop'] {
  return async (context, raw) => {
    
    const { scope, result } = materials(raw); await grant(context, scope, 'stop');
    for (const material of result) {
      const before = await options.destruction.run({ mode: 'observe', original: material.native }); verifyInstance(before);
      if (before.receipt.foreignReferences) return { kind: 'blocked', blockers: [issue('scm-native-shared-reference', '原 GitLab 资源仍有外部引用')] };
      if (!before.receipt.parentRemaining) continue;
      await grant(context, scope, 'stop');
      const { archived: _archived, registryEnabled: _registry, ...project } = material.native.project;
      const fenced = await options.fence.fence({ project, credentials: material.native.credentials }); verifyInstance(fenced);
      if (!fenced.receipt.pendingDelete || !fenced.receipt.deletionInProgress || fenced.receipt.cancelablePipelines
        || fenced.receipt.credentials.tokens.some(token => !token.revoked) || fenced.receipt.credentials.users.some(user => user.state !== 'blocked')) return { kind: 'waiting', reason: '原 GitLab 封写或流水线停止尚未完成' };
      const activity = await options.activity.observe({ original: material.native, identities: identities([material.footprint.inventory]) }); verifyInstance(activity);
      if (!idle(GitLabActivityReceiptSchema.parse(activity.receipt))) return { kind: 'waiting', reason: '原 GitLab 已封写，等待原在途请求实际退出' };
      await grant(context, scope, 'stop');
      const destroyed = await options.destruction.run({ mode: 'destroy', original: material.native }); verifyInstance(destroyed);
    }
    await grant(context, scope, 'stop'); return proof(scope);
  };
}
function nativePurge(options: Sources, materials: Materials, observe: ReturnType<typeof nativeObservation>, verifyInstance: Verify,
  grant: Grant, proof: ScmDeletionPhysics['prove']): ScmDeletionPhysics['purge'] {
  return async (context, raw) => {
    
    const { scope, result } = materials(raw); await grant(context, scope, 'purge');
    const stopped = await proof(scope); if (stopped.kind !== 'done') return stopped;
    // A replay can start after native cleanup has finished. Full independent absence is already the purge result.
    if (stopped.nativeRemaining === 0 && stopped.storageRemaining === 0) {
      await grant(context, scope, 'purge'); return stopped;
    }
    for (const material of result) {
      await grant(context, scope, 'purge');
      const collected = await options.destruction.run({ mode: 'purge', original: material.native }); verifyInstance(collected);
    }
    const collected = await proof(scope); if (collected.kind !== 'done') return collected;
    if (collected.nativeRemaining) return { kind: 'waiting', reason: '原 GitLab 正常清理仍有数据库记录，保留同一原范围继续核对' };
    for (const material of result) {
      const observed = await observe(material);
      if (observed.native.nativeRemaining || !idle(observed.activity) || observed.activity.consumers.length) return { kind: 'waiting', reason: '原 GitLab 清理前出现未退出的原记录或文件消费者' };
      await grant(context, scope, 'purge');
      GitLabStorageRemovalRequestSchema.parse({ original: observed.files });
      const removed = await options.removal.remove(observed.files); verifyInstance(removed);
    }
    await grant(context, scope, 'purge'); return proof(scope);
  };
}

/** Native ACKs are intermediate effects. Completion requires independent
 * detached SQL, full prefixes, in-flight requests and all-thread references. */
export function gitLabDeletionPhysicsAdapter(options: Sources): ScmDeletionPhysics {
  if (typeof options.assertGrant !== 'function') throw precondition('GitLab 清理必须接持久项目许可');
  const instance = GitLabNativeInstanceSchema.parse(options.instance), source = { identity: sourceIdentity(instance), epoch: instance.epoch, version: 'gitlab-native/19.2.4/v1' };
  const grant: Grant = async (context, scope, phase) => {
    if (context.target.id !== scope.plan.projectId || context.phase !== phase || context.confirmed.participant !== 'scm'
      || !context.confirmed.complete || context.confirmed.blockers.length || context.confirmed.references.length) throw precondition('GitLab 物理请求与本项目／阶段许可不符');
    await options.assertGrant(context);
  };
  const verifyInstance: Verify = (value) => {
    if (jsonHash(value.before) !== jsonHash(instance) || jsonHash(value.after) !== jsonHash(instance)) throw precondition('GitLab 原安装实例变化');
  };
  const materials: Materials = (raw) => retainedMaterials(raw, source, instance), observe = nativeObservation(options, verifyInstance);
  const proof = nativeProof(options, source, materials, observe, verifyInstance);
  return {
    capture: nativeCapture(options, source, verifyInstance),
    inspect: async (raw) => {
      
      const { result } = materials(raw);
      try { for (const material of result) {
        const native = await options.destruction.run({ mode: 'observe', original: material.native }); verifyInstance(native);
        if (native.receipt.foreignReferences) throw precondition('GitLab 原资源仍被其他项目引用');
        const files = await options.files.observe(material.native, material.footprint.inventory); verifyInstance(files);
      } return { ...clear }; }
      catch { return { complete: false, blockers: [issue('scm-native-source-unavailable', '原 GitLab 完整来源读取失败或存在共享引用，保留原资源')], references: [] }; }
    },
    stop: nativeStop(options, materials, verifyInstance, grant, proof),
    purge: nativePurge(options, materials, observe, verifyInstance, grant, proof),
    prove: proof,
  };
}
