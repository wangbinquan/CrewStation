import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, copyFile, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ExecutionJournal } from './executionJournal';

const directories: string[] = [];
const handles: ExecutionJournal[] = [];
const limits = { outputBytes: 1024, spoolBytes: 4096, eventBytes: 1024 };
const identity = { executionId: 'execution-1', attempt: 1, payloadDigest: 'a'.repeat(64) };
async function directory(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'cs-execution-journal-')); directories.push(root); return root; }
function open(root: string, incarnation = 'runner-a', config = limits): ExecutionJournal {
  const journal = new ExecutionJournal(root, incarnation, config); handles.push(journal); return journal;
}
afterEach(async () => {
  for (const handle of handles.splice(0)) handle.close();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('durable business execution journal', () => {
  test('Agent events share durable ordering and text budget; raw protocol blobs and oversize tools never enter the journal', async () => {
    const root = await directory(), journal = open(root); journal.reserve(identity); journal.state(identity.executionId, 'running');
    const base = { agentId: 'agent', seq: 1, at: new Date().toISOString() };
    journal.agent(identity.executionId, { ...base, type: 'text', text: 'answer' });
    journal.agent(identity.executionId, { ...base, type: 'usage', usage: { measurementId: 'usage-1', scope: 'step', mode: 'cumulative', inputTokens: null, outputTokens: 2, cacheReadTokens: null, cacheWriteTokens: null, complete: false } });
    expect(journal.get(identity.executionId)?.outputBytes).toBe(6);
    expect(() => journal.agent(identity.executionId, { ...base, type: 'tool-start', tool: { name: 'Read', input: 'x'.repeat(2000) } })).toThrow('上限');
    expect(() => journal.agent(identity.executionId, { ...base, type: 'text', raw: 'private' } as never)).toThrow();
    journal.finish(identity.executionId, { reason: 'exited', exitCode: 0, durationMs: 20 });
    const reopened = open(root, 'new');
    expect(reopened.replay(identity.executionId, 0).map((event) => event.frame.type)).toEqual(['state', 'agent', 'agent', 'result']);
    expect(reopened.get(identity.executionId)).toMatchObject({ phase: 'finished', outputBytes: 6 });
  });

  test('已初始化的数据库丢失、被清空或被另一执行库替换时拒绝重建', async () => {
    const root = await directory(), journal = open(root); journal.reserve(identity); journal.close();
    await rm(join(root, 'executions.sqlite'));
    expect(() => open(root, 'replacement')).toThrow('丢失或已替换');
    await writeFile(join(root, 'executions.sqlite'), '');
    expect(() => open(root, 'replacement')).toThrow('丢失或已替换');
    const other = await directory(), foreign = open(other); foreign.close();
    await copyFile(join(other, 'executions.sqlite'), join(root, 'executions.sqlite'));
    expect(() => open(root, 'replacement')).toThrow('丢失或已替换');
  });
  test('有执行记录时不能补造丢失身份；尚未准入的初始化中断可恢复，非法身份拒绝', async () => {
    const empty = await directory(), first = open(empty); first.close();
    const saved = await readFile(join(empty, 'journal.identity'), 'utf8');
    await rm(join(empty, 'journal.identity'));
    const recovered = open(empty); expect(await readFile(join(empty, 'journal.identity'), 'utf8')).toBe(saved);
    recovered.reserve(identity); recovered.close();
    await rm(join(empty, 'journal.identity'));
    expect(() => open(empty)).toThrow('丢失或已替换');
    await writeFile(join(empty, 'journal.identity'), 'broken');
    expect(() => open(empty)).toThrow('丢失或已替换');
    await rm(join(empty, 'journal.identity'));
    const outside = await directory(); await writeFile(join(outside, 'identity'), saved);
    await symlink(join(outside, 'identity'), join(empty, 'journal.identity'));
    expect(() => open(empty)).toThrow('文件不安全');
  });
  test('同一执行只准入一次，跨连接重试及不同摘要冲突', async () => {
    const root = await directory(), first = open(root), second = open(root);
    expect(first.reserve(identity).created).toBe(true);
    expect(second.reserve(identity).created).toBe(false);
    expect(() => second.reserve({ ...identity, payloadDigest: 'b'.repeat(64) })).toThrow('不同');
    expect(() => second.reserve({ ...identity, attempt: 2 })).toThrow('不同');
    expect(() => first.reserve({ ...identity, executionId: '', attempt: 0 })).toThrow('无效');
    expect(() => first.reserve({ ...identity, payloadDigest: 'secret-value' })).toThrow('无效');
  });

  test('崩溃窗口只恢复 unknown，finished 和最终水位跨 incarnation 保留', async () => {
    const root = await directory(), first = open(root);
    first.reserve(identity);
    const afterRestart = open(root, 'runner-b');
    expect(afterRestart.reserve(identity)).toMatchObject({ created: false, receipt: { phase: 'unknown' } });
    expect(() => afterRestart.state(identity.executionId, 'running')).toThrow('旧 Runner');
    first.state(identity.executionId, 'running');
    first.output(identity.executionId, 'stdout', '首');
    first.output(identity.executionId, 'stderr', '尾');
    const result = { exitCode: 0, reason: 'exited' as const, durationMs: 12 };
    const complete = first.finish(identity.executionId, result);
    expect(complete).toMatchObject({ phase: 'finished', lastSequence: 4, outputBytes: 6, result });
    expect(afterRestart.reserve(identity).receipt).toEqual(complete);
    expect(first.finish(identity.executionId, { ...result, exitCode: 1 })).toEqual(complete);
    expect(first.state(identity.executionId, 'running')).toEqual(complete);
    expect(() => first.output(identity.executionId, 'stdout', '迟到')).toThrow('活动执行');
    expect(afterRestart.replay(identity.executionId, 0).map((e) => e.sequence)).toEqual([1, 2, 3, 4]);
  });

  test('只回收已确认连续水位，迟到确认不倒退，墓碑和累计输出不清空', async () => {
    const journal = open(await directory());
    journal.reserve(identity); journal.state(identity.executionId, 'running');
    journal.output(identity.executionId, 'stdout', 'hello');
    expect(() => journal.acknowledge(identity.executionId, 3)).toThrow('尚未产生');
    journal.acknowledge(identity.executionId, 2); journal.acknowledge(identity.executionId, 1);
    expect(journal.get(identity.executionId)).toMatchObject({ acknowledgedSequence: 2, outputBytes: 5 });
    expect(journal.replay(identity.executionId, 2)).toEqual([]);
    expect(() => journal.replay(identity.executionId, 0)).toThrow('游标');
    expect(() => journal.replay(identity.executionId, 2, 1001)).toThrow('分页');
    expect(() => journal.replay(identity.executionId, 3)).toThrow('游标');
    expect(journal.reserve(identity).created).toBe(false);
    expect(() => journal.state('missing', 'running')).toThrow('不存在');
  });

  test('输出容量与未确认积压分开；触顶仍有控制事件空间且不会截断伪成功', async () => {
    const journal = open(await directory(), 'runner', { outputBytes: 10, spoolBytes: 180, eventBytes: 100 });
    journal.reserve(identity); journal.state(identity.executionId, 'running');
    journal.output(identity.executionId, 'stdout', '12345');
    expect(() => journal.output(identity.executionId, 'stdout', '123456')).toThrow('输出达到');
    journal.acknowledge(identity.executionId, 2);
    journal.output(identity.executionId, 'stdout', '12345');
    expect(() => journal.output(identity.executionId, 'stdout', '1')).toThrow('输出达到');
    journal.state(identity.executionId, 'cancelling');
    expect(() => journal.state(identity.executionId, 'running')).toThrow('重新');
    expect(journal.finish(identity.executionId, { exitCode: null, reason: 'output_limit', durationMs: 0 }).phase).toBe('finished');
    const tiny = open(await directory(), 'runner', { ...limits, spoolBytes: 1 });
    tiny.reserve(identity); tiny.state(identity.executionId, 'running');
    expect(() => tiny.output(identity.executionId, 'stdout', 'x')).toThrow('积压');
    expect(tiny.get(identity.executionId)?.lastSequence).toBe(1);
  });

  test('拒绝共享或符号链接日志目录及替换的数据库文件', async () => {
    const root = await directory(), target = await directory();
    await chmod(root, 0o755);
    expect(() => open(root)).toThrow('私有目录');
    await chmod(root, 0o700);
    await symlink(target, join(root, 'link'));
    expect(() => open(join(root, 'link'))).toThrow('私有目录');
    await symlink(join(target, 'db'), join(root, 'executions.sqlite'));
    expect(() => open(root)).toThrow('文件不安全');
    expect(() => open(target, '', limits)).toThrow('配置无效');
  });

  test('补读同时限制页数和总字节，分页拼接没有缺口', async () => {
    const journal = open(await directory(), 'runner', { outputBytes: 4 * 1024 * 1024, spoolBytes: 5 * 1024 * 1024, eventBytes: 256 * 1024 });
    journal.reserve(identity); journal.state(identity.executionId, 'running');
    for (let index = 0; index < 10; index++) journal.output(identity.executionId, 'stdout', 'x'.repeat(200 * 1024));
    const first = journal.replay(identity.executionId, 0, 1000);
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(1024 * 1024);
    expect(first.length).toBeLessThan(11);
    const next = journal.replay(identity.executionId, first.at(-1)!.sequence, 1000);
    expect([...first, ...next].map((event) => event.sequence)).toEqual(Array.from({ length: 11 }, (_, index) => index + 1));
  });

  test('真实 Runner 进程 SIGKILL 后已提交意图可恢复且不重新准入', async () => {
    const root = await directory();
    const script = `import { ExecutionJournal } from ${JSON.stringify(import.meta.dir + '/executionJournal.ts')};
      const journal = new ExecutionJournal(process.argv[1], 'dead-runner', ${JSON.stringify(limits)});
      journal.reserve(${JSON.stringify(identity)}); console.log('committed'); setInterval(() => {}, 1000);`;
    const proc = Bun.spawn([process.execPath, '-e', script, root], { stdout: 'pipe', stderr: 'pipe' });
    try {
      const reader = proc.stdout.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('committed');
      reader.releaseLock();
      proc.kill('SIGKILL'); await proc.exited;
      const journal = open(root, 'replacement');
      expect(journal.reserve(identity)).toMatchObject({ created: false, receipt: { phase: 'unknown', lastSequence: 0 } });
      expect((await readFile(join(root, 'executions.sqlite'))).byteLength).toBeGreaterThan(0);
    } finally { proc.kill(); await proc.exited; }
  });
});
