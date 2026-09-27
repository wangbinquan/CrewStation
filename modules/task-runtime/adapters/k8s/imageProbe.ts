import type { LeasePort } from '@crewstation/resource-runtime';
import { withLease } from '@crewstation/resource-runtime';
import type { K8sClient } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import { runnerSecretOf, type TaskEnvironment } from '../../domain/taskEnvironment';

export function imageProbeObjectsGone(k8s: K8sClient) {
  return async (env: TaskEnvironment, signal: AbortSignal): Promise<boolean> => {
    const [pod, secret] = await Promise.all([
      k8s.get(Resources.Pod!, env.podName, env.namespace, signal),
      k8s.get(Resources.Secret!, env.render ? runnerSecretOf({ ...env, render: env.render }) : `${env.podName}-runner`, env.namespace, signal),
    ]);
    signal.throwIfAborted();
    return !pod && !secret;
  };
}

export function imageProbeCleanup(k8s: K8sClient, leases: LeasePort, holder: string) {
  return {
    objectsGone: imageProbeObjectsGone(k8s),
    exclusive: <T>(id: string, run: (signal: AbortSignal) => Promise<T>) => withLease(leases, id, `${holder}/${id}`, 30000, run),
  };
}
