import { expect, test } from 'bun:test';
import { chown, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { prepareNativeTerminal } from '@crewstation/agent-drivers';
import { noopLogger } from '@crewstation/kernel';
import { createWorkdirPaths } from '../src/files/workdirPath';
import { createProcessLauncher } from '../src/process/launcher';
import { probeCurrentUid, resolveIsolation } from '../src/process/privilege';
import { createNativePtyBackend } from '../src/terminal/nativePty';
import { NativeTerminalSupervisor } from '../src/terminal/nativeSupervisor';
import { nativeActivityInbox } from './nativeActivityInbox';
import { NativeActivityModel, type NativeProbeScenario } from './nativeActivityModel';

async function fixture() {
  const work = await mkdtemp('/tmp/cs-claude-activity-');
  const outside = `${work}-external.txt`;
  const key = 'sk-ant-acceptance-only-no-external-access';
  const model = new NativeActivityModel(outside, 'claude-code');
  await mkdir(`${work}/.claude`);
  await writeFile(outside, 'Disposable acceptance content');
  const config = `${work}/.claude.json`, settings = `${work}/.claude/settings.json`;
  await writeFile(config, JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', customApiKeyResponses: { approved: [key.slice(-20)], rejected: [] }, projects: { [work]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }));
  await writeFile(settings, JSON.stringify({ hooks: {
    Stop: [{ hooks: [{ type: 'http', url: `${model.base}/block` }] }],
    PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'http', url: `${model.base}/ask` }] }],
  } }));
  const currentUid = probeCurrentUid();
  if (currentUid === 0) for (const path of [work, outside, `${work}/.claude`, config, settings]) await chown(path, 10001, 10001);
  const inbox = nativeActivityInbox();
  const launcher = createProcessLauncher({ isolation: resolveIsolation({ uid: 10001, gid: 10001, currentUid, which: (binary) => Bun.which(binary) }), processEnv: { PATH: process.env.PATH! }, workerHome: work, logger: noopLogger });
  const native = new NativeTerminalSupervisor({
    backend: createNativePtyBackend(launcher), launcher, paths: await createWorkdirPaths(work), logger: noopLogger,
    agentEnv: { ANTHROPIC_API_KEY: key, ANTHROPIC_BASE_URL: model.base.slice(0, -3), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
    emit: (event) => { if (event.kind === 'nativeActivity') inbox.emit(event.activity); },
    prepare: async (spec, context) => { const prepared = await prepareNativeTerminal(spec, context); expect(prepared.activityUnavailable).toBeUndefined(); return prepared; },
  });
  const close = async () => { await native.closeAll(); model.close(); await rm(work, { recursive: true, force: true }); await rm(outside, { force: true }); };
  return { native, inbox, model, close };
}

async function scenario(f: Awaited<ReturnType<typeof fixture>>, next: NativeProbeScenario, ordinal: number) {
  f.model.setScenario(next); f.native.claim('probe', 'view', f.native.runnerId);
  f.native.input('probe', `Acceptance ${next}: reply briefly.\r`, 'view');
  await f.inbox.wait('turn-started', ordinal);
  if (next === 'cancel' || next === 'blocked-stop-cancel') {
    await (next === 'cancel' ? f.model.whenRequested() : f.model.whenContinued()); await Bun.sleep(300);
    f.native.input('probe', '\u001b', 'view');
  }
  if (next === 'question' || next === 'question-reject' || next === 'permission') {
    const opened = await f.inbox.wait('request-opened', ordinal);
    if (!opened.signal.request) throw new Error('Missing native request identity');
    expect(opened.signal.request?.kind).toBe(next === 'permission' ? 'permission' : 'question');
    await Bun.sleep(300);
    f.native.input('probe', next === 'question-reject' ? '\u001b' : '\r', 'view');
    if (next === 'question') { await Bun.sleep(300); f.native.input('probe', '\r', 'view'); }
    const resolved = await f.inbox.wait('request-resolved', ordinal);
    expect(resolved.signal.request).toEqual({ ...opened.signal.request, resolution: next === 'question-reject' ? 'withdrawn' : 'answered' });
  }
  const outcome = next === 'cancel' || next === 'question-reject' ? 'turn-unconfirmed' : next === 'blocked-stop-cancel' ? 'turn-cancelled' : next === 'api-error' ? 'turn-failed' : 'turn-completed';
  await f.inbox.wait(outcome, ordinal);
  expect(f.inbox.events.some((event) => event.signal.kind === 'source-unavailable')).toBe(false);
  if (['cancel', 'blocked-stop-cancel', 'question-reject', 'api-error'].includes(next)) expect(f.inbox.events.some((event) => event.turnOrdinal === ordinal && event.signal.kind === 'turn-completed')).toBe(false);
  expect(f.native.size).toBe(1);
  await Bun.sleep(300);
}

// 实际固定版本 CLI＋PTY＋原生 hooks／trace／transcript；必须在 --network none 的一次性任务镜像执行。
test.skipIf(process.platform !== 'linux' || process.env.CS_NATIVE_ACTIVITY_ACCEPTANCE !== '1')('Claude 原生状态：首次中断、问题／撤回、许可、Stop 继续／取消、正常完成与 API 失败', async () => {
  const f = await fixture();
  try {
    const record = await f.native.start({ id: 'probe', type: 'startAgentTerminal', agentId: 'probe', terminalId: 'probe', runnerId: f.native.runnerId, requestFingerprint: 'probe', compute: 'fixture', driver: 'claude-code', model: 'anthropic/claude-sonnet-4-5', permission: 'edit', cols: 100, rows: 30, mcp: [], env: {} });
    expect(record.lifecycle).toBe('running');
    await Bun.sleep(1500);
    f.native.claim('probe', 'view', f.native.runnerId); f.native.input('probe', '\r', 'view'); await Bun.sleep(300);
    await f.inbox.wait('source-ready');
    const scenarios: NativeProbeScenario[] = ['cancel', 'normal', 'question', 'question-reject', 'permission', 'blocked-stop', 'blocked-stop-cancel', 'api-error'];
    for (const [index, next] of scenarios.entries()) await scenario(f, next, index + 1);
    await f.native.stop('probe', f.native.runnerId); await f.inbox.wait('process-ended');
    expect(f.native.size).toBe(0);
  } catch (error) {
    console.error('Acceptance native screen:', JSON.stringify((await f.native.attach('probe', f.native.runnerId)).data));
    throw error;
  } finally { await f.close(); }
}, 180000);
