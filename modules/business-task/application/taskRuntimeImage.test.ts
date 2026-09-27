import { expect, test } from 'bun:test';
import type { RuntimeImageExecutionSnapshot, TaskId } from '@crewstation/contracts';
import { conflict, newResourceId } from '@crewstation/kernel';
import { admitWithRuntimeImage } from './taskRuntimeImage';

const image = (): RuntimeImageExecutionSnapshot => {
  const digest = `sha256:${'a'.repeat(64)}`;
  return { versionId: newResourceId(), image: `registry/tools@${digest}`, digest, architecture: 'linux/amd64', validationId: newResourceId(), initializerDigest: digest,
    initializer: { steps: [], env: {}, secrets: [] }, tools: [], selectionSource: 'request' };
};
test('明确事务拒绝可释放未采用预留，但提交回执丢失不能证明未提交', async () => {
  const snapshot = image(), owner = { type: 'agent' as const, id: newResourceId() as TaskId }, released: unknown[] = [];
  const port = { release: async (...args: unknown[]) => { released.push(args); } };
  const rejected = conflict('parent closed');
  await expect(admitWithRuntimeImage(port, snapshot, owner, async () => { throw rejected; }, () => '')).rejects.toBe(rejected);
  expect(released).toEqual([[snapshot, owner]]);
  released.length = 0;
  const unknown = new Error('COMMIT response lost');
  await expect(admitWithRuntimeImage(port, snapshot, owner, async () => { throw unknown; }, () => '')).rejects.toBe(unknown);
  expect(released).toEqual([]);
});
test('受理成功保留原引用，无镜像路径不要求回收端口，缺回收端口不伪报释放', async () => {
  const snapshot = image(), owner = { type: 'task' as const, id: newResourceId() as TaskId }, winner = { id: owner.id };
  const port = { release: async () => { throw new Error('accepted image must remain'); } };
  expect(await admitWithRuntimeImage(port, snapshot, owner, async () => winner, (result) => result.id)).toBe(winner);
  expect(await admitWithRuntimeImage(undefined, undefined, owner, async () => 'another-id', (result) => result)).toBe('another-id');
  await expect(admitWithRuntimeImage(undefined, snapshot, owner, async () => 'another-id', (result) => result)).rejects.toThrow('缺少释放端口');
});
