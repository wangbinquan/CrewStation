import type { RuntimeImageBuildRender } from '@crewstation/contracts';
import type { ImageBuild } from '../../domain/records';
import type { BuildObservation } from '../../ports/buildExecutor';
import type { BuildClusterSnapshot } from './buildSnapshot';

/** Pod 身份由集群对象确认；脚本只能提供 digest，不能选择读取任意仓库。 */
export function observeImageBuild(build: ImageBuild, plan: RuntimeImageBuildRender, snapshot: BuildClusterSnapshot, created: boolean): BuildObservation {
  const common = { resourceId: plan.resourceId };
  if (snapshot.pods.length > 1) return { ...common, state: 'unknown', error: '同一构建出现多个 Pod，等待回收' };
  const pod = snapshot.pods[0];
  if (!pod) return { ...common, state: build.podUid || (created && !snapshot.job) ? 'unknown' : 'pending' };
  const podUid = pod.metadata.uid!;
  if (build.podUid && build.podUid !== podUid) return { ...common, state: 'unknown', error: '原构建 Pod 已被替换' };
  if (snapshot.job && !pod.metadata.ownerReferences?.some((r) => r.kind === 'Job' && r.uid === snapshot.job!.metadata.uid && r.controller)) return { ...common, state: 'unknown', error: '构建 Pod 不属于原 Job' };
  const identified = { ...common, podUid };
  const statuses = [...(pod.status?.initContainerStatuses ?? []), ...(pod.status?.containerStatuses ?? [])];
  if (statuses.some((s) => s.state?.terminated && s.state.terminated.exitCode !== 0) || pod.status?.phase === 'Failed') return { ...identified, state: 'failed', error: '构建容器执行失败，请查看构建日志' };
  const client = pod.status?.containerStatuses?.find((s) => s.name === 'buildctl')?.state?.terminated;
  if (client?.exitCode === 0) {
    try {
      const metadata: unknown = JSON.parse(client.message ?? '');
      const digest = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>)['containerimage.digest'] : undefined;
      if (typeof digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error('digest');
      return { ...identified, state: 'succeeded', receipt: { buildId: build.id, executionEpoch: build.executionEpoch, podUid, reference: `${plan.repository}@${digest}` } };
    } catch { return { ...identified, state: 'failed', error: '构建未返回有效产物摘要' }; }
  }
  return { ...identified, state: pod.status?.phase === 'Running' ? 'running' : 'pending' };
}
