import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunnerResultPayloads } from '@crewstation/contracts';
import { businessExecDigest } from '../src/exec/businessExecSupervisor';
import { startFakeSession } from './fakeSession';
import { startTestRunner } from './testRunner';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const dispose of cleanups.splice(0).reverse()) await dispose(); });

describe('business execution over Runner websocket', () => {
  test('缺少持久目录时明确拒绝，不宣告完整 v3 能力', async () => {
    const session = startFakeSession(); cleanups.push(() => session.stop());
    const tr = await startTestRunner(session.url); cleanups.push(() => tr.dispose());
    await tr.runner.whenConnected();
    expect(session.hellos[0]?.capabilities.businessExecutionV3).toBeUndefined();
    await expect(session.call({ id: 'info', type: 'businessExecutionInfo' })).rejects.toMatchObject({ code: 'unsupported_capability' });
    await expect(session.call({ id: 'file', type: 'readBusinessFile', query: { path: 'file' } })).rejects.toMatchObject({ code: 'unsupported_capability' });
  });

  test('文件命令通过真实 WS 分块传输并返回版本冲突；不支持原子读取的主机明确拒绝', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cs-business-files-ws-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const session = startFakeSession(); cleanups.push(() => session.stop());
    const tr = await startTestRunner(session.url, { businessJournalDir: directory }); cleanups.push(() => tr.dispose());
    await tr.runner.whenConnected();
    expect(session.hellos[0]?.capabilities.businessExecutionV3).toBe(process.platform === 'linux' ? 1 : undefined);
    const content = Buffer.alloc(1024 * 1024 + 17, 0xab); await writeFile(join(tr.workdir, 'result.bin'), content);
    const command = { id: 'file-read', type: 'readBusinessFile', query: { path: 'result.bin' } };
    if (process.platform !== 'linux') { await expect(session.call(command)).rejects.toMatchObject({ code: 'unsupported_capability' }); return; }
    const first = RunnerResultPayloads.businessFile.parse(await session.call(command));
    expect(Buffer.from(first.contentBase64, 'base64')).toEqual(content.subarray(0, 1024 * 1024));
    const last = RunnerResultPayloads.businessFile.parse(await session.call({ ...command, id: 'file-tail', query: { path: 'result.bin', offset: first.nextOffset, version: first.version } }));
    expect(Buffer.from(last.contentBase64, 'base64')).toEqual(content.subarray(1024 * 1024)); expect(last.nextOffset).toBeNull();
    const listing = RunnerResultPayloads.businessFiles.parse(await session.call({ id: 'files', type: 'listBusinessFiles', query: {} }));
    expect(listing.entries.some((entry) => entry.name === 'result.bin')).toBe(true);
    await writeFile(join(tr.workdir, 'result.bin'), 'replacement');
    await expect(session.call({ ...command, id: 'old-file', query: { path: 'result.bin', version: first.version } })).rejects.toMatchObject({ code: 'file_version_changed' });
  });

  test('带登记身份的取消先到，延迟 start 只回放取消墓碑', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cs-business-cancel-ws-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const session = startFakeSession(); cleanups.push(() => session.stop());
    const tr = await startTestRunner(session.url, { businessJournalDir: directory }); cleanups.push(() => tr.dispose());
    await tr.runner.whenConnected();
    const info = RunnerResultPayloads.businessExecutionInfo.parse(await session.call({ id: 'info-cancel', type: 'businessExecutionInfo' }));
    const input = { executionId: 'cancel-before-start', attempt: 1, command: ['sh', '-c', 'touch must-not-run'], env: {}, timeoutSeconds: 30 };
    const registration = { incarnation: info.incarnation, attempt: 1, payloadDigest: businessExecDigest(input) };
    const result = await session.call({ id: 'cancel-early', type: 'cancelBusinessExecution', executionId: input.executionId, registration });
    expect(result).toMatchObject({ phase: 'finished', result: { reason: 'cancelled' } });
    expect(await session.call({ ...input, ...registration, id: 'late-start', type: 'startBusinessCommand' })).toEqual(result);
    expect(await Bun.file(join(tr.workdir, 'must-not-run')).exists()).toBe(false);
    await expect(session.call({ id: 'wrong-inc', type: 'cancelBusinessExecution', executionId: input.executionId, registration: { ...registration, incarnation: crypto.randomUUID() } })).rejects.toMatchObject({ code: 'execution_incarnation_changed' });
  });

  test('异步命令、持久补读、确认、取消、重启后原回执与 incarnation 校验', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cs-business-ws-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const session = startFakeSession(); cleanups.push(() => session.stop());
    const tr = await startTestRunner(session.url, { businessJournalDir: directory }); cleanups.push(() => tr.dispose());
    await tr.runner.whenConnected();
    const info = RunnerResultPayloads.businessExecutionInfo.parse(await session.call({ id: 'info', type: 'businessExecutionInfo' }));
    const input = { executionId: 'protocol-execution', attempt: 1, command: ['sh', '-c', 'printf first; exec sleep 20'], env: {}, timeoutSeconds: 30 };
    const start = { ...input, id: 'start', type: 'startBusinessCommand', incarnation: info.incarnation, payloadDigest: businessExecDigest(input) };
    const receipt = RunnerResultPayloads.businessExecution.parse(await session.call(start));
    expect(receipt.phase).toBe('running');
    expect(RunnerResultPayloads.businessExecution.parse(await session.call({ ...start, id: 'duplicate' })).executionId).toBe(receipt.executionId);
    await expect(session.call({ ...start, id: 'bad-incarnation', incarnation: crypto.randomUUID() })).rejects.toMatchObject({ code: 'execution_incarnation_changed' });
    const done = RunnerResultPayloads.businessExecution.parse(await session.call({ id: 'cancel', type: 'cancelBusinessExecution', executionId: input.executionId }));
    expect(done).toMatchObject({ phase: 'finished', result: { reason: 'cancelled' } });
    const events = RunnerResultPayloads.businessExecutionEvents.parse(await session.call({ id: 'read', type: 'readBusinessExecutionEvents', executionId: input.executionId, after: 0 }));
    expect(events.at(-1)?.sequence).toBe(done.lastSequence);
    expect(events.some(({ frame }) => frame.type === 'output' && frame.text.includes('first'))).toBe(true);
    expect(await session.call({ id: 'ack', type: 'ackBusinessExecutionEvents', executionId: input.executionId, through: done.lastSequence })).toEqual({});
    expect(await session.call({ id: 'empty', type: 'readBusinessExecutionEvents', executionId: input.executionId, after: done.lastSequence })).toEqual([]);
    await expect(session.call({ id: 'missing', type: 'getBusinessExecution', executionId: 'missing' })).rejects.toMatchObject({ code: 'execution_not_found' });
    await tr.runner.stop(); tr.runner.link.close();
    const replacement = await startTestRunner(session.url, { businessJournalDir: directory }); cleanups.push(() => replacement.dispose());
    await replacement.runner.whenConnected();
    const acknowledged = { ...done, acknowledgedSequence: done.lastSequence };
    expect(RunnerResultPayloads.businessExecution.parse(await session.call({ id: 'recovered', type: 'getBusinessExecution', executionId: input.executionId }))).toEqual(acknowledged);
    await expect(session.call({ ...start, id: 'stale-after-restart' })).rejects.toMatchObject({ code: 'execution_incarnation_changed' });
    const newInfo = RunnerResultPayloads.businessExecutionInfo.parse(await session.call({ id: 'info-new', type: 'businessExecutionInfo' }));
    expect(newInfo.incarnation).not.toBe(info.incarnation);
    expect(RunnerResultPayloads.businessExecution.parse(await session.call({ ...start, id: 'replay-receipt', incarnation: newInfo.incarnation }))).toEqual(acknowledged);
  });
});
