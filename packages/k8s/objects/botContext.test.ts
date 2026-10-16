import { expect, test } from 'bun:test';
import { BOT_CONTEXT_ENV, BOT_CONTEXT_MOUNT, BOT_RECEIPTS_MOUNT, TaskIdSchema } from '@crewstation/contracts';
import { taskPodObject } from './task';

const ownerTaskId = TaskIdSchema.parse('01a0bf5d-8f4b-7001-8458-107366e7de39');
const storage = { version: 1 as const, ownerTaskId, conversationId: '01a0bf5d-8f4b-7001-8458-107366e7de40', epoch: 1, mode: 'create' as const, pvcName: `bot-${ownerTaskId.replaceAll('-', '')}`, volumeUid: 'original' };
const input = { name: 'bot-run', namespace: 'cs-demo', taskId: '01a0bf5d-8f4b-7001-8458-107366e7de41', workload: 'dev-session', project: 'demo', service: 'demo', image: 'task:1', workerUid: 10001, resources: { cpu: '1', memory: '1Gi', storage: '1Gi' }, workVolume: { pvc: 'shared-work' } };
type Spec = { volumes: unknown[]; initContainers?: Array<{ command: string[]; volumeMounts: unknown[] }>; containers: Array<{ env: Array<{ name: string; value: string }>; volumeMounts: Array<{ name: string; mountPath: string; subPath?: string }> }> };

test('Bot alone mounts a separate private volume; native data and root receipts have separate leaf mounts', () => {
  const spec = taskPodObject({ ...input, botContext: storage, env: { [BOT_CONTEXT_ENV]: 'forged' } }).spec as Spec;
  expect(spec.volumes).toHaveLength(2);
  expect(spec.volumes).toContainEqual({ name: 'work', persistentVolumeClaim: { claimName: 'shared-work' } });
  const mounts = spec.containers[0]!.volumeMounts;
  expect(mounts.find(m => m.mountPath === '/work')?.subPath).toBeUndefined();
  expect(mounts.find(m => m.mountPath === BOT_CONTEXT_MOUNT)?.subPath).toContain('/native');
  expect(mounts.find(m => m.mountPath === BOT_RECEIPTS_MOUNT)?.subPath).toContain('/receipts');
  const bindings = spec.containers[0]!.env.filter(e => e.name === BOT_CONTEXT_ENV);
  expect(bindings).toHaveLength(1); expect(JSON.parse(bindings[0]!.value)).toEqual(storage);
  expect(spec.initContainers![0]!.command).toContain('prepare-bot-context');
  const cli = taskPodObject(input).spec as Spec;
  expect(cli.volumes).toHaveLength(1); expect(cli.initContainers).toBeUndefined();
  expect(cli.containers[0]!.volumeMounts.some(m => m.mountPath === BOT_CONTEXT_MOUNT)).toBe(false);
  expect(() => taskPodObject({ ...input, botContext: storage, workload: 'business-task' })).toThrow('development Agent');
});
