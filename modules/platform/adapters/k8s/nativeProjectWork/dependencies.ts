import type { NativeScmPort } from './bindings';
import type { Database } from '@crewstation/persistence';
import type { PlatformSettings } from '@crewstation/settings';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import { nativeScmDeletionSources } from '../../scm/nativeSources';
import { nativeRegistryArtifacts } from '../nativeRegistry/artifacts';
import { nativeProjectObjectSources } from '../nativeGarage/objectSources';
import { nativeRuntimeProjectWork } from './runtime';
import { nativeReleaseProjectWork } from './release';
import type { NativeWorkOptions } from './bindings';

/** Construct production physical owners from fixed installed native sources.
 * Late getters refer to actual module factories; no test/empty owner fallback. */
export function prepareInstalledNativeDeletion(input: Pick<NativeWorkOptions, 'k8s' | 'project' | 'resources' | 'cluster'> & {
  db: Database; settings: PlatformSettings; scm(): NativeScmPort;
}) {
  const { db, k8s, settings } = input, native = settings.projectDeletionNative, metrics = settings.clusterMetrics;
  if (!native?.registry || !native.work) return undefined;
  if (!metrics || metrics.probeToken.length < 32 || !metrics.probeRoot || !settings.platformPodUid) throw precondition('永久删除缺少原节点探针、根路径或平台 Pod 出生来源');
  const assertGrant = (context: ProjectDeletionContext) => input.project().assertProjectDeletionGrant(context);
  const scmSources = nativeScmDeletionSources({ ...native.gitlab, gitlabUrl: settings.gitlab.baseUrl, gitlabToken: settings.gitlab.platformToken, assertGrant });
  const consumerBirth = { baseUrl: native.registry.baseUrl, token: native.registry.token };
  const sourceOptions = { namespace: settings.systemNamespace, probePort: metrics.probePort, probeRoot: metrics.probeRoot, probeToken: metrics.probeToken, consumerBirth };
  const artifacts = nativeRegistryArtifacts(k8s, { ...sourceOptions, service: 'registry', container: 'registry', port: 5000, imageDigest: native.work.registry.imageDigest });
  const workOptions: NativeWorkOptions = { k8s, systemNamespace: settings.systemNamespace, probePort: metrics.probePort, probeToken: metrics.probeToken, consumerBirth, project: input.project, resources: input.resources, cluster: input.cluster };
  return { assertGrant, scmSources, artifacts, images: nativeRuntimeProjectWork(workOptions),
    release: nativeReleaseProjectWork({ ...workOptions, db, scm: input.scm, gitlab: scmSources.rest, registryBase: settings.registryBase,
      installation: { ...sourceOptions, service: 'buildkitd', container: 'buildkitd', port: 1234, mountPath: '/home/user/.local/share/buildkit', configMap: 'buildkitd-config', ...native.work.buildkit } }),
    objects: <T>(objects: T, garage: Parameters<typeof nativeProjectObjectSources>[4]) => nativeProjectObjectSources(k8s, settings.systemNamespace, metrics, objects, garage),
  };
}
