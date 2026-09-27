import type { BusinessStorage } from '@crewstation/contracts';
import { BusinessStorageSchema, BUSINESS_JOURNAL_ENV, BUSINESS_JOURNAL_MOUNT, BUSINESS_SESSION_ENV, BUSINESS_SESSION_MOUNT, businessStoragePaths, businessSessionPath } from '@crewstation/contracts';
import type { ContainerSpec, VolumeSpec } from './workloads';

export function businessStorageMounts(input: { taskId: string; image: string; workerUid: number; pvc: string; storage: BusinessStorage }) {
  const storage = BusinessStorageSchema.parse(input.storage), paths = businessStoragePaths(storage.ownerTaskId, input.taskId);
  if (storage.initialize && storage.ownerTaskId !== input.taskId) throw new Error('只有父任务首次启动可以初始化业务卷');
  if (storage.session && (storage.ownerTaskId === input.taskId || (storage.session.mode === 'create' && storage.session.key !== input.taskId))) throw new Error('原生会话目录必须绑定独立 Agent 执行身份');
  if (!Number.isSafeInteger(input.workerUid) || input.workerUid < 1) throw new Error('业务 worker UID 必须为非 root 正整数');
  const volumes: VolumeSpec[] = [
    { name: 'work', mountPath: '/work', subPath: paths.work, pvc: input.pvc },
    { name: 'work', mountPath: BUSINESS_JOURNAL_MOUNT, subPath: paths.journal, pvc: input.pvc },
  ];
  if (storage.session) volumes.push({ name: 'work', mountPath: BUSINESS_SESSION_MOUNT, subPath: businessSessionPath(storage.ownerTaskId, storage.session.key), pvc: input.pvc });
  const init: ContainerSpec = { name: 'prepare-business-volume', image: input.image, runAsUser: 0,
    command: ['/opt/crewstation/bin/task-runner', 'prepare-business-volume', '/cs-volume', storage.ownerTaskId, input.taskId, String(input.workerUid), storage.initialize ? 'initialize' : 'existing', ...(storage.session ? [storage.session.key, storage.session.mode] : [])],
    volumes: [{ name: 'work', mountPath: '/cs-volume' }], resources: { cpu: '100m', memory: '128Mi' } };
  return { volumes, init, env: [{ name: BUSINESS_JOURNAL_ENV, value: BUSINESS_JOURNAL_MOUNT }, ...(storage.session ? [{ name: BUSINESS_SESSION_ENV, value: BUSINESS_SESSION_MOUNT }] : [])] };
}
