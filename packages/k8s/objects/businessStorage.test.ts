import { expect, test } from 'bun:test';
import { BUSINESS_JOURNAL_ENV, BUSINESS_JOURNAL_MOUNT, businessStoragePaths, TaskIdSchema } from '@crewstation/contracts';
import { taskPodObject } from './task';

const taskId = TaskIdSchema.parse('01a0bf5d-8f4b-7001-8458-107366e7de39'), childId = '01a0bf5d-8f4b-7001-8458-107366e7de40';
const input = { name: 'parent', namespace: 'cs-demo', taskId, workload: 'business-task', project: 'demo', service: 'demo', image: 'task:1', workerUid: 10001,
  resources: { cpu: '1', memory: '1Gi', storage: '1Gi' }, workVolume: { pvc: 'work-volume' }, businessStorage: { version: 1 as const, ownerTaskId: taskId, initialize: true } };
type Spec = { volumes: unknown[]; initContainers: Array<{ command: string[]; volumeMounts: unknown[]; securityContext: unknown }>; containers: Array<{ env: unknown[]; volumeMounts: unknown[] }> };

test('同 PVC 的两个 subPath：只有 init 挂卷根；平台私有路径覆盖 env 输入', () => {
  const spec = taskPodObject({ ...input, env: { [BUSINESS_JOURNAL_ENV]: '/work/unsafe' } }).spec as Spec;
  const paths = businessStoragePaths(taskId, taskId);
  expect(spec.volumes).toEqual([{ name: 'work', persistentVolumeClaim: { claimName: 'work-volume' } }]);
  expect(spec.containers[0]!.volumeMounts).toEqual([
    { name: 'work', mountPath: '/work', subPath: paths.work, readOnly: false },
    { name: 'work', mountPath: BUSINESS_JOURNAL_MOUNT, subPath: paths.journal, readOnly: false },
  ]);
  expect(spec.containers[0]!.env).toEqual([{ name: BUSINESS_JOURNAL_ENV, value: BUSINESS_JOURNAL_MOUNT }]);
  expect(spec.initContainers[0]).toMatchObject({ securityContext: { runAsUser: 0 }, volumeMounts: [{ name: 'work', mountPath: '/cs-volume', readOnly: false }] });
  expect(spec.initContainers[0]!.command).toEqual(['/opt/crewstation/bin/task-runner', 'prepare-business-volume', '/cs-volume', taskId, taskId, '10001', 'initialize']);
});

test('Agent 共享 /work、隔离日志；恢复必须使用已有布局', () => {
  const spec = taskPodObject({ ...input, taskId: childId, businessStorage: { ...input.businessStorage, initialize: false } }).spec as Spec;
  expect(spec.containers[0]!.volumeMounts).toEqual([
    { name: 'work', mountPath: '/work', subPath: businessStoragePaths(taskId, childId).work, readOnly: false },
    { name: 'work', mountPath: BUSINESS_JOURNAL_MOUNT, subPath: businessStoragePaths(taskId, childId).journal, readOnly: false },
  ]);
  expect(spec.initContainers[0]!.command.at(-1)).toBe('existing');
  expect(() => taskPodObject({ ...input, taskId: childId })).toThrow('父任务');
  expect(() => taskPodObject({ ...input, workerUid: 0 })).toThrow('非 root');
  expect(() => taskPodObject({ ...input, workVolume: { emptyDir: true } })).toThrow('PVC');
  expect(() => taskPodObject({ ...input, checkout: { repoUrl: 'x', branch: 'main', credentialSecretName: 's' } })).toThrow('检出');
});

test('Agent 原生会话独立挂载且只允许原执行创建', () => {
  const session = { key: TaskIdSchema.parse(childId), mode: 'create' as const };
  const spec = taskPodObject({ ...input, taskId: childId, businessStorage: { ...input.businessStorage, initialize: false, session } }).spec as Spec;
  expect(spec.containers[0]!.volumeMounts).toContainEqual({ name: 'work', mountPath: '/var/lib/crewstation/business-session', subPath: `${businessStoragePaths(taskId, childId).sessions}/${childId}`, readOnly: false });
  expect(spec.initContainers[0]!.command.slice(-2)).toEqual([childId, 'create']);
  expect(() => taskPodObject({ ...input, businessStorage: { ...input.businessStorage, session } })).toThrow('独立 Agent');
});
