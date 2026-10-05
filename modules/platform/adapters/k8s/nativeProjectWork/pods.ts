import { jsonHash, precondition } from '@crewstation/kernel';
import { nativePodWorkspaceSource } from '../nativePodWorkspace/source';
import { nodeProcessOwnerSource } from '../nodeProcessOwners';
import { freshPlatformNode } from '../platformPodTermination';
import { captureWorkCatalog, inspectWorkCatalog, removeWorkObjects } from './catalog';
import type { CallbackProcess, NativeWorkOptions, PodObject, PodWorkHistory, WorkCatalog, WorkNode } from './bindings';
import { objectKey } from './bindings';
import type { ProjectDeletionContext } from '@crewstation/contracts';
export function podWorkIdentity(work: PodWorkHistory) {
  return jsonHash({ catalog: work.catalog, nodes: work.nodes, workspaces: work.workspaces.map(row => ({ pod: row.pod, node: row.node, sourceIdentity: row.sourceIdentity, consumers: row.consumers,
    root: row.inventory.rootIdentity, podIdentity: row.inventory.podIdentity, volumes: row.inventory.volumes })) });
}

export function nativePodWork(options: NativeWorkOptions) {
  const probe = { namespace: options.systemNamespace, port: options.probePort, token: options.probeToken };
  const workspaces = nativePodWorkspaceSource(options.k8s, { ...probe, hostRoot: '/var/lib/kubelet/pods', mountPath: '/kubelet-pods' }, options.fetch);
  const processes = nodeProcessOwnerSource(options.k8s, probe, options.fetch);
  const capture = async (input: Omit<WorkCatalog, 'objects'>, callbacks: readonly CallbackProcess[]) => {
    const current = await captureWorkCatalog(options, input), retained = [], groups = new Map<string, { node: { uid: string; name: string }; owners: WorkNode['owners'] }>();
    const add = (node: { uid: string; name: string }, owner: WorkNode['owners'][number]) => {
      const group = groups.get(node.uid) ?? { node, owners: [] }; if (!group.owners.some(row => row.key === owner.key)) group.owners.push(owner); groups.set(node.uid, group);
    };
    for (const raw of current.pods) {
      const pod = raw as PodObject, node = await freshPlatformNode(options.k8s, pod);
      if (!pod.spec?.nodeName) continue; if (!node) throw precondition('原工作 Pod 节点缺少新鲜出生来源');
      retained.push(await workspaces.capture(pod)); add(node, { key: 'pod:' + pod.metadata.uid, podUid: pod.metadata.uid! });
    }
    for (const row of callbacks) add({ uid: row.nodeUid, name: row.nodeName }, { key: 'callback:' + row.podUid + ':' + row.containerId, podUid: row.podUid, containerId: row.containerId });
    // The source still scans a real complete host for an empty producer scope.
    if (!groups.size) {
      const nodes = await options.k8s.listPage({ apiVersion: 'v1', kind: 'Node', plural: 'nodes', namespaced: false }, undefined, { limit: 100 });
      if (nodes.continue || !nodes.items.length || nodes.items.some(row => !row.metadata.uid)) throw precondition('空工作范围缺少完整原节点来源');
      for (const node of nodes.items) groups.set(node.metadata.uid!, { node: { uid: node.metadata.uid!, name: node.metadata.name }, owners: [] });
    }
    const sources: WorkNode[] = [];
    for (const group of groups.values()) sources.push({ source: (await processes.capture(group.node, group.owners)).source, owners: group.owners });
    const original: PodWorkHistory = { catalog: current.catalog, workspaces: retained, nodes: sources }; await inspectWorkCatalog(options, current.catalog); return original;
  };
  const inspect = async (original: PodWorkHistory) => {
    const current = await inspectWorkCatalog(options, original.catalog), native = [], files = [];
    for (const node of original.nodes) native.push(await processes.observe(node.source, node.owners));
    for (const directory of original.workspaces) files.push(await workspaces.inspect(directory));
    await inspectWorkCatalog(options, original.catalog);
    return { nativeRemaining: native.reduce((count, row) => count + row.owners.filter(owner => owner.key.startsWith('pod:')).reduce((total, owner) => total + owner.threads.length, 0), 0),
      storageRemaining: current.catalog.objects.length + files.reduce((count, row) => count + row.storageRemaining + (row.inventory.podIdentity ? 1 : 0) + row.consumerCount, 0), digest: jsonHash({ current: current.catalog, native, files }) };
  };
  const stop = async (context: ProjectDeletionContext, original: PodWorkHistory) => {
    const project = options.project(), grant = () => project.assertProjectDeletionGrant(context); await grant();
    await removeWorkObjects(options, original.catalog, true, grant);
    const resourceContext = await project.projectDeletionParticipantContext(context, 'resources'), resources = options.resources().projectDeletion;
    const protectedPods = options.cluster().projectPodProtection({ assertGrant: project.assertProjectDeletionGrant,
      seal: ctx => resources.sealClusterAdmission(ctx, project.assertProjectDeletionGrant), assertSealed: ctx => resources.assertClusterAdmission(ctx, project.assertProjectDeletionGrant) }, resources.podStopReceipts(project.assertProjectDeletionGrant));
    const keys = original.catalog.objects.filter(row => row.kind === 'Pod').map(objectKey);
    const result = await protectedPods.stopSelected(resourceContext, keys); await grant(); return result;
  };
  const purge = async (context: ProjectDeletionContext, original: PodWorkHistory) => {
    const grant = () => options.project().assertProjectDeletionGrant(context); await grant();
    const actual = await inspect(original); if (actual.nativeRemaining) throw precondition('原工作进程未退出，不能回收原凭据');
    await removeWorkObjects(options, original.catalog, false, grant); await grant();
  };
  const callbackExit = async (process: CallbackProcess) => {
    const actual = await processes.capture({ uid: process.nodeUid, name: process.nodeName }, [{ key: 'original-callback', podUid: process.podUid, containerId: process.containerId }]);
    if (process.bootId && process.bootId !== actual.source.bootId) throw precondition('原发布回调的内核出生变化，不能补造退出回执');
    return actual.count === 0 ? jsonHash({ original: process, actual }) : undefined;
  };
  return { capture, inspect, stop, purge, callbackExit };
}
