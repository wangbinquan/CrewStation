import { basename } from 'node:path';
import { isIP } from 'node:net';
import { buildKitCacheGraphOwnership, createBuildKitInputClient, createBuildKitManifestClient, qualifyBuildKitProjectInputs, qualifyBuildKitStaleResults } from '@crewstation/filesystem-metrics';
import type { BuildKitHistoryQuery, BuildKitReclamationScope, GitInputExpectation } from '@crewstation/filesystem-metrics';
import { jsonHash, precondition } from '@crewstation/kernel';
import { registryProbe } from '../nativeRegistry/origin';
import type { nativeBuildKitSource } from '../nativeBuildKit/source';
import type { BuildKitSourceOptions } from '../nativeBuildKit/origin';
import type { K8sClient } from '@crewstation/k8s';
import type { NodeConsumerOrigin } from '../nodeFileConsumers';
import { projectBuildHistories } from './histories';

export type BuildKitSnapshot = Awaited<ReturnType<ReturnType<typeof nativeBuildKitSource>['capture']>>;
export interface BuildKitWorkHistory { version: 1; source: BuildKitSnapshot; selection: BuildKitReclamationScope; cacheIds: string[]; storageIds: string[]; contentDigests: string[];
  selectionIdentity: string; originalFiles: BuildKitSnapshot['inventory']['files']; consumers: NodeConsumerOrigin }
const imageMedia = /^(application\/vnd\.oci\.image\.(index|manifest)\.v1\+json|application\/vnd\.docker\.distribution\.manifest(\.list)?\.v2\+json)$/;
const unique = (values: string[]) => [...new Set(values)].sort();
/** A full native history and image graph, rather than the workbench's latest
 * release list, determines cache ancestry and protects every foreign output. */
export async function selectBuildKitWork(input: { k8s: K8sClient; options: BuildKitSourceOptions; source: BuildKitSnapshot; gitInputs: readonly GitInputExpectation[]; projectCreatedAt: string; fetch?: typeof fetch }) {
  const { source, options } = input, inventory = source.inventory, history = projectBuildHistories(source.native.histories, input.projectCreatedAt), owned = history.owned;
  const probe = await registryProbe(input.k8s, options, source.origin.nodeName, AbortSignal.timeout(15_000));
  const baseUrl = `http://${isIP(probe.address) === 6 ? '[' + probe.address + ']' : probe.address}:${options.probePort}`, directory = basename(source.origin.providerPath);
  if (probe.pod.metadata.uid !== source.origin.probeUid) throw precondition('原 BuildKit 字节来源探针变化');
  const transport = { baseUrl, token: options.probeToken, fetch: (url: URL, init: RequestInit) => (input.fetch ?? fetch)(url, init) };
  const manifests = await createBuildKitManifestClient(transport).observe({ key: jsonHash(source.origin), directory,
    digests: unique(source.native.histories.flatMap(row => row.history.descriptors.filter(d => imageMedia.test(d.mediaType)).map(d => d.digest))) });
  if (manifests.rootIdentity !== inventory.rootIdentity || manifests.volumeIdentity !== inventory.volumeIdentity) throw precondition('原 BuildKit 描述符与文件来源不一致');
  const layers = (refs: string[]) => { const found = new Set<string>(), pending = refs; while (pending.length) { const digest = pending.pop()!; if (found.has(digest)) continue; found.add(digest);
    const manifest = manifests.manifests.find(row => row.digest === digest); if (!manifest) throw precondition('原构建镜像描述符未读到完整 EOF'); pending.push(...manifest.children); } return manifests.manifests.filter(row => found.has(row.digest)).flatMap(row => row.layers); };
  const projectLayers = unique(layers(owned.flatMap(row => row.descriptors.filter(d => imageMedia.test(d.mediaType)).map(d => d.digest)))), foreignLayers = unique([
    ...layers(history.protectedHistories.flatMap(row => row.descriptors.filter(d => imageMedia.test(d.mediaType)).map(d => d.digest))),
    ...inventory.cache.records.flatMap(row => row.blob && !projectLayers.includes(row.blob) ? [row.blob] : []),
  ]);
  const local = inventory.cache.records.filter(row => row.recordType === 'source.local'), localStorage = unique(inventory.snapshots.records.filter(row => local.some(cache => cache.snapshot === row.snapshot)).map(row => row.storageId)), proofs = [];
  for (let offset = 0; offset < localStorage.length; offset += 128) proofs.push(await createBuildKitInputClient(transport).observe({ key: jsonHash(source.origin), directory, storageIds: localStorage.slice(offset, offset + 128), gitInputs: input.gitInputs.map(row => ({ repositoryIdentity: row.repositoryIdentity, commit: row.commit, ...(row.tree ? { tree: [...row.tree] } : {}) })) }));
  const platformInputs = proofs.flatMap(proof => proof.inputs.filter(row => row.sharedPlatformContentsProven).map(row => {
    const snapshot = inventory.snapshots.records.find(actual => actual.storageId === row.storageId)!; return { snapshotKey: snapshot.key, storageId: snapshot.storageId, created: snapshot.created, sourceIdentity: row.sourceIdentity, files: row.files, templateFiles: row.templateFiles };
  }));
  const request = { workerId: source.native.worker.id, projectLayers, foreignLayers, foreignResultKeys: [],
    buildWindows: owned.map(row => ({ started: row.createdAt, finished: row.completedAt! })), platformInputs };
  const graph = buildKitCacheGraphOwnership(request, inventory), stale = qualifyBuildKitStaleResults(graph, inventory, source.native.usage), selected = qualifyBuildKitProjectInputs(graph, inventory, proofs, input.gitInputs, source.native.histories.map(row => row.history));
  if (selected.unknown.length || stale.blockers.some(code => code !== 'unattributed-original-cache')) throw precondition('原共享构建缓存仍有未归属字节、租约或输入，不能省略后声明清理完成');
  const caches = source.native.usage.filter(row => selected.cacheIds.includes(row.id)), histories = owned;
  const selectedContent = unique(inventory.containerd.leases.filter(row => row.kind === 'history' && histories.some(history => history.ref === row.id) || row.kind === 'cache' && selected.cacheIds.includes(row.id)).flatMap(row => row.content));
  const protectedContent = new Set(inventory.containerd.leases.filter(row => !(row.kind === 'history' && histories.some(history => history.ref === row.id) || row.kind === 'cache' && selected.cacheIds.includes(row.id))).flatMap(row => row.content));
  const contentDigests = selectedContent.filter(digest => !protectedContent.has(digest));
  const selection: BuildKitReclamationScope = { version: 1, sourceIdentity: source.identity, workerId: source.native.worker.id, revision: source.native.info.revision!, caches, histories,
    protectedCaches: source.native.usage.filter(row => !selected.cacheIds.includes(row.id)), protectedHistories: history.protectedHistories };
  return { selection, cacheIds: selected.cacheIds, storageIds: selected.storageIds, contentDigests,
    selectionIdentity: jsonHash({ projectCreatedAt: history.projectCreatedAt, graph: graph.identity, stale: stale.identity, selected: selected.identity, manifests: manifests.identity, proofs: proofs.map(row => row.identity), selection }) };
}
export const buildKitHistoryQuery = (registryBase: string, slug: string): BuildKitHistoryQuery => ({ exact: [registryBase + '/' + slug], prefixes: [], protectedRepositories: [] });
