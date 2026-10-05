import { BUILTIN_RESOURCES, NATIVE_REGISTRY_ADMISSION } from '@crewstation/contracts';
import type { Actor, ProjectDeletionContext, ProjectDeletionTarget, UserId } from '@crewstation/contracts';
import { reclaimBuildKitScope } from '@crewstation/filesystem-metrics';
import { withExclusiveDatabaseAdmissionAuthority } from '@crewstation/persistence';
import type { Database, DatabaseAdmissionAuthority } from '@crewstation/persistence';
import type { GitLabClient } from '@crewstation/gitlab-client';
import type { NativeScmPort } from './bindings';
import { Resources } from '@crewstation/k8s';
import { jsonHash, precondition } from '@crewstation/kernel';
import { nativeBuildKitSource } from '../nativeBuildKit/source';
import type { BuildKitSourceOptions } from '../nativeBuildKit/origin';
import { completeRegistryObjects } from '../nativeRegistry/origin';
import { nodeFileConsumerSource } from '../nodeFileConsumers';
import { selectBuildKitWork, buildKitHistoryQuery } from './buildKitSelection';
import type { BuildKitWorkHistory, BuildKitSnapshot } from './buildKitSelection';
import { buildKitGitInputs } from './buildKitGitInputs';
import type { NativeWorkOptions, ReleaseWorkContent } from './bindings';

export interface BuildKitWorkOptions extends NativeWorkOptions { db: Database; installation: BuildKitSourceOptions; registryBase: string; scm(): NativeScmPort; gitlab: GitLabClient; controlTransport?: Parameters<typeof nativeBuildKitSource>[3] }
const cacheBirth = (row: BuildKitSnapshot['native']['usage'][number]) => jsonHash({ id: row.id, createdAt: row.createdAt, mutable: row.mutable, recordType: row.recordType, parents: row.parents });
const metadataBirth = (row: BuildKitSnapshot['inventory']['cache']['records'][number]) => jsonHash({ id: row.id, snapshot: row.snapshot, created: row.createdNanoseconds, parents: row.parents, equalMutable: row.equalMutable ?? null, blob: row.blob ?? null });
function originalBuildKitScope(original: BuildKitWorkHistory, current: BuildKitSnapshot) {
  const all = [...original.selection.caches, ...original.selection.protectedCaches], histories = [...original.selection.histories, ...original.selection.protectedHistories];
  if (current.identity !== original.source.identity || current.native.usage.some(row => !all.some(before => before.id === row.id && cacheBirth(before) === cacheBirth(row)))
    || original.selection.protectedCaches.some(row => !current.native.usage.some(actual => actual.id === row.id))
    || current.native.histories.some(row => !histories.some(before => before.ref === row.history.ref && before.nativeIdentity === row.history.nativeIdentity))
    || original.selection.protectedHistories.some(row => !current.native.histories.some(actual => actual.history.ref === row.ref))) throw precondition('原 BuildKit 选定或受保护范围出现新的出生、替换或消失');
  for (const row of current.inventory.cache.records.filter(row => original.cacheIds.includes(row.id))) {
    const before = original.source.inventory.cache.records.find(old => old.id === row.id); if (!before || metadataBirth(before) !== metadataBirth(row)) throw precondition('原项目缓存出生变化');
  }
  for (const row of current.inventory.snapshots.records.filter(row => original.storageIds.includes(row.storageId))) {
    if (!original.source.inventory.snapshots.records.some(old => old.storageId === row.storageId && jsonHash(old) === jsonHash(row))) throw precondition('原项目物理快照编号已被其他缓存替换');
  }
  if (current.inventory.files.some(row => !original.originalFiles.some(before => before.path === row.path && before.identity === row.identity && before.kind === row.kind))) throw precondition('封写后出现新的原缓存文件或同名文件替换');
}
/** Exact native Prune/history references under the original PostgreSQL writer
 * exclusion. Independent native files, leases and unlinked inode users supply
 * completion; native acknowledgements never turn into a zero receipt. */
export function nativeBuildKitProjectWork(options: BuildKitWorkOptions) {
  const source = nativeBuildKitSource(options.k8s, options.installation, options.fetch, options.controlTransport), consumers = nodeFileConsumerSource(options.k8s,
    { namespace: options.systemNamespace, port: options.probePort, token: options.probeToken }, options.fetch);
  const capture = async (target: ProjectDeletionTarget, content: ReleaseWorkContent): Promise<BuildKitWorkHistory> => {
    const actor: Actor = { userId: BUILTIN_RESOURCES.systemActor as UserId, isAdmin: true }, project = await options.project().getProject(actor, target.id);
    if (project.id !== target.id || project.slug !== target.slug) throw precondition('原项目出生与删除范围不符');
    const history = buildKitHistoryQuery(options.registryBase, target.slug), initial = await source.capture({ files: { storageIds: [], contentDigests: [] }, history });
    const gitInputs = await buildKitGitInputs(options.scm(), options.gitlab, target, content), selected = await selectBuildKitWork({ k8s: options.k8s, options: options.installation, source: initial, gitInputs, projectCreatedAt: project.createdAt, fetch: options.fetch });
    const current = await source.verify({ files: { storageIds: selected.storageIds, contentDigests: selected.contentDigests }, history }, initial);
    if (jsonHash(current.native) !== jsonHash(initial.native) || ['cache', 'results', 'snapshots', 'containerd'].some(key => current.inventory[key as 'cache'].revision !== initial.inventory[key as 'cache'].revision)) throw precondition('原共享缓存图在源码完整 EOF 期间变化');
    const users = await consumers.capture({ uid: current.origin.nodeUid, name: current.origin.nodeName }, current.inventory.files.map(row => ({ device: row.device, inode: row.inode })));
    const checked = await source.verify(current.query, current); if (jsonHash(checked.native) !== jsonHash(current.native) || checked.inventory.revision !== current.inventory.revision) throw precondition('原共享缓存在完整消费者盘点期间变化');
    return { version: 1, source: current, ...selected, originalFiles: current.inventory.files, consumers: users.source };
  };
  const inspect = async (original: BuildKitWorkHistory) => {
    const current = await source.verify(original.source.query, original.source); originalBuildKitScope(original, current);
    const users = await consumers.observe(original.consumers, original.originalFiles.map(row => ({ device: row.device, inode: row.inode })));
    const checked = await source.verify(original.source.query, original.source); originalBuildKitScope(original, checked);
    if (jsonHash(current.native) !== jsonHash(checked.native) || current.inventory.revision !== checked.inventory.revision) throw precondition('原缓存回收盘点与文件消费者不是同一完整范围');
    const refs = original.selection.histories.map(row => row.ref), selectedLeases = checked.inventory.containerd.leases.filter(row => row.kind === 'cache' && original.cacheIds.includes(row.id) || row.kind === 'history' && refs.includes(row.id));
    const nativeRemaining = checked.native.histories.filter(row => refs.includes(row.history.ref) && row.history.event === 'started').length
      + checked.native.usage.filter(row => original.cacheIds.includes(row.id) && row.inUse).length + users.count;
    const storageRemaining = checked.inventory.files.length + checked.inventory.cache.records.filter(row => original.cacheIds.includes(row.id)).length
      + checked.native.usage.filter(row => original.cacheIds.includes(row.id)).length + checked.native.histories.filter(row => refs.includes(row.history.ref)).length
      + selectedLeases.length + checked.inventory.containerd.content.filter(row => original.contentDigests.includes(row.digest)).length
      + checked.inventory.snapshots.records.filter(row => original.storageIds.includes(row.storageId)).length + users.count;
    return { current: checked, nativeRemaining, storageRemaining, digest: jsonHash({ original: original.selectionIdentity, current: checked, users }) };
  };
  const assertGlobalWritersStopped = async () => {
    const jobs = await completeRegistryObjects(options.k8s, Resources.Job!, undefined, 'app.kubernetes.io/managed-by=crewstation,app.kubernetes.io/component=build', AbortSignal.timeout(15_000));
    if (jobs.some(job => !job.metadata.labels?.['crewstation.io/image-build'] && !(job['status'] as { conditions?: Array<{ type: string; status: string }> } | undefined)?.conditions?.some(row => ['Complete', 'Failed'].includes(row.type) && row.status === 'True'))) throw precondition('其他项目原共享构建 Job 尚未终结，缓存回收保留原范围等待');
  };
  const purge = async (context: ProjectDeletionContext, original: BuildKitWorkHistory) => {
    if (context.phase !== 'purge' || context.confirmed.participant !== 'release') throw precondition('原共享缓存回收缺少发布 purge 许可');
    let authority: DatabaseAdmissionAuthority | undefined;
    const closed = async () => {
      if (!authority) throw precondition('原共享缓存排他回调已退出'); await authority.assertActive(); await options.project().assertProjectDeletionGrant(context);
      await assertGlobalWritersStopped(); const actual = await inspect(original);
      if (actual.nativeRemaining || actual.current.native.histories.some(row => row.history.event === 'started')) throw precondition('原共享构建或文件消费者仍在运行');
      await authority.assertActive(); await options.project().assertProjectDeletionGrant(context);
    };
    return reclaimBuildKitScope(await source.transport(original.source), original.selection, {
      exclusive: (_scope, effect) => withExclusiveDatabaseAdmissionAuthority(options.db, NATIVE_REGISTRY_ADMISSION, async actual => {
        authority = actual; try { await closed(); const result = await effect(); await closed(); return result; } finally { authority = undefined; }
      }), assertClosed: closed,
    }, AbortSignal.timeout(90_000));
  };
  return { capture, inspect, purge };
}
