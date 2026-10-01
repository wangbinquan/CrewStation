import { isIP } from 'node:net';
import { basename, dirname, posix } from 'node:path';
import { SourceResponseSchema } from '@crewstation/filesystem-metrics';
import type { SourceRequest } from '@crewstation/filesystem-metrics';
import { boundedMetricsText, Resources } from '@crewstation/k8s';
import type { K8sClient, K8sObject, ResourceRef } from '@crewstation/k8s';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import { freshPlatformNode } from './platformPodTermination';

export interface NativePostgresSourceOptions { namespace: string; service: string; adminUrl: string; probeRoot: string; probePort: number; probeToken: string }
type SqlServer = { address: string; port: number; directory: string; system_identifier: string; pg_control_version: number; catalog_version_no: number };
interface NativeSourceConnection { query<T extends Record<string, unknown>[]>(text: string): Promise<T>; assertHeld(): Promise<void> }
interface PodSpec {
  nodeName?: string; volumes?: Array<{ name: string; persistentVolumeClaim?: { claimName: string }; hostPath?: { path: string; type?: string } }>;
  containers?: Array<{ name: string; volumeMounts?: Array<{ name: string; mountPath: string; readOnly?: boolean; subPath?: string; subPathExpr?: string }> }>;
}
interface PodStatus { podIP?: string; conditions?: Array<{ type: string; status: string }>; containerStatuses?: Array<{ name: string; containerID?: string; ready?: boolean; state?: { running?: unknown } }> }
interface PvSpec { claimRef?: { uid?: string; name?: string; namespace?: string }; hostPath?: { path: string }; local?: { path: string }; csi?: unknown }
const endpointSlice: ResourceRef = { apiVersion: 'discovery.k8s.io/v1', kind: 'EndpointSlice', plural: 'endpointslices', namespaced: true };
const unavailable = (message: string) => precondition(message, { code: 'native_postgres_source_unavailable' });

async function complete(k8s: K8sClient, ref: ResourceRef, namespace: string, selector: string): Promise<K8sObject[]> {
  const objects: K8sObject[] = [], cursors = new Set<string>(); let cursor: string | undefined, version: string | undefined;
  do {
    const page = await k8s.listPage(ref, namespace, { labelSelector: selector, limit: 100, signal: AbortSignal.timeout(10_000), ...(cursor ? { continue: cursor } : {}) });
    if (!page.resourceVersion || (version && version !== page.resourceVersion)) throw unavailable('原生存储来源分页世代变化');
    version = page.resourceVersion; objects.push(...page.items); cursor = page.continue || undefined;
    if (objects.length > 10_000 || (cursor && cursors.has(cursor))) throw unavailable('原生存储来源分页不完整');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return objects;
}
async function sqlSource(connection: NativeSourceConnection): Promise<{ server: SqlServer; spaces: Array<{ oid: string; location: string }> }> {
  await connection.assertHeld();
  const rows = await connection.query<SqlServer[]>("SELECT host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS directory,system_identifier::text,pg_control_version,catalog_version_no FROM pg_control_system()");
  const server = rows[0];
  if (rows.length !== 1 || !server || !isIP(server.address) || !Number.isInteger(server.port) || server.port < 1 || server.port > 65535 || !posix.isAbsolute(server.directory) || !/^[0-9]+$/.test(server.system_identifier) || !Number.isInteger(server.pg_control_version) || !Number.isInteger(server.catalog_version_no)) throw unavailable('原生服务器地址与实际数据位置无法核实');
  const spaces = await connection.query<Array<{ oid: string; location: string }>>('SELECT oid::text AS oid,pg_tablespace_location(oid) AS location FROM pg_tablespace WHERE oid NOT IN (1663,1664) ORDER BY oid');
  if (spaces.length > 1000 || spaces.some((space) => !/^[1-9][0-9]*$/.test(space.oid) || !posix.isAbsolute(space.location))) throw unavailable('原生表空间清单不完整');
  return { server, spaces };
}
async function serverPod(k8s: K8sClient, options: NativePostgresSourceOptions, server: SqlServer, service: K8sObject): Promise<K8sObject> {
  const url = new URL(options.adminUrl), allowed = [options.service, `${options.service}.${options.namespace}`, `${options.service}.${options.namespace}.svc`, `${options.service}.${options.namespace}.svc.cluster.local`];
  const spec = service['spec'] as { ports?: Array<{ port: number; targetPort?: string | number }> } | undefined;
  if (!allowed.includes(url.hostname) || !spec?.ports?.some((port) => port.port === Number(url.port || 5432))) throw unavailable('外部原生数据库没有已登记的来源适配器');
  const slices = await complete(k8s, endpointSlice, options.namespace, `kubernetes.io/service-name=${options.service}`), matches: Array<{ name: string; uid: string }> = [];
  for (const slice of slices) {
    if (!slice.metadata.uid || slice.metadata.deletionTimestamp || !slice.metadata.ownerReferences?.some((owner) => owner.kind === 'Service' && owner.uid === service.metadata.uid)) throw unavailable('原生服务端点来源未知');
    const ports = slice['ports'] as Array<{ port?: number }> | undefined;
    for (const endpoint of slice['endpoints'] as Array<{ addresses?: string[]; conditions?: { ready?: boolean; terminating?: boolean }; targetRef?: { kind?: string; namespace?: string; name?: string; uid?: string } }> ?? []) {
      if (!endpoint.addresses?.includes(server.address)) continue;
      const ref = endpoint.targetRef;
      if (!ports?.some((port) => port.port === server.port) || endpoint.conditions?.ready !== true || endpoint.conditions.terminating || ref?.kind !== 'Pod' || ref.namespace !== options.namespace || !ref.name || !ref.uid) throw unavailable('原生服务器端点尚未就绪或缺原 Pod 身份');
      matches.push({ name: ref.name, uid: ref.uid });
    }
  }
  if (matches.length !== 1) throw unavailable('原生服务器端点不能唯一匹配');
  const pod = await k8s.get(Resources.Pod!, matches[0]!.name, options.namespace, AbortSignal.timeout(10_000)), status = pod?.['status'] as PodStatus | undefined;
  if (!pod || pod.metadata.uid !== matches[0]!.uid || pod.metadata.deletionTimestamp || status?.podIP !== server.address || !status.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True')) throw unavailable('原生服务器 Pod 身份变化');
  return pod;
}
async function probePod(k8s: K8sClient, options: NativePostgresSourceOptions, nodeName: string): Promise<K8sObject> {
  const candidates = (await complete(k8s, Resources.Pod!, options.namespace, 'app=cs-storage-probe')).filter((pod) => {
    const spec = pod['spec'] as PodSpec | undefined, status = pod['status'] as PodStatus | undefined;
    const volume = spec?.volumes?.find((item) => item.hostPath?.path === options.probeRoot && item.hostPath.type === 'Directory');
    return pod.metadata.uid && !pod.metadata.deletionTimestamp && spec?.nodeName === nodeName && status?.podIP && isIP(status.podIP) && status.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True')
      && volume && spec.containers?.some((container) => container.volumeMounts?.some((mount) => mount.name === volume.name && mount.mountPath === '/volumes' && mount.readOnly));
  });
  if (candidates.length !== 1) throw unavailable('原节点的只读存储来源探针不可用');
  return candidates[0]!;
}
async function volumeSource(k8s: K8sClient, options: NativePostgresSourceOptions, pod: K8sObject, mount: NonNullable<NonNullable<PodSpec['containers']>[number]['volumeMounts']>[number], entries: SourceRequest['entries'], nodeUid: string, fetcher: typeof fetch, pinned: K8sObject[]) {
  const spec = pod['spec'] as PodSpec, claimName = spec.volumes?.find((volume) => volume.name === mount.name)?.persistentVolumeClaim?.claimName;
  if (!claimName || mount.subPath || mount.subPathExpr) throw unavailable('原生数据挂载未绑定可核实的完整 PVC');
  const pvc = await k8s.get(Resources.PersistentVolumeClaim!, claimName, options.namespace), pvcSpec = pvc?.['spec'] as { volumeName?: string } | undefined;
  const pv = pvcSpec?.volumeName ? await k8s.get(Resources.PersistentVolume!, pvcSpec.volumeName) : undefined, pvSpec = pv?.['spec'] as PvSpec | undefined;
  const path = pvSpec?.hostPath?.path ?? pvSpec?.local?.path;
  if (!pvc?.metadata.uid || pvc.metadata.deletionTimestamp || !pv?.metadata.uid || pv.metadata.deletionTimestamp || pvSpec?.claimRef?.uid !== pvc.metadata.uid || pvSpec.claimRef.name !== claimName || pvSpec.claimRef.namespace !== options.namespace
    || pv.metadata.annotations?.['pv.kubernetes.io/provisioned-by'] !== 'rancher.io/local-path' || pv.metadata.annotations?.['local.path.provisioner/selected-node'] !== spec.nodeName || pvSpec.csi || !path || dirname(path) !== options.probeRoot) throw unavailable('原生卷供应器没有独立可观测的物理来源');
  const probe = await probePod(k8s, options, spec.nodeName!), address = (probe['status'] as PodStatus).podIP!, key = `${pvc.metadata.uid}/${pv.metadata.uid}`, started = Date.now();
  const response = await fetcher(`http://${isIP(address) === 6 ? `[${address}]` : address}:${options.probePort}/source`, { method: 'POST', headers: { authorization: `Bearer ${options.probeToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ key, rootId: 'local', directory: basename(path), entries }), signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!response.ok) { await response.body?.cancel(); throw unavailable('独立原生卷来源探针暂不可用'); }
  const observed = SourceResponseSchema.parse(JSON.parse(await boundedMetricsText(response, 16_384)));
  if (observed.key !== key || Date.parse(observed.observedAt) < started - 5000 || Date.parse(observed.observedAt) > Date.now() + 5000 || jsonHash(observed.items.map(({ identity: _identity, ...entry }) => entry)) !== jsonHash(entries)) throw unavailable('原生卷来源回执身份、清单或时间不符');
  pinned.push(pvc, pv, probe);
  return { pvcUid: pvc.metadata.uid, pvUid: pv.metadata.uid, nodeUid, mountPath: mount.mountPath, providerPath: path, rootEpoch: observed.rootIdentity, volumeEpoch: observed.volumeIdentity, entries: observed.items };
}
/** Read-only source adapter. Unknown endpoints, tablespaces and providers block; shared volumes are never removed. */
export function nativePostgresSource(k8s: K8sClient, options: NativePostgresSourceOptions, fetcher: typeof fetch = fetch) {
  const capture = async (connection: NativeSourceConnection) => {
    if (options.probeToken.length < 32 || !posix.isAbsolute(options.probeRoot)) throw unavailable('原生存储来源观测没有配置');
    const before = await sqlSource(connection), service = await k8s.get(Resources.Service!, options.service, options.namespace);
    if (!service?.metadata.uid || service.metadata.deletionTimestamp) throw unavailable('原生 PostgreSQL 服务身份不可用');
    const pod = await serverPod(k8s, options, before.server, service), node = await freshPlatformNode(k8s, pod), spec = pod['spec'] as PodSpec, status = pod['status'] as PodStatus;
    if (!node) throw unavailable('原生服务器节点不可观察');
    const candidates = spec.containers?.filter((container) => container.volumeMounts?.some((mount) => before.server.directory === mount.mountPath || before.server.directory.startsWith(mount.mountPath + '/')));
    if (candidates?.length !== 1) throw unavailable('原生数据目录无法唯一匹配容器挂载');
    const container = candidates[0]!, actual = status.containerStatuses?.find((item) => item.name === container.name);
    if (!actual?.containerID || actual.ready !== true || !actual.state?.running) throw unavailable('原生 PostgreSQL 容器来源不完整');
    const locations = [{ key: 'pgdata', path: before.server.directory, kind: 'directory' as const }, { key: 'control', path: posix.join(before.server.directory, 'global/pg_control'), kind: 'file' as const }, ...before.spaces.map((space) => ({ key: `tablespace:${space.oid}`, path: space.location, kind: 'directory' as const }))];
    const groups = new Map<string, { mount: NonNullable<typeof container.volumeMounts>[number]; entries: SourceRequest['entries'] }>();
    for (const location of locations) {
      const matches = container.volumeMounts?.filter((mount) => location.path.startsWith(mount.mountPath + '/')).sort((left, right) => right.mountPath.length - left.mountPath.length);
      const mount = matches?.[0]; if (!mount || (matches?.[1]?.mountPath.length === mount.mountPath.length)) throw unavailable('原表空间没有唯一可观测的完整挂载');
      const group = groups.get(mount.name) ?? { mount, entries: [] }; group.entries.push({ key: location.key, relativePath: posix.relative(mount.mountPath, location.path), kind: location.kind }); groups.set(mount.name, group);
    }
    const pinned = [service, pod], volumes: Awaited<ReturnType<typeof volumeSource>>[] = [];
    for (const group of [...groups.values()].sort((left, right) => left.mount.mountPath.localeCompare(right.mount.mountPath))) volumes.push(await volumeSource(k8s, options, pod, group.mount, group.entries, node.uid, fetcher, pinned));
    if (jsonHash(before) !== jsonHash(await sqlSource(connection))) throw unavailable('原生服务器在存储观测期间变化');
    const currentServer = await serverPod(k8s, options, before.server, service);
    if (currentServer.metadata.uid !== pod.metadata.uid || currentServer.metadata.resourceVersion !== pod.metadata.resourceVersion) throw unavailable('原生服务器端点在观测期间变化');
    for (const original of pinned) {
      const ref = Resources[original.kind]!, current = await k8s.get(ref, original.metadata.name, original.metadata.namespace);
      if (!original.metadata.resourceVersion || !current || current.metadata.uid !== original.metadata.uid || current.metadata.resourceVersion !== original.metadata.resourceVersion || current.metadata.deletionTimestamp) throw unavailable('原生存储挂载或探针在观测期间变化');
    }
    if ((await freshPlatformNode(k8s, pod))?.uid !== node.uid) throw unavailable('原生存储节点在观测期间变化');
    await connection.assertHeld();
    const { address: _address, port: _port, ...stableServer } = before.server;
    return { identity: jsonHash({ serviceUid: service.metadata.uid, server: stableServer, volumes }), serviceUid: service.metadata.uid, volumes, server: { podUid: pod.metadata.uid!, containerId: actual.containerID, nodeUid: node.uid, address: before.server.address }, observedAt: new Date().toISOString() };
  };
  return { capture, verify: async (connection: NativeSourceConnection, original: { readonly identity: string }) => { if ((await capture(connection)).identity !== original.identity) throw conflict('原生 PostgreSQL 原卷或数据目录已替换', { code: 'native_postgres_source_changed' }); } };
}
