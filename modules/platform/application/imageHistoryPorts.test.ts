import { expect, test } from 'bun:test';
import type { RuntimeImageHistoryItem, RuntimeImageHistoryRead } from '@crewstation/contracts';
import { imageOwnerPorts } from './developmentImagePorts';

test('镜像历史合并各所有者的前页再分页，保留全局顺序，不把模块失败当作空历史', async () => {
  const reads: RuntimeImageHistoryRead[] = [], input = { projectId: 'project', versionIds: ['version'], limit: 2, before: '9' };
  const row = (id: string): RuntimeImageHistoryItem => ({ id, projectId: 'project', serviceId: 'service', versionId: 'version', kind: 'task', state: 'released', createdAt: '2026-09-27T00:00:00Z', updatedAt: '2026-09-27T00:00:00Z' });
  const ports = imageOwnerPorts(() => ({ taskRuntime: { imageReferenceState: async () => 'unknown', imageHistory: async (query) => { reads.push(query); return [row('8'), row('4')]; } }, release: { imageHistory: async (query) => { reads.push(query); return [row('7'), row('6')]; } } }));
  expect((await ports.executionHistory.list(input)).map((r) => r.id)).toEqual(['8', '7']); expect(reads).toEqual([input, input]);
  await expect(imageOwnerPorts(() => ({})).executionHistory.list(input)).rejects.toThrow('尚未装配');
  const failed = imageOwnerPorts(() => ({ taskRuntime: { imageReferenceState: async () => 'unknown', imageHistory: async () => { throw new Error('db unavailable'); } }, release: { imageHistory: async () => [] } }));
  await expect(failed.executionHistory.list(input)).rejects.toThrow('db unavailable');
});
