import { afterEach, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newResourceId } from '@crewstation/kernel';
import { RuntimeInitialization } from '../src/initialization/runtimeInitialization';
import { InitializationJournal } from '../src/initialization/journal';
import { runtimeContainerIdentity } from '../src/initialization/config';
import { toolMatches } from '../src/initialization/process';
import { buildChildEnv } from '../src/process/childEnvironment';
import { initializationFixture } from './runtimeInitializationFixture';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
test('初始化只执行一次，重连／Runner 重启复用完成态，新容器重新初始化', async () => {
  const f = await initializationFixture(); cleanups.push(f.dispose);
  const first = f.make(); expect(() => first.assertReady('exec')).toThrow('尚未成功');
  expect((await first.start()).state).toBe('succeeded'); await first.start(); await first.close();
  const resumed = f.make(); expect((await resumed.start()).state).toBe('succeeded');
  expect(await Bun.file(join(f.work, 'count')).text()).toBe('x');
  const fresh = f.make({ ...f.config, containerIdentity: 'pod/container-two' });
  expect((await fresh.start()).state).toBe('succeeded'); expect(await Bun.file(join(f.work, 'count')).text()).toBe('xx');
  expect(first.status().executionId).not.toBe(fresh.status().executionId);
});

test('Runner 崩溃留下运行意图时返回 unknown，不重执行可能已有副作用的脚本', async () => {
  const f = await initializationFixture(); cleanups.push(f.dispose);
  const before = f.make(), state = before.status(); await before.close();
  const journal = new InitializationJournal(f.config.journalDir); journal.write({ ...state, state: 'running' }); journal.close();
  const resumed = f.make(); expect((await resumed.start()).state).toBe('unknown');
  expect(await Bun.file(join(f.work, 'count')).exists()).toBe(false);
  expect(() => resumed.assertReady('startAgent')).toThrow('unknown');
});

test('失败、超时和取消阻止所有执行入口；初始化状态查询和关闭保持可用', async () => {
  const f = await initializationFixture('exit 7'); cleanups.push(f.dispose);
  const failed = f.make(); expect(await failed.start()).toMatchObject({ state: 'failed', steps: [{ id: 'setup', state: 'failed', exitCode: 7 }] });
  for (const type of ['exec', 'startAgent', 'startAgentTerminal', 'openTerminal', 'startPreview', 'startBusinessCommand', 'writeFile']) expect(() => failed.assertReady(type)).toThrow('尚未成功');
  expect(() => failed.assertReady('runtimeInitializationStatus')).not.toThrow();
  expect(() => failed.assertReady('shutdown')).not.toThrow();
  const timeout = f.make({ ...f.config, containerIdentity: 'timeout', material: { ...f.config.material, initializer: { ...f.config.material.initializer, steps: [{ id: 'wait', argv: ['/bin/sh', '-c', 'sleep 20'], cwd: f.work, timeoutSeconds: 1 }] } } });
  expect((await timeout.start()).state).toBe('failed');
  const cancelled = f.make({ ...f.config, containerIdentity: 'cancel' });
  expect((await cancelled.cancel()).state).toBe('cancelled'); expect((await cancelled.start()).state).toBe('cancelled');
});

test('初始化 Secret 临时文件可读、执行后删除，工具结果掩码后才落日志', async () => {
  const f = await initializationFixture('printf "%s" "$CS_RUNTIME_SECRET_DIR" > secret-dir'); cleanups.push(f.dispose);
  const material = { ...f.config.material, secrets: { token: 'private-package-token' }, initializer: { ...f.config.material.initializer, secrets: [{ id: 'token', configDefinitionId: newResourceId(), environment: 'development' as const }] }, tools: [{ key: 'token-check', argv: ['/bin/sh', '-c', 'cat "$CS_RUNTIME_SECRET_DIR/token"'], cwd: f.work, timeoutSeconds: 2, expected: { kind: 'text' as const, value: 'private-package-token' } }] };
  const init = f.make({ ...f.config, material }); expect((await init.start()).state).toBe('succeeded');
  expect(init.status().checks).toEqual([{ key: 'token-check', passed: true, output: '[REDACTED]', exitCode: 0 }]);
  const path = await Bun.file(join(f.work, 'secret-dir')).text(); expect(await Bun.file(join(path, 'token')).exists()).toBe(false);
  await init.close(); expect(await Bun.file(join(f.config.journalDir, 'initialization.sqlite')).text()).not.toContain('private-package-token');
  expect(toolMatches('{"b":2,"a":1}', { kind: 'json', value: { a: 1, b: 2 } })).toBe(true);
});

test('状态目录拒绝被 worker 写入的路径，PID 1 启动时间区分容器重启', async () => {
  const f = await initializationFixture(); cleanups.push(f.dispose);
  const unsafe = join(f.root, 'unsafe'); await writeFile(unsafe, 'x');
  expect(() => new RuntimeInitialization({ ...f.config, journalDir: unsafe }, f.launcher)).toThrow();
  const uid = '00000000-0000-4000-8000-000000000000', fields = ['S', ...Array.from({ length: 18 }, () => '0'), '1234'];
  expect(runtimeContainerIdentity(uid, `1 (tini) ${fields.join(' ')}`)).toBe(`${uid}/1234`);
  fields[19] = '5678'; expect(runtimeContainerIdentity(uid, `1 (tini) ${fields.join(' ')}`)).toBe(`${uid}/5678`);
  expect(buildChildEnv({ CS_RUNTIME_IMAGE_INITIALIZATION: '{"secrets":"private"}', CS_RUNTIME_POD_UID: uid, NORMAL: 'kept' })).toEqual({ NORMAL: 'kept' });
});

test('工具输出不会把继承的项目配置凭据写入持久状态', async () => {
  const token = 'inherited-project-secret-unique';
  const f = await initializationFixture('true', { REPORT_ACCESS: token }); cleanups.push(f.dispose);
  const tools = [{ key: 'inherited', argv: ['/bin/sh', '-c', 'printf "%s" "$REPORT_ACCESS"'], cwd: f.work, timeoutSeconds: 2, expected: { kind: 'text' as const, value: token } }];
  const init = f.make({ ...f.config, material: { ...f.config.material, tools } });
  expect(await init.start()).toMatchObject({ state: 'succeeded', checks: [{ key: 'inherited', passed: true, output: '[REDACTED]' }] });
  await init.close();
  expect(await Bun.file(join(f.config.journalDir, 'initialization.sqlite')).text()).not.toContain(token);
  const agent = f.make({ ...f.config, containerIdentity: 'agent-with-inherited-config', material: { ...f.config.material, tools, toolsPhase: 'agent-before-start' } });
  await agent.start(); await agent.checkAgentTools('attempt-1', {}, new AbortController().signal);
  expect(agent.status().checks).toMatchObject([{ passed: true, output: '[REDACTED]' }]);
  await agent.close();
  expect(await Bun.file(join(f.config.journalDir, 'initialization.sqlite')).text()).not.toContain(token);
});
