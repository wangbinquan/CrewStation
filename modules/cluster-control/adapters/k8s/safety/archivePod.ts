import { businessStoragePaths, TaskIdSchema } from '@crewstation/contracts';
import { platformLabels, LABELS } from '@crewstation/k8s';
import type { K8sObject } from '@crewstation/k8s';
import { precondition } from '@crewstation/kernel';
import type { WorkloadPodRender } from '../../../domain/workloadRender';
import { protectWorkloadPod } from './workloadGate';

/** Fixed, non-root reader: it never mounts the volume root, journals, native sessions or application credentials. */
export function archivePodObject(pod: WorkloadPodRender): K8sObject {
  const ownerTaskId = TaskIdSchema.parse(pod.archive?.ownerTaskId);
  if (!pod.pvc || !pod.expectedVolumeUid || pod.expectedVolumeUid !== pod.consumerVolumeUid || pod.consumer?.purpose !== 'archive' || pod.consumer.taskId !== ownerTaskId
    || !pod.consumer.finalization || !/^[^\s@]+@sha256:[a-f0-9]{64}$/.test(pod.image) || !Number.isSafeInteger(pod.workerUid) || pod.workerUid <= 0
    || pod.businessStorage || pod.checkout || pod.workspace || pod.emptyDir) throw precondition('归档助手期望不完整或含非归档权限');
  const securityContext = { runAsUser: pod.workerUid, runAsGroup: pod.workerUid, runAsNonRoot: true, allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } };
  const binding = pod.archive?.bindOnly === true;
  const object: K8sObject = {
    apiVersion: 'v1', kind: 'Pod', metadata: { name: pod.name, namespace: pod.namespace,
      labels: platformLabels({ [LABELS.project]: pod.project, [LABELS.service]: pod.service, [LABELS.workload]: 'archive-helper', [LABELS.task]: pod.taskId, 'crewstation.io/workspace-task': ownerTaskId }),
      annotations: { ...pod.annotations } },
    spec: {
      automountServiceAccountToken: false, restartPolicy: 'Never', activeDeadlineSeconds: 2700, terminationGracePeriodSeconds: 30,
      securityContext: { seccompProfile: { type: 'RuntimeDefault' } },
      containers: [{ name: 'archive', image: pod.image, imagePullPolicy: 'IfNotPresent', command: binding ? ['/bin/true'] : ['/usr/bin/tini', '--', '/opt/crewstation/bin/archive-helper'], workingDir: '/tmp', securityContext,
        env: binding ? [] : ['CS_ARCHIVE_URL', 'CS_ARCHIVE_TOKEN'].map((name) => ({ name, valueFrom: { secretKeyRef: { name: pod.secret, key: name } } })),
        resources: { requests: { cpu: '100m', memory: '256Mi', 'ephemeral-storage': '32Mi' }, limits: { cpu: '1', memory: '256Mi', 'ephemeral-storage': '32Mi' } },
        volumeMounts: [...(binding ? [] : [{ name: 'work', mountPath: '/work', subPath: businessStoragePaths(ownerTaskId, pod.taskId).work, readOnly: true }]), { name: 'scratch', mountPath: '/tmp' }],
      }],
      volumes: [{ name: 'work', persistentVolumeClaim: { claimName: pod.pvc, readOnly: true } }, { name: 'scratch', emptyDir: { sizeLimit: '16Mi' } }],
    },
  };
  // Scheduling follows the PVC's topology; a parent Pod or original node need not still exist.
  return protectWorkloadPod(object, pod);
}
