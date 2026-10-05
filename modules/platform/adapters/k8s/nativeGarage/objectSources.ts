import { Resources } from '@crewstation/k8s';
import type { K8sClient } from '@crewstation/k8s';
import { precondition } from '@crewstation/kernel';
import { nativeGarageSource } from './source';
import { nodeFileConsumerSource } from '../nodeFileConsumers';

interface GarageAdmin {
  cluster(signal: AbortSignal): Promise<{ node: string; revision: string }>;
  bucket(alias: string, signal: AbortSignal): Promise<{ id: string; created: string }>;
  purgeExclusive(input: { node: string; hash: string; bucketId: string; spaceIds: readonly string[]; versions: readonly string[]; uploads: readonly string[] }, signal: AbortSignal, authorize: () => Promise<void>): Promise<{ kind: 'shared' } | { kind: 'acknowledged'; digest: string; physicalReclamationProven: false }>;
}
type Probe = { probeRoot: string; probePort: number; probeToken: string };
const GARAGE_IMAGE = 'sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020';
/** Root supplies the private data-control transports. Neither credentials nor
 * physical effects are exposed through a public API or source inventory. */
export function nativeProjectObjectSources<T>(k8s: K8sClient, namespace: string, probe: Probe | undefined, objects: T, createAdmin: (config: { endpoint: string; token: string }) => GarageAdmin) {
  if (!probe || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(namespace)) throw precondition('项目对象删除缺少原平台 namespace 或节点来源');
  const host = `garage.${namespace}.svc.cluster.local`;
  const transport = async () => {
    const secret = await k8s.get(Resources.Secret!, 'garage-credentials', namespace, AbortSignal.timeout(10_000));
    const encoded = (secret?.['data'] as Record<string, string> | undefined)?.['GARAGE_ADMIN_TOKEN'];
    if (!secret?.metadata.uid || secret.metadata.deletionTimestamp || !encoded) throw precondition('Garage 原私有管理凭据不可读取');
    const token = Buffer.from(encoded, 'base64').toString('utf8');
    return createAdmin({ endpoint: `http://${host}:3903`, token });
  };
  const garage: GarageAdmin = {
    cluster: async signal => (await transport()).cluster(signal), bucket: async (alias, signal) => (await transport()).bucket(alias, signal),
    purgeExclusive: async (input, signal, authorize) => (await transport()).purgeExclusive(input, signal, authorize),
  };
  return { source: nativeGarageSource(k8s, { namespace, service: 'garage', container: 'garage', port: 3903, imageDigest: GARAGE_IMAGE, ...probe }),
    consumers: nodeFileConsumerSource(k8s, { namespace, port: probe.probePort, token: probe.probeToken }), garage, objects, s3Endpoint: `http://${host}:3900` };
}
