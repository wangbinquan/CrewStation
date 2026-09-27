import type { RuntimeImageBuildRender } from '@crewstation/contracts';
import type { K8sClient } from '@crewstation/k8s';
import { precondition } from '@crewstation/kernel';
import type { LeasePort } from '@crewstation/resource-runtime';
import { withLease } from '@crewstation/resource-runtime';
import type { ImageBuild, ImageRevision } from '../../domain/records';
import type { RuntimeBuildCredentials } from '../../ports/buildCredentials';
import type { BuildArtifactReceipt, BuildObservation, RuntimeImageBuildExecutor } from '../../ports/buildExecutor';
import type { RuntimeBuildIntents, RuntimeBuildLedger } from '../../ports/buildLedger';
import type { RuntimeImageRegistry } from '../../ports/registry';
import { readBuildSnapshot } from './buildSnapshot';
import { observeImageBuild } from './buildObservation';
import { readImageBuildLogs } from './buildLogs';

export interface KubernetesImageBuildDeps {
  readonly k8s: K8sClient; readonly intents: RuntimeBuildIntents; readonly ledger: RuntimeBuildLedger;
  readonly leases: LeasePort; readonly holder: string; readonly credentials: RuntimeBuildCredentials;
  readonly registry: RuntimeImageRegistry; readonly registryBase: string;
  plan(build: ImageBuild, revision: ImageRevision): Promise<RuntimeImageBuildRender>;
}

async function observe(deps: KubernetesImageBuildDeps, build: ImageBuild, plan: RuntimeImageBuildRender, signal: AbortSignal): Promise<BuildObservation> {
  const record = await deps.ledger.get(plan.resourceId);
  if (!record || record.desired !== 'present') return { resourceId: plan.resourceId, state: 'unknown' };
  const snapshot = await readBuildSnapshot(deps.k8s, plan, signal);
  const result = observeImageBuild(build, plan, snapshot, record.conditions.some((c) => c.type === 'Created' && c.status === 'true'));
  const pod = snapshot.pods.find((p) => p.metadata.uid === result.podUid);
  const logs = pod ? await readImageBuildLogs(deps.k8s, pod, snapshot.secret, build.logCursor, signal) : undefined;
  return { ...result, ...(logs ? { logs } : {}) };
}

async function stop(deps: KubernetesImageBuildDeps, build: ImageBuild, revision: ImageRevision): Promise<BuildObservation> {
  const resourceId = build.resourceId!, unknown: BuildObservation = { resourceId, state: 'unknown' };
  // 与 cluster-control 共用租约，不能一边确认删除，一边由旧快照重建对象。
  const result = await withLease(deps.leases, resourceId, `${deps.holder}/${build.id}`, 30000, async (leaseSignal) => {
    const signal = AbortSignal.any([leaseSignal, AbortSignal.timeout(20000)]);
    if (!await deps.intents.stop(build)) return unknown;
    const current = await deps.intents.get(build.id);
    if (!current || current.epoch !== build.epoch) return unknown;
    if (current.resourcePlan) {
      const snapshot = await readBuildSnapshot(deps.k8s, current.resourcePlan, signal);
      if (snapshot.job || snapshot.secret || snapshot.pods.length) return { resourceId, state: 'running' as const };
    }
    // 不仅删除 Secret，还主动撤销 GitLab 的短期只读 token；失败保留容量重试。
    for (const credentialId of current.gitCredentialIds ?? []) { signal.throwIfAborted(); await deps.credentials.revokeGit(revision, credentialId); }
    signal.throwIfAborted();
    return { resourceId, state: 'stopped' as const };
  });
  return result.acquired ? result.value : unknown;
}

function exactRepository(reference: string, registryBase: string): string {
  if (!reference.startsWith(`${registryBase}/`)) throw precondition('产物不在平台仓库');
  return reference.slice(registryBase.length + 1).split('@')[0]!.replace(/:[^/]*$/, '');
}
async function inspect(deps: KubernetesImageBuildDeps, build: ImageBuild, revision: ImageRevision, receipt?: BuildArtifactReceipt) {
  const current = await deps.intents.get(build.id), plan = current?.resourcePlan;
  let reference: string;
  if (revision.source.kind === 'existing') reference = revision.source.reference;
  else {
    if (!plan || !receipt || receipt.buildId !== build.id || receipt.executionEpoch !== build.executionEpoch || receipt.podUid !== current?.podUid || !receipt.reference.startsWith(`${plan.repository}@sha256:`)) throw precondition('产物回执不属于本次构建');
    reference = receipt.reference;
  }
  const architecture = revision.source.architecture;
  const image = await deps.registry.inspect(reference, architecture, { exact: [exactRepository(reference, deps.registryBase)] });
  const base = revision.baseImage ? await deps.registry.inspect(revision.baseImage, architecture, { exact: [exactRepository(revision.baseImage, deps.registryBase)] }) : undefined;
  return { image, ...(base ? { base } : {}) };
}

export function kubernetesRuntimeImageBuildExecutor(deps: KubernetesImageBuildDeps): RuntimeImageBuildExecutor {
  return {
    reconcile: async (build, revision, desired) => {
      if (revision.source.kind !== 'source' || !build.resourceId) throw precondition('源码构建资源身份缺失');
      if (desired === 'stop') return stop(deps, build, revision);
      const plan = build.resourcePlan ?? await deps.plan(build, revision);
      if (plan.buildId !== build.id || plan.resourceId !== build.resourceId || plan.executionEpoch !== build.executionEpoch) throw precondition('构建计划身份不匹配');
      if (!await deps.intents.declare(build, plan)) return { resourceId: build.resourceId, state: 'unknown' };
      const current = await deps.intents.get(build.id);
      if (!current?.resourcePlan) return { resourceId: build.resourceId, state: 'unknown' };
      return observe(deps, current, current.resourcePlan, AbortSignal.timeout(20000));
    },
    inspect: (build, revision, receipt) => inspect(deps, build, revision, receipt),
  };
}
