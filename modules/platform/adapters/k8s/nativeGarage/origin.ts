import { dirname, posix } from 'node:path';
import { Resources } from '@crewstation/k8s';
import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { jsonHash, precondition } from '@crewstation/kernel';

export const garageUnavailable = (message: string) => precondition(message, { code: 'native_garage_source_unavailable' });
export interface GarageSourceOptions { namespace: string; service: string; port: number; container: string; imageDigest: string; probeRoot: string; probePort: number; probeToken: string }
interface Mount { name: string; mountPath: string; readOnly?: boolean; subPath?: string; subPathExpr?: string }
interface Container { name: string; command?: string[]; args?: string[]; volumeMounts?: Mount[]; env?: Array<{ name: string }>; envFrom?: Array<{ prefix?: string; secretRef?: { name: string }; configMapRef?: unknown }> }
interface Spec { nodeName?: string; containers?: Container[]; volumes?: Array<{ name: string; persistentVolumeClaim?: { claimName: string }; configMap?: { name: string }; secret?: unknown }> }
interface Status { containerStatuses?: Array<{ name: string; containerID?: string; imageID?: string; ready?: boolean; state?: { running?: { startedAt?: string } } }> }

/** Current local Garage format is supported only at the verified standard
 * single-node entry point, with its actual mounted config and both full PVCs. */
export async function garageStorage(k8s: K8sClient, options: GarageSourceOptions, pod: K8sObject, signal: AbortSignal) {
  const spec = pod['spec'] as Spec, status = pod['status'] as Status, containers = spec.containers?.filter(c => c.name === options.container), container = containers?.[0];
  const actual = status.containerStatuses?.find(c => c.name === options.container);
  if (containers?.length !== 1 || !container || JSON.stringify(container.command) !== '["/garage"]'
    || JSON.stringify(container.args) !== '["server","--single-node","--default-bucket"]' || !actual?.ready || !actual.state?.running
    || !actual.containerID || !actual.imageID?.endsWith('@' + options.imageDigest)) throw garageUnavailable('Garage 原运行镜像或标准启动参数不可核实');
  if (container.env?.some(row => /^GARAGE_(METADATA_DIR|DATA_DIR|DB_ENGINE|CONFIG_FILE|REPLICATION_FACTOR)$/.test(row.name))) throw garageUnavailable('Garage 存储配置被环境变量覆盖');
  const configs = container.volumeMounts?.filter(mount => mount.mountPath === '/etc/garage.toml'), config = configs?.[0];
  const configName = spec.volumes?.find(volume => volume.name === config?.name)?.configMap?.name;
  const source = configName ? await k8s.get(Resources.ConfigMap!, configName, options.namespace, signal) : undefined;
  const text = source?.['data'] as Record<string, string> | undefined;
  if (configs?.length !== 1 || !config?.readOnly || config.subPath !== 'garage.toml' || config.subPathExpr || !source?.metadata.uid
    || source.metadata.deletionTimestamp || !text?.['garage.toml']) throw garageUnavailable('Garage 原配置文件挂载不可核实');
  originalGarageConfig(source, actual.state.running.startedAt);
  const envSource = container.envFrom?.[0];
  if (container.envFrom?.length !== 1 || !envSource?.secretRef?.name || envSource.configMapRef || envSource.prefix) throw garageUnavailable('Garage 原启动环境来源不可核实');
  const credentials = await k8s.get(Resources.Secret!, envSource.secretRef.name, options.namespace, signal);
  if (!credentials?.metadata.uid || credentials.metadata.deletionTimestamp) throw garageUnavailable('Garage 原启动环境来源不可核实');
  originalGarageConfig(credentials, actual.state.running.startedAt);
  const variables = Object.keys(credentials['data'] as object ?? {});
  if (variables.some(name => !['GARAGE_DEFAULT_ACCESS_KEY', 'GARAGE_DEFAULT_SECRET_KEY', 'GARAGE_DEFAULT_BUCKET', 'GARAGE_RPC_SECRET', 'GARAGE_ADMIN_TOKEN', 'GARAGE_METRICS_TOKEN'].includes(name))) throw garageUnavailable('Garage 原启动环境包含未核实的配置覆盖');
  const parsed = Bun.TOML.parse(text['garage.toml']) as { metadata_dir?: unknown; data_dir?: unknown; db_engine?: unknown; replication_factor?: unknown; consistency_mode?: unknown; admin?: { api_bind_addr?: unknown } };
  if (parsed.db_engine !== 'sqlite' || parsed.replication_factor !== 1 || parsed.consistency_mode !== 'consistent'
    || parsed.admin?.api_bind_addr !== '0.0.0.0:' + options.port || typeof parsed.metadata_dir !== 'string' || typeof parsed.data_dir !== 'string'
    || parsed.metadata_dir === parsed.data_dir) throw garageUnavailable('Garage 原数据库格式、节点复制范围或存储根不受支持');
  const metadata = await mountedGarageVolume(k8s, options, pod, container, parsed.metadata_dir, signal);
  const data = await mountedGarageVolume(k8s, options, pod, container, parsed.data_dir, signal);
  if (metadata.pvc.metadata.uid === data.pvc.metadata.uid || metadata.pv.metadata.uid === data.pv.metadata.uid) throw garageUnavailable('Garage 元数据和块来源卷不能混用');
  return { metadata, data, config: source, credentials, configIdentity: jsonHash({ uid: source.metadata.uid, contents: text['garage.toml'], credentialsUid: credentials.metadata.uid, variables }), containerId: actual.containerID, imageId: actual.imageID };
}
function originalGarageConfig(source: K8sObject, startedAt?: string) {
  const metadata = source.metadata as typeof source.metadata & { creationTimestamp?: string; managedFields?: Array<{ time?: string }> };
  const started = Date.parse(startedAt ?? ''), created = Date.parse(metadata.creationTimestamp ?? ''), times = metadata.managedFields?.map(row => Date.parse(row.time ?? ''));
  if (!Number.isFinite(started) || !Number.isFinite(created) || created > started || !times?.length || times.some(time => !Number.isFinite(time) || time > started)) throw garageUnavailable('Garage 配置来源缺少原启动前的完整记录；当前同名配置不能补造原进程事实');
}
async function mountedGarageVolume(k8s: K8sClient, options: GarageSourceOptions, pod: K8sObject, container: Container, root: string, signal: AbortSignal) {
  const spec = pod['spec'] as Spec, mounts = container.volumeMounts?.filter(mount => mount.mountPath === root), mount = mounts?.[0];
  if (!posix.isAbsolute(root) || mounts?.length !== 1 || !mount || mount.subPath || mount.subPathExpr || mount.readOnly
    || container.volumeMounts?.some(value => value.mountPath.startsWith(root + '/'))) throw garageUnavailable('Garage 原存储必须为完整独立卷挂载');
  const claim = spec.volumes?.find(volume => volume.name === mount.name)?.persistentVolumeClaim?.claimName;
  const pvc = claim ? await k8s.get(Resources.PersistentVolumeClaim!, claim, options.namespace, signal) : undefined;
  const pvcSpec = pvc?.['spec'] as { volumeName?: string } | undefined;
  const pv = pvcSpec?.volumeName ? await k8s.get(Resources.PersistentVolume!, pvcSpec.volumeName, undefined, signal) : undefined;
  const native = pv?.['spec'] as { claimRef?: { uid?: string; name?: string; namespace?: string }; hostPath?: { path: string }; local?: { path: string }; csi?: unknown } | undefined;
  if (!pvc?.metadata.uid || pvc.metadata.deletionTimestamp || !pv?.metadata.uid || pv.metadata.deletionTimestamp || native?.claimRef?.uid !== pvc.metadata.uid
    || native.claimRef.name !== claim || native.claimRef.namespace !== options.namespace || native.csi
    || pv.metadata.annotations?.['pv.kubernetes.io/provisioned-by'] !== 'rancher.io/local-path') throw garageUnavailable('Garage 原 PVC/PV 或供应器不可核实');
  const path = native.hostPath?.path ?? native.local?.path;
  if (!path || dirname(path) !== options.probeRoot || pv.metadata.annotations?.['local.path.provisioner/selected-node'] !== spec.nodeName) throw garageUnavailable('Garage 原卷物理位置或节点变化');
  return { pvc, pv, path, mountPath: root };
}
