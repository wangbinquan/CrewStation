import { dirname, isAbsolute } from 'node:path';
import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { RegistrySourceOptions } from '../nativeRegistry/origin';

export interface BuildKitSourceOptions extends RegistrySourceOptions {
  mountPath: string; args: readonly string[]; configMap: string; configIdentity: string;
}
interface Mount { name: string; mountPath: string; subPath?: string; subPathExpr?: string; readOnly?: boolean }
interface Container { name: string; command?: string[]; args?: string[]; env?: unknown[]; envFrom?: unknown[]; volumeMounts?: Mount[] }
const unavailable = (message: string) => precondition(message, { code: 'native_buildkit_source_unavailable' });
export function buildKitSourceOptions(raw: BuildKitSourceOptions) {
  const options = structuredClone(raw);
  if (options.probeToken.length < 32 || !isAbsolute(options.probeRoot) || !isAbsolute(options.mountPath)
    || !/^sha256:[a-f0-9]{64}$/.test(options.imageDigest) || !/^[a-f0-9]{64}$/.test(options.configIdentity)
    || !options.args.length || !options.configMap || ![options.port, options.probePort].every(port => Number.isInteger(port) && port > 0 && port <= 65535)) throw unavailable('原 BuildKit 固定安装配置不完整');
  return options;
}
/** Original full-volume rootless installation, pinned to the deployer's actual
 * argument and ConfigMap content. A caller cannot select a path or daemon. */
export async function buildKitStorage(k8s: K8sClient, options: BuildKitSourceOptions, pod: K8sObject, signal: AbortSignal) {
  const spec = pod['spec'] as { nodeName?: string; containers?: Container[]; volumes?: Array<{ name: string; persistentVolumeClaim?: { claimName: string }; configMap?: { name: string } }> };
  const status = pod['status'] as { containerStatuses?: Array<{ name: string; containerID?: string; imageID?: string; ready?: boolean; state?: { running?: unknown } }> };
  const containers = spec.containers?.filter(row => row.name === options.container), container = containers?.[0], runtime = status.containerStatuses?.find(row => row.name === options.container);
  if (containers?.length !== 1 || !container || container.command?.length || jsonHash(container.args ?? []) !== jsonHash(options.args)
    || container.env?.length || container.envFrom?.length || !runtime?.ready || !runtime.state?.running || !/^[a-z0-9]+:\/\/[a-f0-9]{64}$/.test(runtime.containerID ?? '')
    || !runtime.imageID?.endsWith('@' + options.imageDigest)) throw unavailable('原 BuildKit 镜像、入口、环境或运行实例变化');
  const configVolumes = spec.volumes?.filter(row => row.configMap?.name === options.configMap);
  if (configVolumes?.length !== 1 || !container.volumeMounts?.some(row => row.name === configVolumes[0]!.name && row.readOnly && !row.subPath && !row.subPathExpr)) throw unavailable('原 BuildKit 配置不是完整只读挂载');
  const config = await k8s.get(Resources.ConfigMap!, options.configMap, options.namespace, signal);
  if (!config?.metadata.uid || config.metadata.deletionTimestamp || jsonHash(config['data'] ?? {}) !== options.configIdentity || config['binaryData']) throw unavailable('原 BuildKit 配置来源变化');
  const mounts = container.volumeMounts?.filter(row => row.mountPath === options.mountPath), mount = mounts?.[0];
  if (mounts?.length !== 1 || !mount || mount.readOnly || mount.subPath || mount.subPathExpr || container.volumeMounts?.some(row => row.mountPath.startsWith(options.mountPath + '/'))) throw unavailable('原 BuildKit 缓存不是完整独占挂载');
  const claimName = spec.volumes?.find(row => row.name === mount.name)?.persistentVolumeClaim?.claimName;
  const pvc = claimName ? await k8s.get(Resources.PersistentVolumeClaim!, claimName, options.namespace, signal) : undefined;
  const volumeName = (pvc?.['spec'] as { volumeName?: string } | undefined)?.volumeName;
  const pv = volumeName ? await k8s.get(Resources.PersistentVolume!, volumeName, undefined, signal) : undefined;
  const volume = pv?.['spec'] as { claimRef?: { uid?: string; name?: string; namespace?: string }; hostPath?: { path: string }; local?: { path: string }; csi?: unknown } | undefined;
  if (!pvc?.metadata.uid || pvc.metadata.deletionTimestamp || !pv?.metadata.uid || pv.metadata.deletionTimestamp || volume?.claimRef?.uid !== pvc.metadata.uid
    || volume.claimRef.name !== claimName || volume.claimRef.namespace !== options.namespace) throw unavailable('原 BuildKit PVC/PV 绑定变化');
  const path = volume.hostPath?.path ?? volume.local?.path;
  if (volume.csi || pv.metadata.annotations?.['pv.kubernetes.io/provisioned-by'] !== 'rancher.io/local-path'
    || !path || dirname(path) !== options.probeRoot || pv.metadata.annotations?.['local.path.provisioner/selected-node'] !== spec.nodeName) throw unavailable('原 BuildKit 物理卷供应器或节点不可核实');
  return { config, pvc, pv, path, containerId: runtime.containerID!, imageId: runtime.imageID! };
}
