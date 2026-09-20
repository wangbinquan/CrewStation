import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act, useState } from 'react';
import { ManifestUpgradeNotice } from '../features/dev-session/components/editor/ManifestUpgradeNotice';
import type { FileEditorHandle } from '../features/dev-session/hooks/useFileEditor';
import { messages } from '../features/dev-session/i18n/zh-CN';
import { renderElement } from './renderElement';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

test('manifest upgrade previews the current draft, rejects stale results and applies without saving', async () => {
  let change: (next: string) => void = () => {};
  const requests: Array<{ url: string; body: unknown }> = [];
  let reject = true;
  globalThis.fetch = (async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(reject ? { error: 'conflict', message: '旧引用归属不明确', details: {} } : { content: 'version: 2', changes: [{ path: 'agentProfiles[0].id', before: 'assistant', after: '01a0bf5d-8f4b-7001-8458-107366e7de39' }] }), { status: reject ? 409 : 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  function Harness() {
    const [draft, setDraft] = useState('version: 1'); change = setDraft;
    const noop = () => {};
    const editor: FileEditorHandle = { file: undefined, draft, dirty: true, busy: false, conflict: false, error: undefined, pendingAction: undefined, confirmDiscard: noop, cancelDiscard: noop, openFile: noop, discardAndOpen: noop, change: setDraft, save: () => { throw new Error('must not save'); }, reload: noop, dismissConflict: noop, close: noop };
    return <><output>{draft}</output><ManifestUpgradeNotice serviceId="01a0bf5d-8f4b-7002-9560-94caf593fb19" editor={editor} /></>;
  }
  page = await renderElement(<Harness />, messages);
  expect(requests).toHaveLength(0);
  await page.click('预览资源引用升级'); expect(page.text()).toContain('旧引用归属不明确');
  reject = false; await page.click('预览资源引用升级');
  expect(requests[1]).toEqual({ url: '/v1/services/01a0bf5d-8f4b-7002-9560-94caf593fb19/manifest-upgrade', body: { content: 'version: 1' } });
  expect(page.text()).toContain('agentProfiles[0].id');
  await act(async () => change('my new draft'));
  expect(page.button('应用到草稿').disabled).toBe(true); expect(page.text()).toContain('草稿已经变化');
  await page.click('应用到草稿'); expect(page.host.querySelector('output')!.textContent).toBe('my new draft');
  await page.click('预览资源引用升级'); await page.click('应用到草稿');
  expect(page.host.querySelector('output')!.textContent).toBe('version: 2'); expect(requests).toHaveLength(3);
});
