import { expect, test } from 'bun:test';
import { NativeTerminalRecordSchema } from './nativeTerminal';

const record = {
  agentId: 'agent-1', terminalId: 'term-1', runnerId: '0199a3c0-0000-7000-8000-000000000001', compute: 'default', permission: 'full',
  revision: 2, lifecycle: 'running', startedAt: '2026-09-23T03:00:00.000Z', cols: 120, rows: 40,
};

test('RFC-024：界面状态可选——旧 Runner 的记录没有 ui 照常解析，新 Runner 的等待与就绪都能读出', () => {
  expect(NativeTerminalRecordSchema.safeParse(record).success).toBe(true);
  expect(NativeTerminalRecordSchema.safeParse({ ...record, ui: { state: 'waiting' } }).success).toBe(true);
  for (const by of ['screen', 'timeout']) {
    expect(NativeTerminalRecordSchema.safeParse({ ...record, ui: { state: 'ready', readyAt: '2026-09-23T03:00:12.000Z', by } }).success).toBe(true);
  }
});

test('RFC-024：拒绝未知的界面状态与判定方式', () => {
  expect(NativeTerminalRecordSchema.safeParse({ ...record, ui: { state: 'painted' } }).success).toBe(false);
  expect(NativeTerminalRecordSchema.safeParse({ ...record, ui: { state: 'ready', by: 'guess' } }).success).toBe(false);
});
