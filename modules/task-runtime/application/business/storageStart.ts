import { newResourceId } from '@crewstation/kernel';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import { podNameFor } from '../../domain/taskEnvironment';

/** Every protected start owns an unreusable consumer and Pod identity. The work PVC stays task-owned. */
export function storageStart(completionPolicy: 'archive-and-delete' | undefined) {
  return completionPolicy ? { completionPolicy, workloadConsumerId: newResourceId() } : {};
}
export function nextStorageStart(env: TaskEnvironment) {
  return env.render?.completionPolicy ? { podName: `${podNameFor(env.id)}-s${env.render.start + 1}` } : {};
}
