import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { LABELS, MANAGED_BY, Resources } from '@crewstation/k8s';
import type { Logger } from '@crewstation/kernel';
import type { ObservedPod } from '../application/podIdentities';

type PodObject = K8sObject & { status?: { podIP?: string; phase?: string } };

export interface PodWatcher {
  start(): void;
  stop(): Promise<void>;
  /** 全量同步一次（启动与断线后）。 */
  runOnce(): Promise<number>;
}

/**
 * list 全量后 watch 增量；watch 结束或出错即退避重连，从最新 resourceVersion 续接。
 * `relist` 给出时全量那一步交给它（同步并清掉这次没列到的旧行），否则逐个 `sync`。
 */
export function podWatcher(k8s: K8sClient, sync: (pod: ObservedPod) => Promise<void>, logger: Logger, relist?: (pods: readonly ObservedPod[]) => Promise<number>): PodWatcher {
  const selector = `${LABELS.managedBy}=${MANAGED_BY}`;
  let controller: AbortController | undefined;
  let running = false;
  let loop: Promise<void> | undefined;

  const observe = (pod: PodObject, deleted: boolean): ObservedPod => ({
    name: pod.metadata.name, namespace: pod.metadata.namespace ?? 'default', labels: pod.metadata.labels ?? {}, deleted,
    ...(pod.status?.podIP ? { ip: pod.status.podIP } : {}), ...(pod.status?.phase ? { phase: pod.status.phase } : {}),
  });

  const runOnce = async (): Promise<number> => {
    const pods = await k8s.list<PodObject>(Resources.Pod!, undefined, { labelSelector: selector });
    const observed = pods.map((pod) => observe(pod, Boolean(pod.metadata.deletionTimestamp)));
    if (!relist) for (const pod of observed) await sync(pod);
    else {
      const pruned = await relist(observed);
      if (pruned > 0) logger.info('pod identities pruned after relist', { pruned });
    }
    return pods.length;
  };

  const watchLoop = async (): Promise<void> => {
    let delay = 1000;
    while (running) {
      controller = new AbortController();
      try {
        await runOnce();
        delay = 1000;
        await k8s.watch<PodObject>(Resources.Pod!, undefined, { labelSelector: selector, signal: controller.signal }, (type, pod) => {
          if (type === 'BOOKMARK' || type === 'ERROR') return;
          void sync(observe(pod, type === 'DELETED')).catch((error: unknown) => logger.error('pod sync failed', { error: String(error) }));
        });
      } catch (error) {
        if (running) logger.warn('pod watch interrupted', { error: String(error), retryMs: delay });
      }
      if (running) { await Bun.sleep(delay); delay = Math.min(delay * 2, 30000); }
    }
  };

  return {
    start: () => { if (!running) { running = true; loop = watchLoop(); } },
    stop: async () => { running = false; controller?.abort(); await loop; },
    runOnce,
  };
}
