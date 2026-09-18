import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { computeBackend, profileTest, testIdOf } from './computeProfileFixture';
import { renderApp } from './renderApp';

let page: Awaited<ReturnType<typeof renderApp>> | undefined;
let backend: ReturnType<typeof computeBackend> | undefined;
afterEach(() => { page?.unmount(); page = undefined; backend?.restore(); backend = undefined; });

const LATER = '2026-09-17T09:00:00.000Z';
type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** FormField 的第一个 span 是标签文字；只看当前渲染出来的字段，隐藏字段不在其中。 */
const labels = () => [...document.querySelectorAll('label')].map((label) => label.querySelector('span')?.textContent ?? '');
const control = (label: string) => {
  const found = [...document.querySelectorAll('label')].find((node) => node.querySelector('span')?.textContent === label);
  if (!found) throw new Error(`没有字段「${label}」：${labels().join(' / ')}`);
  return found.querySelector<Control>('input, select, textarea')!;
};
const button = (label: string) => [...document.querySelectorAll('button')].find((node) => node.textContent === label)!;

/** happy-dom 下 React 走 input 事件 polyfill：绕过值跟踪器写值，文本框以 input＋keyup、下拉以 change 触发 onChange。 */
async function setField(label: string, value: string) {
  const node = control(label);
  const proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    node.focus(); Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value);
    if (node instanceof HTMLSelectElement) node.dispatchEvent(new Event('change', { bubbles: true }));
    else { node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); }
  });
  await page!.settle();
}
async function press(label: string) { await act(async () => button(label).click()); await page!.settle(); }
/** 等后台轮询（2 秒一次）把结果带回来；超时即失败并打印当前页面。 */
async function waitFor(done: () => boolean, timeoutMs = 3500) {
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`等待超时，当前页面：${page!.text()}`);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
  }
}

const TERMINAL_ONLY = ['测试命令（每行一个参数，首行为可执行文件）', '期望输出（正则）', '测试超时（秒，1–600）'];

describe('新建算力档位', () => {
  test('字段随协议显隐；default 与缺失的测试命令在客户端拦下；创建体只带适用字段，成功后进入该档位的编辑页', async () => {
    backend = computeBackend(); page = await renderApp('/admin/compute?create=true');
    expect(page.text()).toContain('新建算力档位');
    expect(labels()).toEqual(expect.arrayContaining(['附加命令行参数（每行一个）', '配置目录变量名', '配置目录名', 'IS_SANDBOX 兼容标记', '模型', 'CLI 加载的配置文件']));
    for (const hidden of ['温度（0–2）', ...TERMINAL_ONLY]) expect(labels()).not.toContain(hidden);
    expect(control('二进制路径').value).toBe('/usr/local/bin/claude');

    await setField('协议', 'opencode');
    expect(labels()).toEqual(expect.arrayContaining(['变体（variant）', '温度（0–2）', '步数（steps）', '最大步数（maxSteps）', '配置目录变量名', '模型', 'CLI 加载的配置文件']));
    for (const hidden of ['附加命令行参数（每行一个）', 'IS_SANDBOX 兼容标记', ...TERMINAL_ONLY]) expect(labels()).not.toContain(hidden);
    expect(control('二进制路径').value).toBe('/usr/local/bin/opencode');
    expect(page.text()).toContain('OpenCode opencode.json');

    await setField('协议', 'terminal');
    expect(labels()).toEqual(expect.arrayContaining(['附加命令行参数（每行一个）', ...TERMINAL_ONLY]));
    for (const hidden of ['模型', '配置目录变量名', 'IS_SANDBOX 兼容标记', 'CLI 加载的配置文件', '温度（0–2）']) expect(labels()).not.toContain(hidden);
    expect(control('二进制路径').value).toBe('');
    expect(page.text()).toContain('尚无步骤');

    await setField('档位名', 'default'); await setField('镜像', 'registry.cs.local/runtimes/aider:1'); await setField('二进制路径', '/opt/aider/bin/aider');
    await press('创建档位');
    expect(page.text()).toContain('default 是保留名，指代平台默认档位。'); expect(page.text()).toContain('请填写测试命令。'); expect(page.text()).toContain('3 处待修正');
    expect(backend.writes).toEqual([]);

    await setField('档位名', 'aider-cli'); await setField(TERMINAL_ONLY[0]!, '/opt/aider/bin/aider\n--version'); await setField(TERMINAL_ONLY[1]!, '^aider'); await setField(TERMINAL_ONLY[2]!, '30');
    await press('创建档位');
    expect(backend.writes).toEqual([{ method: 'POST', path: '/v1/admin/compute-profiles', query: '', body: {
      name: 'aider-cli', description: '', credentials: {},
      content: { image: 'registry.cs.local/runtimes/aider:1', launch: { protocol: 'terminal', binaryPath: '/opt/aider/bin/aider', extraArgs: [] }, steps: [], vars: {}, secretNames: [], configFile: { kind: 'none' }, terminalTest: { command: ['/opt/aider/bin/aider', '--version'], expect: '^aider', timeoutMs: 30_000 } },
    } }]);
    expect(page.search()).toEqual({ profile: 'aider-cli' });
    expect(control('档位名').disabled).toBe(true); expect(control('协议').disabled).toBe(true);
    expect(page.text()).toContain('排队中'); expect(page.text()).toContain('测试中');
  });

  test('Claude 预设＋底座镜像＋资源套餐：平台保留参数被拒，修正后创建体带套餐与配置文件绑定', async () => {
    backend = computeBackend(); page = await renderApp('/admin/compute?create=true');
    expect(page.text()).toContain('占用一个项目并发额度');
    expect([...(control('每个 Agent 的资源套餐') as HTMLSelectElement).options].map((option) => option.textContent)).toEqual(['平台默认任务套餐', 'cli-large · CPU 2 · 4Gi']);
    await setField('档位名', 'claude-weekly');
    await press('使用平台底座镜像');
    expect(control('镜像').value).toBe('registry.cs.local/crewstation/task:0.9.0');
    await setField('每个 Agent 的资源套餐', 'cli-large');
    await setField('附加命令行参数（每行一个）', '--fork-flag\n--settings=/tmp/x');
    await press('创建档位');
    expect(page.text()).toContain('--settings 由平台装配，不能作为附加参数。'); expect(backend.writes).toEqual([]);
    await setField('附加命令行参数（每行一个）', '--fork-flag');
    await press('创建档位');
    const body = backend.writes[0]!.body as { content: Record<string, unknown>; credentials: unknown };
    expect(body.content).toMatchObject({
      image: 'registry.cs.local/crewstation/task:0.9.0', taskProfile: 'cli-large',
      launch: { protocol: 'claude-code', binaryPath: '/usr/local/bin/claude', extraArgs: ['--fork-flag'], isSandbox: false },
      vars: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }, secretNames: ['ANTHROPIC_AUTH_TOKEN'], configFile: { kind: 'claude-settings', pathTemplate: '{{agent.home}}/.claude/settings.json' },
    });
    expect((body.content.launch as Record<string, unknown>).model).toBeUndefined();
    // 预设声明了凭据名但还没填值：空的替换不发送，页面上显示未设置，由测试回报缺少鉴权。
    expect(body.credentials).toEqual({});
    expect(page.search()).toEqual({ profile: 'claude-weekly' });
  });
});

describe('编辑算力档位', () => {
  test('名称与协议固定；保存带 expectedRevision；冲突保留表单并给出当前修订，按当前修订重存', async () => {
    backend = computeBackend(); page = await renderApp('/admin/compute?profile=claude-daily');
    expect(control('档位名').disabled).toBe(true); expect(control('协议').disabled).toBe(true);
    expect(page.text()).toContain('当前修订 1'); expect(button('保存').disabled).toBe(true);
    await setField('模型', 'anthropic/claude-opus-5');
    expect(page.text()).toContain('有未保存的修改');
    await press('保存');
    expect(backend.writes[0]).toMatchObject({ method: 'PUT', path: '/v1/admin/compute-profiles/claude-daily', body: { expectedRevision: 1, description: '日常开发', credentials: { ANTHROPIC_AUTH_TOKEN: { op: 'keep' } } } });
    expect(backend.writes[0]!.body.content).toMatchObject({ launch: { model: 'anthropic/claude-opus-5' } });
    expect(page.text()).toContain('已保存为修订 2'); expect(page.text()).toContain('当前修订 2'); expect(page.text()).toContain('排队中');

    backend.state.saveConflict = 5;
    await setField('模型', 'anthropic/claude-haiku-4-5'); await press('保存');
    expect(backend.writes[1]!.body.expectedRevision).toBe(2);
    expect(page.text()).toContain('档位在别处已改为修订 5；你的修改保留在页面上');
    expect(control('模型').value).toBe('anthropic/claude-haiku-4-5');
    backend.state.saveConflict = undefined;
    await press('按修订 5 重新保存');
    expect(page.text()).not.toContain('保存失败');
    await press('保存');
    expect(backend.writes[2]!.body.expectedRevision).toBe(5);
    expect(backend.writes[2]!.body.content).toMatchObject({ launch: { model: 'anthropic/claude-haiku-4-5' } });
  });

  test('只改说明：不生成新修订，也不重新测试', async () => {
    backend = computeBackend(); page = await renderApp('/admin/compute?profile=claude-daily');
    await setField('说明', '日常开发（新）'); await press('保存');
    expect(backend.writes[0]!.body.description).toBe('日常开发（新）');
    expect(page.text()).toContain('已保存说明；执行配置没有变化，不生成新修订，也不重新测试。');
    expect(page.text()).toContain('当前修订 1'); expect(page.text()).not.toContain('排队中');
  });

  test('保存后服务端自动测试：详情按短间隔轮询，直到测试出结果', async () => {
    backend = computeBackend(); page = await renderApp('/admin/compute?profile=claude-daily');
    await setField('模型', 'anthropic/claude-opus-5'); await press('保存');
    expect(page.text()).toContain('排队中');
    backend.state.profiles = backend.state.profiles.map((p) => ({ ...p, availability: { state: 'ready', available: true }, latestTest: profileTest({ testId: testIdOf(3), revision: 2, createdAt: LATER }) }));
    await waitFor(() => page!.text().includes('测试通过'));
    expect(page.text()).toContain('通过：二进制按协议完成了一次真实轮次'); expect(page.text()).toContain('针对修订 2');
  });

  test('重新测试：每次换一个 clientRequestId 并轮询到终态；有未保存修改时不能重测', async () => {
    backend = computeBackend(); page = await renderApp('/admin/compute?profile=claude-daily');
    const manual = { testId: testIdOf(9), trigger: 'manual', createdAt: LATER };
    backend.state.manualTests = [
      profileTest({ ...manual, state: 'running', outcome: undefined, endedAt: undefined, stages: [{ id: 'image', kind: 'image', name: '拉取镜像', state: 'running' }] }),
      profileTest({ ...manual, state: 'failed', outcome: 'network-blocked', stages: [
        { id: 'image', kind: 'image', name: '拉取镜像', state: 'succeeded' }, { id: 'launch', kind: 'launch', name: '启动 CLI', state: 'succeeded' },
        { id: 'model', kind: 'model', name: '模型轮次', state: 'failed', detail: 'dial tcp 10.0.0.8:443: i/o timeout' },
      ] }),
    ];
    await press('重新测试');
    expect(backend.writes[0]).toMatchObject({ method: 'POST', path: '/v1/admin/compute-profiles/claude-daily/tests' });
    const first = backend.writes[0]!.body.clientRequestId;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => page!.text().includes('网络不可达'));
    expect(page.text()).toContain('手动测试'); expect(page.text()).toContain('dial tcp 10.0.0.8:443: i/o timeout');
    await press('重新测试');
    expect(backend.writes[1]!.body.clientRequestId).not.toBe(first);
    await waitFor(() => !button('重新测试').disabled);
    await setField('说明', '改一下');
    expect(button('重新测试').disabled).toBe(true);
    expect(page.text()).toContain('有未保存的修改：先保存，保存后会自动测试。');
  });
});
