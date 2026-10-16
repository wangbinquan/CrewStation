import type { BotContextStorage } from '@crewstation/contracts';
import { BOT_CONTEXT_ENV, BOT_CONTEXT_MOUNT, BOT_RECEIPTS_MOUNT, BotContextStorageSchema, botContextPaths } from '@crewstation/contracts';
import type { ContainerSpec, VolumeSpec } from './workloads';

export function botContextMounts(input: { image: string; workerUid: number; storage: BotContextStorage }) {
  const storage = BotContextStorageSchema.parse(input.storage);
  if (!Number.isSafeInteger(input.workerUid) || input.workerUid < 1) throw new Error('Bot worker must be non-root');
  const paths = botContextPaths(storage.ownerTaskId, storage.conversationId, storage.epoch);
  const volumes: VolumeSpec[] = [
    { name: 'bot-context', mountPath: BOT_CONTEXT_MOUNT, subPath: paths.native, pvc: storage.pvcName },
    { name: 'bot-context', mountPath: BOT_RECEIPTS_MOUNT, subPath: paths.receipts, pvc: storage.pvcName },
  ];
  const init: ContainerSpec = { name: 'prepare-bot-context', image: input.image, runAsUser: 0,
    command: ['/opt/crewstation/bin/task-runner', 'prepare-bot-context', '/cs-bot-volume', String(input.workerUid), JSON.stringify(storage)],
    volumes: [{ name: 'bot-context', mountPath: '/cs-bot-volume' }], resources: { cpu: '100m', memory: '128Mi' } };
  return { volumes, init, env: [{ name: BOT_CONTEXT_ENV, value: JSON.stringify(storage) }] };
}
