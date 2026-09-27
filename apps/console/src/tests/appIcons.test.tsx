import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act, useState } from 'react';
import { AppIcon } from '../shared/ui/icons/AppIcon';
import { appIconSources, applicationOrigin } from '../shared/ui/icons/appIconSources';
import { usePresentationEditor } from '../features/projects/model/usePresentationEditor';
import { renderElement } from './renderElement';
import type { AppPresentationDto } from '@crewstation/contracts';

let page: Awaited<ReturnType<typeof renderElement>> | undefined;
const original = globalThis.fetch;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = original; });

test('icon candidates honor manual source, root paths, application origin and limited fallback', () => {
  expect(applicationOrigin('https://bad.test')).toBeUndefined();
  expect(applicationOrigin('user@bad.test')).toBeUndefined();
  expect(applicationOrigin('app.test:8080')).toBe('http://app.test:8080');
  expect(appIconSources('p', { kind: 'upload', revision: 2 }, 'https://app.test')).toEqual(['/v1/apps/p/icon?revision=2', 'https://app.test/favicon.ico']);
  expect(appIconSources('p', { kind: 'url', url: '/brand.png' }, 'https://beta.test')).toEqual(['https://beta.test/brand.png', 'https://beta.test/favicon.ico']);
  expect(appIconSources('p', { kind: 'url', url: '/brand.png' })).toEqual([]);
  expect(appIconSources('p', { kind: 'url', url: 'javascript:alert(1)' })).toEqual([]);
  expect(appIconSources('p', { kind: 'url', url: 'https://app.test/favicon.ico' }, 'https://app.test')).toHaveLength(1);
});

test('a failed custom image tries favicon once, then keeps the platform glyph without a broken image', async () => {
  page = await renderElement(<AppIcon projectId="p" icon="book" source={{ kind: 'url', url: 'https://cdn.test/a.png' }} applicationOrigin="https://app.test" />, {});
  const img = () => page!.host.querySelector('img');
  expect(img()?.getAttribute('src')).toBe('https://cdn.test/a.png');
  expect(img()?.getAttribute('referrerpolicy')).toBe('no-referrer');
  await act(async () => img()!.dispatchEvent(new Event('error'))); await page.settle();
  expect(img()?.getAttribute('src')).toBe('https://app.test/favicon.ico');
  await act(async () => img()!.dispatchEvent(new Event('error'))); await page.settle();
  expect(img()).toBeNull(); expect(page.host.querySelector('svg')).not.toBeNull();
});

test('invalid upload is blocked; selected image and description use one multipart revision write', async () => {
  let editor!: ReturnType<typeof usePresentationEditor>;
  const writes: RequestInit[] = [];
  globalThis.fetch = (async (_url, init) => { writes.push(init!); return Response.json({ description: 'Brand', icon: 'book', revision: 3, updatedAt: null, iconSource: { kind: 'upload', revision: 3 } }); }) as typeof fetch;
  const saved: AppPresentationDto = { description: '', icon: 'book', revision: 2, updatedAt: null };
  function Harness() { editor = usePresentationEditor('p', saved, async () => {}, true); return null; }
  page = await renderElement(<Harness />, {});
  await act(async () => { editor.chooseSource({ kind: 'upload', revision: 0 }); });
  expect(editor.canSubmit).toBe(false);
  await act(async () => editor.chooseFile(new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' })));
  expect(editor.fileError).toBe(true); expect(editor.canSubmit).toBe(false);
  await act(async () => editor.chooseFile(new File(['PNG'], 'x.png', { type: 'image/png' })));
  await act(async () => editor.describe('Brand'));
  expect(editor.canSubmit).toBe(true); expect(editor.preview?.startsWith('blob:')).toBe(true);
  await act(async () => editor.submit(document.body)); await page.settle();
  expect(writes).toHaveLength(1);
  const data = writes[0]!.body as FormData;
  expect(data.get('file')).toBeInstanceOf(File);
  expect(JSON.parse(String(data.get('presentation')))).toEqual({ description: 'Brand', icon: 'book', expectedRevision: 2 });
  expect(new Headers(writes[0]!.headers).has('content-type')).toBe(false);
  expect(editor.dirty).toBe(false); expect(editor.preview).toBeUndefined();
});

test('a stalled candidate times out once; changing source retries without stale errors skipping the new image', async () => {
  let change!: (revision: number) => void, timeout: (() => void) | undefined;
  const statuses: string[] = [], setTimer = window.setTimeout;
  window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (delay === 3000 && typeof callback === 'function') { timeout = () => callback(); return setTimer(() => {}, 60_000); }
    return setTimer(callback, delay, ...args);
  }) as typeof window.setTimeout;
  function Harness() {
    const [revision, setRevision] = useState(1); change = setRevision;
    return <AppIcon projectId="p" icon="book" source={{ kind: 'url', url: `https://cdn.test/icon-${revision}.png` }} applicationOrigin="https://app.test" onStatus={(status) => statuses.push(status)} />;
  }
  try {
    page = await renderElement(<Harness />, {});
    const originalImage = page.host.querySelector('img')!;
    expect(typeof timeout).toBe('function');
    await act(async () => timeout!()); await page.settle();
    expect(page.host.querySelector('img')?.getAttribute('src')).toBe('https://app.test/favicon.ico');
    await act(async () => originalImage.dispatchEvent(new Event('error'))); await page.settle();
    expect(page.host.querySelector('img')?.getAttribute('src')).toBe('https://app.test/favicon.ico');
    await act(async () => change(2)); await page.settle();
    const current = page.host.querySelector('img')!;
    expect(current.getAttribute('src')).toBe('https://cdn.test/icon-2.png');
    Object.defineProperty(current, 'naturalWidth', { configurable: true, value: 128 });
    await act(async () => current.dispatchEvent(new Event('load'))); await page.settle();
    expect(statuses.at(-1)).toBe('loaded');
  } finally { window.setTimeout = setTimer; }
});
