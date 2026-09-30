import { jsonHash } from '@crewstation/kernel';
import { Resources, type K8sClient } from '@crewstation/k8s';
import { protectedPlatformPodStopped } from './platformPodTermination';

export const OBJECT_TRANSFER_FINALIZER = 'crewstation.io/object-transfer-stop';
/** Retain the actual Pod until data has durably released its reads; unknown writes remain independently protected. */
export function objectTransferOwners(k8s: K8sClient, namespace: string, podUid?: string) {
  return { ...(podUid ? { podUid } : {}), sweep: async (accept: (uid: string, digest: string) => Promise<void>) => {
    let cursor: string | undefined;
    do {
      const page = await k8s.listPage(Resources.Pod!, namespace, { labelSelector: 'app.kubernetes.io/name=cs-api,app.kubernetes.io/part-of=crewstation', limit: 100, ...(cursor ? { continue: cursor } : {}) });
      for (const pod of page.items) {
        if (!await protectedPlatformPodStopped(k8s,pod,OBJECT_TRANSFER_FINALIZER)) continue;
        await accept(pod.metadata.uid!, jsonHash({ uid: pod.metadata.uid, status: pod['status'] }));
        await k8s.jsonPatch(Resources.Pod!, pod.metadata.name, namespace, [
          { op: 'test', path: '/metadata/uid', value: pod.metadata.uid }, { op: 'test', path: '/metadata/resourceVersion', value: pod.metadata.resourceVersion },
          { op: 'replace', path: '/metadata/finalizers', value: pod.metadata.finalizers!.filter((f) => f !== OBJECT_TRANSFER_FINALIZER) },
        ]);
      }
      cursor = page.continue || undefined;
    } while (cursor);
  } };
}
