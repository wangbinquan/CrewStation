import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { ProjectRuntimeImagePolicyDtoSchema, RuntimeImageDtoSchema } from '@crewstation/contracts';
import { renderApp } from './renderApp';
import { computePagePath, computeProjectId, projectComputeFixture } from './projectComputeFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(async () => { page?.unmount(); page = undefined; await new Promise((r) => setTimeout(r, 0)); globalThis.fetch = originalFetch; });
const imageId = '01a0bf5d-8f4b-7148-804c-6bd655d243f7';
const policyPath = `/v1/projects/${computeProjectId}/runtime-image-policy`;

function fixture() {
  const compute = projectComputeFixture(), next = globalThis.fetch;
  const state = { conflict: false, error: false, paged: false, hold: undefined as Promise<void> | undefined, policy: ProjectRuntimeImagePolicyDtoSchema.parse({ projectId: computeProjectId, revision: 0, policy: { mode: 'inherit', allowedImageIds: [] }, updatedAt: null }) };
  const writes: unknown[] = [], reads: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === policyPath) {
      reads.push(url.pathname);
      if (state.hold) await state.hold;
      if (state.error) return Response.json({ error: 'unavailable', message: '镜像授权暂不可读' }, { status: 503 });
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)); writes.push(body);
        if (state.conflict || body.expectedRevision !== state.policy.revision) return Response.json({ error: 'conflict', message: '镜像授权已变化，本次未保存' }, { status: 409 });
        state.policy = { ...state.policy, policy: body.policy, revision: state.policy.revision + 1 };
      }
      return Response.json(state.policy);
    }
    if (url.pathname === '/v1/admin/runtime-image-catalog') {
      const image = RuntimeImageDtoSchema.parse({ id: imageId, projectId: computeProjectId, name: 'Python tools', description: '数据处理', scope: 'project', enabled: true, revision: 1, createdBy: imageId, createdAt: '2026-09-27T00:00:00Z', updatedAt: '2026-09-27T00:00:00Z' });
      return Response.json({ items: state.paged && !url.searchParams.has('before') ? Array.from({ length: 100 }, (_, index) => ({ ...image, id: `01a0bf5d-8f4b-7148-804c-ffffffff${(255 - index).toString(16).padStart(4, '0')}`, name: `Tools ${index}` })) : [image] });
    }
    return next(input, init);
  }) as typeof fetch;
  return { ...compute, imageState: state, imageWrites: writes, imageReads: reads };
}
const scope = () => [...document.querySelectorAll('section')].find((node) => node.getAttribute('aria-label') === '运行镜像授权')!;
const mode = () => scope().querySelector('select')!;
async function selectMode(value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(mode(), value); mode().dispatchEvent(new Event('change', { bubbles: true })); }); await page!.settle();
}
async function toggleImage() { await act(async () => scope().querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); await page!.settle(); }

test('镜像与算力授权并列，具名选择使用同样样式；显式空集合可保存', async () => {
  const f = fixture(); page = await renderApp(computePagePath); if ([...document.querySelectorAll('button')].some((b) => b.textContent === '继承与可选范围')) await page.click('继承与可选范围');
  expect(page.text()).toContain('Agent 档位范围'); expect(page.text()).toContain('运行镜像范围');
  await selectMode('restricted');
  expect(scope().textContent).toContain('不选择任何镜像表示禁止新采用');
  await toggleImage(); await page.click('保存运行镜像授权');
  expect(f.imageWrites).toEqual([{ expectedRevision: 0, policy: { mode: 'restricted', allowedImageIds: [imageId] } }]);
  expect(f.writes).toEqual([]);
  await toggleImage(); await page.click('保存运行镜像授权');
  expect(f.imageWrites.at(-1)).toEqual({ expectedRevision: 1, policy: { mode: 'restricted', allowedImageIds: [] } });
  await selectMode('inherit'); await page.click('保存运行镜像授权');
  expect(f.imageWrites.at(-1)).toEqual({ expectedRevision: 2, policy: { mode: 'inherit', allowedImageIds: [] } });
});

test('冲突保留选择，放弃修改使用统一确认弹窗，取消不丢草稿', async () => {
  const f = fixture(); page = await renderApp(computePagePath); if ([...document.querySelectorAll('button')].some((b) => b.textContent === '继承与可选范围')) await page.click('继承与可选范围');
  await selectMode('restricted'); await toggleImage(); f.imageState.conflict = true;
  await page.click('保存运行镜像授权');
  expect(scope().textContent).toContain('本次未保存'); expect(scope().querySelector<HTMLInputElement>('input')!.checked).toBe(true);
  await page.click('放弃镜像授权修改');
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(2);
  await act(async () => [...document.querySelectorAll('dialog[open]')].at(-1)!.dispatchEvent(new Event('cancel', { cancelable: true })));
  expect(scope().querySelector<HTMLInputElement>('input')!.checked).toBe(true);
  await page.click('放弃镜像授权修改'); await page.click('放弃并重新读取');
  expect(mode().value).toBe('inherit'); expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
});

test('无管理权限不读取；读取失败不显示可写表单，保存时身份变化不提交', async () => {
  const f = fixture(); f.state.admin = false; page = await renderApp(computePagePath); if ([...document.querySelectorAll('button')].some((b) => b.textContent === '继承与可选范围')) await page.click('继承与可选范围');
  expect(f.imageReads).toEqual([]);
  page.unmount(); f.state.admin = true; f.imageState.error = true; page = await renderApp(computePagePath); if ([...document.querySelectorAll('button')].some((b) => b.textContent === '继承与可选范围')) await page.click('继承与可选范围');
  expect(page.text()).toContain('镜像授权暂不可读'); expect(scope().querySelector('form')).toBeNull();
  f.imageState.error = false; await page.reread(); await selectMode('restricted'); f.state.admin = false;
  await page.click('保存运行镜像授权'); expect(scope().textContent).toContain('管理员身份已变化'); expect(f.imageWrites).toEqual([]);
});

test('授权读取完整分页目录，末页镜像可选择；缺失旧授权可明确移除', async () => {
  const f = fixture(); f.imageState.paged = true;
  f.imageState.policy.policy = { mode: 'restricted', allowedImageIds: ['01a0bf5d-8f4b-7148-804c-6bd655d243ff'] };
  page = await renderApp(computePagePath); if ([...document.querySelectorAll('button')].some((b) => b.textContent === '继承与可选范围')) await page.click('继承与可选范围');
  expect(scope().querySelectorAll('input[type="checkbox"]')).toHaveLength(102);
  const label = [...scope().querySelectorAll('label')].find((node) => node.querySelector('strong')?.textContent === 'Python tools')!;
  await act(async () => label.querySelector<HTMLInputElement>('input')!.click()); await page.settle();
  const missing = [...scope().querySelectorAll('label')].find((node) => node.textContent?.includes('目录已无此镜像'))!;
  await act(async () => missing.querySelector<HTMLInputElement>('input')!.click()); await page.settle();
  await page.click('保存运行镜像授权');
  expect(f.imageWrites).toEqual([{ expectedRevision: 0, policy: { mode: 'restricted', allowedImageIds: [imageId] } }]);
});
