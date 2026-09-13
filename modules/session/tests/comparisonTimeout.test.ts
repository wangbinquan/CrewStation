import { expect, test } from 'bun:test';
import { commandTimeout } from '../domain/commandTimeout';
import { PendingCommands } from '../domain/pendingCommands';

test('补齐历史的命令不会被默认 30 秒抢先判失败，但仍在自己的截止时间到期', () => {
  const failures: string[] = [];
  const pending = new PendingCommands(30_000);
  pending.add({ id: 'fetch', type: 'fetchComparisonHistory', sentAt: 0, resolve: () => {}, reject: (error) => failures.push(error.code), ...commandTimeout({ id: 'fetch', type: 'fetchComparisonHistory', url: 'https://git.example/repo.git' }) });
  expect(pending.expire(30_001)).toBe(0);
  expect(pending.expire(130_001)).toBe(1);
  expect(failures).toEqual(['timeout']);
});

test('其他命令保留原有超时，比较命令有明确独立预算', () => {
  expect(commandTimeout({ id: 'list', type: 'listFiles', path: '.' })).toEqual({});
  expect(commandTimeout({ id: 'compare', type: 'compareWorkspace' })).toEqual({ timeoutMs: 70_000 });
  const pending = new PendingCommands(30);
  pending.add({ id: 'list', type: 'listFiles', sentAt: 0, resolve: () => {}, reject: () => {} });
  expect(pending.expire(31)).toBe(1);
});
