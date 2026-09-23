import { expect, test } from 'bun:test';
import { NativeTerminalRecordSchema, TERMINAL_REPLY_PALETTE, TerminalSnapshotSchema } from './nativeTerminal';

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

test('RFC-026：快照的 repliesQueries 可选——旧 Runner 的快照没有它照常解析', () => {
  const snapshot = { terminalId: 't', runnerId: record.runnerId, cols: 80, rows: 24, throughSeq: 0, data: '', scrollbackLimit: 500, truncated: false };
  expect(TerminalSnapshotSchema.safeParse(snapshot).success).toBe(true);
  expect(TerminalSnapshotSchema.parse({ ...snapshot, repliesQueries: true }).repliesQueries).toBe(true);
  expect(TerminalSnapshotSchema.safeParse({ ...snapshot, repliesQueries: 'yes' }).success).toBe(false);
});

test('RFC-026：应答配色是三个 #rrggbb 色值', () => {
  for (const color of Object.values(TERMINAL_REPLY_PALETTE)) expect(color).toMatch(/^#[0-9a-f]{6}$/);
});
