import { expect, test } from 'bun:test';
import { CommitWorkspaceRequestSchema, RunnerHelloSchema, RunnerCommandSchema } from '@crewstation/contracts';
import { fixedClock } from '@crewstation/kernel';
import { RunnerConnection } from '../domain/runnerConnection';
import { commandDispatch } from '../application/commandDispatch';
import { terminalViewCommand } from '../domain/terminalViews';
import { commandTimeout } from '../domain/commandTimeout';

test('旧容器在发送前拒绝确认提交，新容器有界执行；浏览器不能伪造提交身份', async () => {
  const hello = RunnerHelloSchema.parse({ type: 'hello', taskId: '01a0bf5d-8f4b-7418-8a3f-7cbb4a1fd751', runnerToken: 'token', protocolVersion: 3, workdir: '/work', capabilities: { protocols: ['terminal'], pty: true, preview: false } });
  const input = { expectedHead: 'a'.repeat(40), expectedBranch: 'main', expectedFingerprint: 'b'.repeat(64), message: 'confirmed' };
  const command = RunnerCommandSchema.parse({ id: 'commit', type: 'commitWorkspace', ...input, actorUserId: '01a0bf5d-8f4b-7793-867c-efd7527b386b' });
  const sent: string[] = [], connection = new RunnerConnection(hello, { send: frame => { sent.push(frame); } }, 0, 1000, 0);
  const deps = { registry: { lookup: async () => undefined, claim: async () => {}, release: async () => {}, heartbeat: async () => {} }, forwarder: { forward: async () => { throw new Error('unexpected forward'); } }, clock: fixedClock('2026-10-14T00:00:00.000Z'), settings: { selfAddress: 'local', commandTimeoutMs: 1000, runnerStaleMs: 60_000, replayLimit: 100 } };
  const dispatch = commandDispatch(deps, { connections: new Map([[hello.taskId, connection]]) });
  await expect(dispatch.sendCommand(hello.taskId, command)).rejects.toMatchObject({ details: { code: 'workspace_commit_unavailable' } }); expect(sent).toHaveLength(0);
  hello.capabilities.workspaceCommit = 1;
  const pending = dispatch.sendCommand(hello.taskId, command); expect(sent).toHaveLength(1); expect(commandTimeout(command)).toEqual({ timeoutMs: 70_000 });
  connection.pending.settle(command.id, { ok: true, payload: { commitSha: 'c'.repeat(40) } }); await pending;
  expect(() => terminalViewCommand(command, 'browser')).toThrow('改动确认接口');
  expect(CommitWorkspaceRequestSchema.safeParse({ ...input, expectedTaskId: hello.taskId, actorUserId: 'spoof' }).success).toBe(false);
});
