import { expect, test } from 'bun:test';
import { chown, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { prepareNativeTerminal } from '@crewstation/agent-drivers';
import { noopLogger } from '@crewstation/kernel';
import { createWorkdirPaths } from '../src/files/workdirPath';
import { createProcessLauncher } from '../src/process/launcher';
import { probeCurrentUid, resolveIsolation } from '../src/process/privilege';
import { createNativePtyBackend } from '../src/terminal/nativePty';
import { NativeTerminalSupervisor } from '../src/terminal/nativeSupervisor';
import { NativeActivityModel, type NativeProbeScenario } from './nativeActivityModel';
import { nativeActivityInbox } from './nativeActivityInbox';

async function fixture() {
  const work = await mkdtemp('/tmp/cs-native-activity-');
  const outside = `${work}-external.txt`;
  await writeFile(outside, 'Disposable acceptance content');
  const currentUid = probeCurrentUid();
  if (currentUid === 0) { await chown(work, 10001, 10001); await chown(outside, 10001, 10001); }
  const model = new NativeActivityModel(outside);
  const inbox = nativeActivityInbox();
  const launcher = createProcessLauncher({ isolation: resolveIsolation({ uid: 10001, gid: 10001, currentUid, which: (binary) => Bun.which(binary) }), processEnv: { PATH: process.env.PATH! }, workerHome: work, logger: noopLogger });
  const native = new NativeTerminalSupervisor({
    backend: createNativePtyBackend(launcher), launcher, paths: await createWorkdirPaths(work), logger: noopLogger,
    agentEnv: { ANTHROPIC_API_KEY: 'sk-ant-acceptance-only-no-external-access', OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_AUTOUPDATE: '1' },
    emit: (event) => { if (event.kind === 'nativeActivity') inbox.emit(event.activity); },
    prepare: async (spec, context) => {
      const prepared = await prepareNativeTerminal(spec, context);
      expect(prepared.activityUnavailable).toBeUndefined();
      const config = JSON.parse(prepared.plan.env.OPENCODE_CONFIG_CONTENT!);
      config.provider.anthropic.options = { apiKey: 'sk-ant-acceptance-only-no-external-access', baseURL: model.base };
      prepared.plan.env.OPENCODE_CONFIG_CONTENT = JSON.stringify(config);
      return prepared;
    },
  });
  const close = async () => { await native.closeAll(); model.close(); await rm(work, { recursive: true, force: true }); await rm(outside, { force: true }); };
  return { native, inbox, model, close };
}

// 在任务镜像中显式运行；应配合 docker --network none。使用实际 CLI、PTY、插件与模型协议夹具。
test.skipIf(process.platform !== 'linux' || process.env.CS_NATIVE_ACTIVITY_ACCEPTANCE !== '1')('OpenCode 原生 TUI 全链路：完成、中断、提问、撤回、权限等待、模型失败与进程退出', async () => {
  const f = await fixture();
  try {
    const record = await f.native.start({ id: 'probe', type: 'startAgentTerminal', agentId: 'probe', terminalId: 'probe', runnerId: f.native.runnerId, requestFingerprint: 'probe', compute: 'fixture', driver: 'opencode', model: 'anthropic/claude-sonnet-4-5', permission: 'edit', cols: 100, rows: 30, mcp: [], env: {} });
    expect(record.lifecycle).toBe('running');
    await f.inbox.wait('source-ready');
    await Bun.sleep(1000); // 插件 ready 先于 TUI 首帧；仅初始化一次，不用于判断轮次。
    const scenarios: NativeProbeScenario[] = ['normal', 'cancel', 'question', 'question-reject', 'permission', 'api-error'];
    for (const [index, scenario] of scenarios.entries()) {
      const ordinal = index + 1;
      f.model.setScenario(scenario);
      f.native.claim('probe', 'view', f.native.runnerId);
      f.native.input('probe', `Acceptance ${scenario}: reply briefly.\r`, 'view');
      await f.inbox.wait('turn-started', ordinal);
      if (scenario === 'cancel') {
        await f.model.whenRequested(); await Bun.sleep(300);
        f.native.input('probe', '\u001b', 'view'); await Bun.sleep(150); f.native.input('probe', '\u001b', 'view');
      }
      if (['question', 'question-reject', 'permission'].includes(scenario)) {
        const opened = await f.inbox.wait('request-opened', ordinal);
        if (!opened.signal.request) throw new Error('Request identity missing');
        expect(opened.signal.request?.kind).toBe(scenario === 'permission' ? 'permission' : 'question');
        await Bun.sleep(300); // 让原生提问画面接收按键；状态断言只读结构化事件。
        f.native.input('probe', scenario === 'question-reject' ? '\u001b' : '\r', 'view');
        const resolved = await f.inbox.wait('request-resolved', ordinal);
        expect(resolved.signal.request).toEqual({ ...opened.signal.request, resolution: scenario === 'question-reject' ? 'rejected' : 'answered' });
      }
      const outcome = scenario === 'cancel' ? 'turn-cancelled' : scenario === 'api-error' ? 'turn-failed' : scenario === 'question-reject' ? 'turn-unconfirmed' : 'turn-completed';
      await f.inbox.wait(outcome, ordinal);
      expect(f.native.size).toBe(1);
      expect(f.inbox.events.some((event) => event.signal.kind === 'source-unavailable')).toBe(false);
      await Bun.sleep(300);
    }
    await f.native.stop('probe', f.native.runnerId);
    await f.inbox.wait('process-ended');
    expect(f.native.size).toBe(0);
  } finally { await f.close(); }
}, 120000);
