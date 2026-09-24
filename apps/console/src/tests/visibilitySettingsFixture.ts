import type { AppPresentationDto, AppVisibilityDto, UserId } from '@crewstation/contracts';
import { act } from 'react';
import type { RenderedApp } from './renderApp';

export const settingsProjectId = '01a0bf5d-8f4b-7aef-84b8-c458233bab22', settingsUserId = '01a0bf5d-8f4b-7f8b-8136-e631380738b0' as UserId;
export const visibilitySettingsRoute = `/projects/${settingsProjectId}/settings?tab=visibility`;
interface SettingsWrite { readonly path: string; readonly input: Record<string, unknown> }

/** 真实路由与 query/mutation，只替换 HTTP 边界；两份设置有独立服务器修订。 */
export function visibilitySettingsFixture() {
  const state = {
    visibility: { mode: 'members', allowRequests: true, revision: 0, updatedAt: null, canConfigure: true } as AppVisibilityDto,
    presentation: { description: '整理团队知识', icon: 'book', revision: 0, updatedAt: null } as AppPresentationDto,
    failure: '' as '' | 'me' | 'app-visibility' | 'app-presentation',
    role: 'owner', failWrite: false, hold: undefined as Promise<void> | undefined,
  };
  const writes: SettingsWrite[] = [];
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname, method = init?.method ?? 'GET';
    let body: unknown = { items: [] }, status = 200;
    if (method === 'PUT') {
      const input = JSON.parse(String(init?.body)) as Record<string, unknown>; writes.push({ path, input });
      if (state.hold) await state.hold;
      const key = path.endsWith('app-visibility') ? 'visibility' : 'presentation';
      if (state.failWrite) { status = 503; body = { error: 'unavailable', message: '设置保存失败' }; }
      else if (input.expectedRevision !== state[key].revision) { status = 409; body = { error: 'conflict', message: '设置已被另一负责人修改' }; }
      else if (key === 'visibility') { state.visibility = { ...state.visibility, ...input, revision: state.visibility.revision + 1 }; body = state.visibility; }
      else { state.presentation = { ...state.presentation, ...input, revision: state.presentation.revision + 1 }; body = state.presentation; }
    } else if (state.failure && path.endsWith(`/${state.failure}`)) { status = 503; body = { error: 'unavailable', message: '最新设置暂不可读取' }; }
    else if (path === '/v1/me') body = { id: settingsUserId, name: '负责人', email: 'owner@test.invalid', platformRole: 'developer', isAdmin: false, memberships: [{ projectId: settingsProjectId, role: state.role }] };
    else if (path === `/v1/projects/${settingsProjectId}`) body = { id: settingsProjectId, serviceId: '01a0bf5d-8f4b-7d97-81d1-7163b23b1d2e', slug: 'knowledge', name: '知识助理', kind: 'DigitalWorker', ownerUserId: settingsUserId, state: 'active' };
    else if (path.endsWith('/app-visibility')) body = state.visibility;
    else if (path.endsWith('/app-presentation')) body = state.presentation;
    else if (path.endsWith('/member-candidates')) body = { items: [{ userId: settingsUserId, name: '小林', email: 'lin@example.com' }] };
    else if (path.endsWith('/dev-session')) { status = 404; body = { error: 'not_found', message: '无会话' }; }
    return Response.json(body, { status });
  }) as typeof fetch;
  return { state, writes };
}

/** 开着的设置弹窗：展示资料与可见范围各是一个弹窗（2026-09-23 起），同一时刻只开一个。 */
export const openSettingDialog = () => document.querySelector<HTMLDialogElement>('dialog[open]');
/** 设置字段：开着弹窗时在弹窗里找（背后页面上的查找框同名）。 */
export const settingsField = (label: string) => [...(openSettingDialog() ?? document).querySelectorAll('label')].find((node) => node.textContent?.startsWith(label))!.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')!;
export const settingsButton = (label: string, root?: ParentNode) => {
  const find = (scope: ParentNode) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find((node) => !node.closest('[hidden]') && node.textContent === label);
  const dialog = openSettingDialog();
  return (root ? find(root) : (dialog ? find(dialog) : undefined) ?? find(document))!;
};
export const settingsForm = (label: string) => settingsField(label).closest('form')!;
/** 字段属于哪个弹窗：弹窗标题就是打开它的按钮文案。 */
const DIALOG_OF: Record<string, string> = { 可见范围: '修改可见范围', 申请: '修改可见范围', 应用用途: '修改展示资料', 应用图标: '修改展示资料' };
/** 关掉开着的设置弹窗：「取消」只关窗，草稿留着。 */
export async function closeSetting(page: RenderedApp) {
  const dialog = openSettingDialog();
  if (dialog) await clickSetting(page, '取消', dialog);
}
/** 打开某个设置弹窗；另一个开着就先关掉它。 */
export async function openSetting(page: RenderedApp, opener: string) {
  const dialog = openSettingDialog();
  if (dialog?.querySelector('h2')?.textContent === opener) return;
  if (dialog) await closeSetting(page);
  await clickSetting(page, opener);
}
export async function editSetting(page: RenderedApp, label: string, value: string) {
  await openSetting(page, DIALOG_OF[label]!);
  const field = settingsField(label);
  await act(async () => {
    field.focus();
    const prototype = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  });
  await page.settle();
}
export async function clickSetting(page: RenderedApp, label: string, root?: ParentNode) {
  const button = settingsButton(label, root);
  if (!button) throw new Error(`找不到设置操作：${label}`);
  await act(async () => { button.focus(); button.click(); }); await page.settle();
}
