import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { ImageMetadata } from '../features/runtime-images/components/ImageMetadata';
import { ImageVersions } from '../features/runtime-images/components/ImageVersions';
import { BuildHistory } from '../features/runtime-images/components/BuildHistory';
import { messages } from '../features/runtime-images/i18n/zh-CN';
import { renderElement } from './renderElement';
import { riImage, runtimeImageConsoleFixture } from './runtimeImageConsoleFixture';
import { api } from '../shared/api/client';
let page: Awaited<ReturnType<typeof renderElement>> | undefined, fixture: ReturnType<typeof runtimeImageConsoleFixture> | undefined;
afterEach(() => { page?.unmount(); fixture?.restore(); page = undefined; fixture = undefined; });
const top = () => [...document.querySelectorAll('dialog[open]')].at(-1)!;
for (const operation of ['image', 'version', 'build'] as const) test(`${operation}: 危险操作必须先核对对象，取消不写入，确认才提交`, async () => {
  fixture = runtimeImageConsoleFixture(true);
  const image = await api.runtimeImages.get(undefined, riImage);
  page = await renderElement(operation === 'image' ? <ImageMetadata projectId={undefined} image={image} editable manageable /> : operation === 'version' ? <ImageVersions projectId={undefined} imageId={riImage} editable manageable owned /> : <BuildHistory projectId={undefined} imageId={riImage} editable />, messages);
  const label = messages[operation === 'image' ? 'images.disableImage' : operation === 'version' ? 'images.disable' : 'images.cancelBuild'];
  await page.click(label);
  // Regression: these actions used to submit immediately without showing their impact.
  expect(fixture.writes).toHaveLength(0); expect(top().getAttribute('role')).toBe('alertdialog');
  expect(top().textContent).toContain(operation === 'image' ? image.name : operation === 'version' ? 'sha256:' : '2026');
  await act(async () => { top().dispatchEvent(new Event('cancel', { cancelable: true })); }); await page.settle();
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(0); expect(fixture.writes).toHaveLength(0);
  await page.click(label);
  await act(async () => { [...top().querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === label)!.click(); }); await page.settle();
  expect(fixture.writes).toHaveLength(1);
});

test('取消失败保留确认弹窗、错误与原构建对象，重试沿用同一请求键', async () => {
  fixture = runtimeImageConsoleFixture(true); fixture.state.cancelFailure = true;
  page = await renderElement(<BuildHistory projectId={undefined} imageId={riImage} editable />, messages);
  await page.click('取消构建'); await page.click('取消构建');
  expect(top().textContent).toContain('cannot cancel now'); expect(top().getAttribute('role')).toBe('alertdialog');
  const request = fixture.writes[0]; fixture.state.cancelFailure = false; await page.click('取消构建');
  expect(fixture.writes[1]).toEqual(request); expect(document.querySelectorAll('dialog[open]')).toHaveLength(0);
});

test('验证取消的 Esc 只关闭顶层确认，保留版本详情并恢复触发按钮焦点', async () => {
  fixture = runtimeImageConsoleFixture(true); fixture.state.validationState = 'running';
  page = await renderElement(<ImageVersions projectId={undefined} imageId={riImage} editable manageable owned />, messages);
  await page.click('用途验证');
  const opener = page.button('取消验证'); opener.focus(); await page.click('取消验证');
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(2); expect(fixture.writes).toHaveLength(0);
  await act(async () => top().dispatchEvent(new Event('cancel', { cancelable: true }))); await page.settle();
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(1); expect(document.activeElement).toBe(opener);
  await page.click('取消验证'); await page.click('取消验证'); expect(fixture.writes.at(-1)?.url).toContain('/validations/');
});
