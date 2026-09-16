import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import type { RuntimeCheckDto, RuntimeConfigDetailDto, UserId } from '@crewstation/contracts';
import { draftFromRevision, previewPath, toSaveRequest, validateDraft } from '../features/admin/model/runtimeDraft';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

const CONFIG_ID = `arc_${'1'.repeat(32)}`, CHECK_ID = `chk_${'2'.repeat(32)}`, USER = `usr_${'a'.repeat(32)}`, TASK = `tsk_${'3'.repeat(32)}`;

function detailFixture(): RuntimeConfigDetailDto {
  const revision = {
    revision: 1, contentHash: 'hash-1', createdBy: USER as UserId, createdAt: '2026-09-16T00:00:00Z',
    steps: [{ kind: 'file' as const, stepId: 'settings', name: '写 settings.json', pathTemplate: '{{agent.home}}/.claude/settings.json', contentTemplate: '{"env":{"ANTHROPIC_API_KEY":"{{secrets.ANTHROPIC_API_KEY}}"}}', format: 'json' as const, mode: 0o600, existing: 'require-same' as const }],
    vars: {}, secretNames: ['ANTHROPIC_API_KEY'], configFile: { kind: 'claude-settings' as const, pathTemplate: '{{agent.home}}/.claude/settings.json' }, models: [],
  };
  return { id: CONFIG_ID as RuntimeConfigDetailDto['id'], name: 'claude-gateway', description: '', driver: 'claude-code', status: 'draft', draftRevision: 1, activeRevision: null, enabled: true, referencedProfiles: 0,
    updatedBy: USER as UserId, updatedAt: '2026-09-16T00:00:00Z', draft: revision, credentials: [{ name: 'ANTHROPIC_API_KEY', set: true }], referencedBy: [] };
}

/** 假后端：列表、详情、保存（可注入 409）、检查（立即成功）、启用；记录每次写入体。 */
function fixture() {
  const state = { detail: detailFixture(), conflictRevision: undefined as number | undefined, checkState: 'succeeded' as RuntimeCheckDto['state'] };
  const writes: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
  const check = (): RuntimeCheckDto => ({ checkId: CHECK_ID as RuntimeCheckDto['checkId'], configId: state.detail.id, revision: state.detail.draftRevision, contentHash: state.detail.draft.contentHash, clientRequestId: '00000000-0000-4000-8000-000000000000', state: state.checkState,
    context: { kind: 'platform-namespace', taskId: TASK as RuntimeCheckDto['context']['taskId'], image: 'crewstation/task:test', cliVersion: '2.0.0', interpreters: [{ language: 'shell', command: 'bash', version: '5.2' }] },
    stages: [{ id: 'input', kind: 'input', name: '输入校验', state: 'succeeded', durationMs: 3 }, { id: 'step:settings', kind: 'step', stepId: 'settings', name: '写 settings.json', state: state.checkState === 'failed' ? 'failed' : 'succeeded', detail: '/tmp/crewstation-agents/agt_x/home/.claude/settings.json' }, { id: 'model', kind: 'model', name: '模型响应', state: state.checkState === 'failed' ? 'skipped' : 'succeeded' }],
    createdBy: USER as UserId, createdAt: '2026-09-16T00:00:01Z', endedAt: '2026-09-16T00:00:05Z' });
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname, method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (method !== 'GET') writes.push({ path, method, body });
    if (path === '/v1/me') return Response.json({ id: USER, name: '管理员', email: 'admin@test.invalid', isAdmin: true, memberships: [] });
    if (path === '/v1/admin/agent-runtime-configs') return Response.json({ items: [state.detail] });
    if (path === `/v1/admin/agent-runtime-configs/${CONFIG_ID}`) return Response.json(state.detail);
    if (path === `/v1/admin/agent-runtime-configs/${CONFIG_ID}/draft`) {
      if (state.conflictRevision !== undefined) return Response.json({ error: 'conflict', message: '草稿已被修改', details: { code: 'draft_revision_conflict', currentRevision: state.conflictRevision } }, { status: 409 });
      const next = (body.expectedRevision as number) + 1;
      state.detail = { ...state.detail, draftRevision: next, draft: { ...state.detail.draft, revision: next, contentHash: `hash-${next}`, steps: body.steps as RuntimeConfigDetailDto['draft']['steps'] } };
      return Response.json(state.detail);
    }
    if (path === `/v1/admin/agent-runtime-configs/${CONFIG_ID}/checks`) return Response.json(check(), { status: 202 });
    if (path === `/v1/admin/agent-runtime-configs/${CONFIG_ID}/checks/${CHECK_ID}`) return Response.json(check());
    if (path === `/v1/admin/agent-runtime-configs/${CONFIG_ID}/activate`) { state.detail = { ...state.detail, status: 'active', activeRevision: body.revision as number, active: state.detail.draft }; return Response.json(state.detail); }
    return Response.json({ items: [] });
  }) as typeof fetch;
  return { state, writes };
}

const field = (label: string) => [...document.querySelectorAll('label')].find((node) => node.querySelector('span')?.textContent === label)!.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')!;
/** happy-dom 下 React 走 input 事件 polyfill：先聚焦让 React 记住活动元素，绕过值跟踪器写值，再以 keyup 触发 onChange。 */
async function input(label: string, value: string) {
  const node = field(label), proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { node.focus(); Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); }); await page!.settle();
}

test('草稿模型：客户端只拦能即时定位的错误；保存体按契约转换并只带有意义的凭据操作；路径预览区分私有与共享', () => {
  const draft = draftFromRevision(detailFixture());
  expect(validateDraft(draft)).toEqual({});
  const broken = { ...draft, steps: [...draft.steps, { ...draft.steps[0]!, stepId: 'settings', name: '' }], vars: [{ name: '1bad', value: 'x' }, { name: 'ANTHROPIC_API_KEY', value: 'dup' }], defaultModel: 'gpt', models: 'claude' };
  expect(validateDraft(broken)).toEqual({ 'steps.1.stepId': 'stepIdDuplicate', 'steps.1.name': 'nameRequired', 'vars.0.name': 'envName', 'vars.1.name': 'envNameDuplicate', defaultModel: 'defaultModel' });
  const withScript = { ...draft, steps: [...draft.steps, { ...draft.steps[0]!, kind: 'script' as const, stepId: 'login', name: '登录', language: 'python' as const, source: 'print(1)', argv: '--fast\n\n--json', timeoutSeconds: '90' }],
    credentials: { ANTHROPIC_API_KEY: { op: 'keep' as const }, OLD_TOKEN: { op: 'clear' as const }, STRAY: { op: 'replace' as const, value: 'x' } } };
  const request = toSaveRequest(withScript, 7);
  expect(request.expectedRevision).toBe(7);
  expect(request.steps[0]).toMatchObject({ kind: 'file', mode: 0o600, format: 'json' });
  expect(request.steps[1]).toEqual({ kind: 'script', stepId: 'login', name: '登录', language: 'python', source: 'print(1)', argv: ['--fast', '--json'], timeoutMs: 90_000 });
  expect(request.credentials).toEqual({ ANTHROPIC_API_KEY: { op: 'keep' }, OLD_TOKEN: { op: 'clear' } });
  expect(previewPath('~/.claude/settings.json')).toMatchObject({ scope: 'private' });
  expect(previewPath('/etc/app/config.json')).toMatchObject({ scope: 'shared' });
  expect(previewPath('relative/path')).toMatchObject({ scope: 'invalid' });
});

test('打开运行环境、新增脚本步骤并保存：请求携带 expectedRevision 与转换后的步骤，保存后显示新草稿版本', async () => {
  const f = fixture(); page = await renderApp('/admin/compute?tab=runtime');
  expect(page.text()).toContain('claude-gateway'); await page.click('打开');
  expect(page.search()).toMatchObject({ tab: 'runtime', config: CONFIG_ID }); expect(page.text()).toContain('写 settings.json');
  await page.click('＋ 执行脚本'); expect(page.text()).toContain('脚本内容');
  await input('步骤名称', '换取网关令牌'); await page.click('保存草稿');
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]!.body).toMatchObject({ expectedRevision: 1, secretNames: ['ANTHROPIC_API_KEY'], credentials: { ANTHROPIC_API_KEY: { op: 'keep' } }, configFile: { kind: 'claude-settings' } });
  const steps = f.writes[0]!.body.steps as Array<Record<string, unknown>>;
  expect(steps).toHaveLength(2); expect(steps[1]).toMatchObject({ kind: 'script', name: '换取网关令牌', language: 'shell', argv: [], timeoutMs: 60_000 });
  expect(page.text()).toContain('已保存为草稿版本 2');
});

test('保存冲突保留草稿并给出当前版本；按当前版本重存后请求换用新的 expectedRevision', async () => {
  const f = fixture(); page = await renderApp(`/admin/compute?tab=runtime&config=${CONFIG_ID}`);
  await page.click('＋ 预置文件'); await input('步骤名称', '第二个文件'); await input('目标路径', '{{agent.home}}/second.txt'); await input('文件内容模板', 'hello');
  f.state.conflictRevision = 5; await page.click('保存草稿');
  expect(page.text()).toContain('版本 5'); expect(page.text()).toContain('第二个文件'); expect(f.writes[0]!.body.expectedRevision).toBe(1);
  f.state.conflictRevision = undefined; await page.click('按版本 5 重新保存'); await page.click('保存草稿');
  expect(f.writes).toHaveLength(2); expect(f.writes[1]!.body.expectedRevision).toBe(5);
});

test('检查通过后才出现启用按钮；确认启用时携带当前启用版本、检查 ID 与版本号，成功后状态变为已启用', async () => {
  const f = fixture(); page = await renderApp(`/admin/compute?tab=runtime&config=${CONFIG_ID}`);
  expect(page.text()).not.toContain('启用版本 1'); await page.click('检查草稿版本 1');
  expect(page.text()).toContain('检查通过'); expect(page.text()).toContain('crewstation/task:test'); expect(page.text()).toContain('shell 5.2');
  await page.click('启用版本 1'); expect(page.text()).toContain('启用运行环境 claude-gateway 的版本 1？'); await page.click('启用版本 1');
  const activation = f.writes.find((write) => write.path.endsWith('/activate'))!;
  expect(activation.body).toEqual({ expectedActiveRevision: null, revision: 1, checkId: CHECK_ID });
  expect(page.text()).toContain('已启用'); expect(page.text()).toContain('当前已启用版本 1');
});

test('检查失败只显示失败阶段与定位按钮，不提供启用', async () => {
  const f = fixture(); f.state.checkState = 'failed'; page = await renderApp(`/admin/compute?tab=runtime&config=${CONFIG_ID}`);
  await page.click('检查草稿版本 1');
  expect(page.text()).toContain('检查失败'); expect(page.text()).toContain('定位到步骤'); expect(page.text()).toContain('未执行'); expect(page.text()).not.toContain('启用版本 1');
});
