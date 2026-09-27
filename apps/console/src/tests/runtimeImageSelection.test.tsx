import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act, useState } from 'react';
import { RuntimeImagePicker } from '../shared/runtime-images/RuntimeImagePicker';
import { ProjectScopeProvider } from '../shared/project/ProjectScope';
import { OpenSessionForm } from '../features/dev-session/components/OpenSessionForm';
import { StartAgentForm } from '../features/dev-session/components/agents/StartAgentForm';
import { useDevSession } from '../features/dev-session/hooks/useDevSession';
import { useDevAgents } from '../features/dev-session/hooks/useDevAgents';
import { useHistoricalStart } from '../features/dev-session/hooks/useHistoricalStart';
import { messages } from '../features/dev-session/i18n/zh-CN';
import { renderElement } from './renderElement';

const original = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = original; });
const id = (n: number) => `01a0bf5d-8f4b-7111-8111-${String(n).padStart(12, '0')}`;
const projectId = id(1), taskVersion = id(2), agentVersion = id(3), profileId = id(4);
const policy = { projectId, revision: 1, developmentTask: { runtimeImageVersionId: taskVersion }, developmentAgents: [{ profileId, selection: { allowedRuntimeImageVersionIds: [agentVersion] } }] };
function serve() {
  const writes: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (raw, init) => {
    const url = String(raw);
    if (init?.method === 'POST') { writes.push({ url, body: JSON.parse(String(init.body)) }); return Response.json({ error: 'precondition', message: '验收拒绝', details: {} }, { status: 412 }); }
    if (url.endsWith('/development-runtime-images')) return Response.json(policy);
    if (url.includes('/runtime-image-versions/')) return Response.json({ id: url.split('/').at(-1), imageId: id(20), projectId, name: '报表工具', revisionId: id(21), buildId: id(22), repository: 'registry.test/tool', digest: `sha256:${'a'.repeat(64)}`, architecture: 'linux/amd64', state: 'available', createdAt: '2026-09-27T00:00:00Z', initializerDigest: `sha256:${'b'.repeat(64)}`, toolsDigest: `sha256:${'c'.repeat(64)}` });
    if (url.endsWith('/compute-profiles')) return Response.json({ items: [{ id: profileId, name: 'Agent A', description: '', terminalOnly: false, available: true, isDefault: true }] });
    if (url.endsWith('/dev-session')) return Response.json({ error: 'not_found', message: '尚无会话', details: {} }, { status: 404 });
    return Response.json({ items: [] });
  }) as typeof fetch;
  return writes;
}
async function choose(node: HTMLSelectElement, value: string) {
  await act(async () => { node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); }); await page!.settle();
}
function Pickers() {
  const [task, setTask] = useState(''), [agent, setAgent] = useState('');
  return <><RuntimeImagePicker projectId={projectId} usage="task" value={task} onChange={setTask} /><RuntimeImagePicker projectId={projectId} usage="agent" profileId={profileId} value={agent} onChange={setAgent} /></>;
}
function TaskStart() {
  const session = useDevSession(projectId);
  return <ProjectScopeProvider value={{ projectId, space: 'workbench' }}><OpenSessionForm open={session.open} branches={{ isPending: false, loadError: null, branches: [{ name: 'main', headSha: 'a'.repeat(40), isDefault: true, behindPreview: 0, behindProd: 0 }] }} /></ProjectScopeProvider>;
}
function AgentStart() {
  const agents = useDevAgents(id(5)), creation = useHistoricalStart(agents.start, () => {});
  return <StartAgentForm projectId={projectId} creation={creation} />;
}

test('任务与 Agent 只显示各自允许集合，Agent 不继承任务默认；选择被撤回时保留显式值', async () => {
  serve(); page = await renderElement(<Pickers />, messages);
  const selects = [...page.host.querySelectorAll<HTMLSelectElement>('select')];
  expect([...selects[0]!.options].map((o) => o.value)).toEqual(['', taskVersion]);
  expect([...selects[1]!.options].map((o) => o.value)).toEqual(['', agentVersion]);
  expect(selects[0]!.textContent).toContain('项目默认'); expect(selects[1]!.textContent).toContain('平台默认');
  expect(selects[1]!.textContent).toContain('报表工具 · aaaaaaaaaaaa');
  await choose(selects[1]!, agentVersion);
  globalThis.fetch = (async () => Response.json({ ...policy, developmentAgents: [] })) as unknown as typeof fetch;
  await page.reread(); expect(selects[1]!.value).toBe(agentVersion); expect(selects[1]!.textContent).toContain('已不在允许集合');
});

test('开任务表单把自己的显式镜像传给 v2，失败保留选择', async () => {
  const writes = serve(); page = await renderElement(<TaskStart />, messages);
  const picker = [...page.host.querySelectorAll<HTMLSelectElement>('select')].find((node) => [...node.options].some((o) => o.value === taskVersion))!;
  await choose(picker, taskVersion); await page.click('开始开发');
  expect(writes).toHaveLength(1); expect(writes[0]!.url).toContain('/v2/projects/'); expect(writes[0]!.body).toEqual({ branch: 'main', runtimeImageVersionId: taskVersion });
  expect(picker.value).toBe(taskVersion);
});

test('Agent 表单独立选择镜像，启动请求带所选版本且不带父任务默认', async () => {
  const writes = serve(); page = await renderElement(<AgentStart />, messages);
  const prompt = document.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => { prompt.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(prompt, 'run tools'); prompt.dispatchEvent(new Event('input', { bubbles: true })); prompt.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); }); await page.settle();
  const picker = [...document.querySelectorAll<HTMLSelectElement>('select')].find((node) => [...node.options].some((o) => o.value === agentVersion))!;
  await choose(picker, agentVersion); await page.click('启动');
  expect(writes).toHaveLength(1); expect(writes[0]!.url).toContain('/v2/tasks/'); expect(writes[0]!.body).toEqual({ compute: { kind: 'default' }, prompt: 'run tools', runtimeImageVersionId: agentVersion });
  expect(picker.value).toBe(agentVersion);
});
