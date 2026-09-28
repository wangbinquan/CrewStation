import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { ExecutionCostVisibilityDtoSchema, type SetExecutionCostVisibility, type ExecutionCostVisibilityDto } from '@crewstation/contracts';
import { RUNTIME_IMAGES } from './computeProfileFixture';
import { adminDirectoryFixture } from './adminDirectoryFixture';
import { openDialog } from './confirmDialogDriver';
import { renderApp } from './renderApp';

let page: Awaited<ReturnType<typeof renderApp>> | undefined;
const originalFetch = globalThis.fetch;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
function backend() {
  const directory = adminDirectoryFixture({ count: 75 }), delegate = globalThis.fetch;
  const state = { conflict: false, dropResponse: false, readError: false };
  const writes: Array<{ id: string; input: SetExecutionCostVisibility }> = [], reads: string[] = [];
  const values = new Map<string, ExecutionCostVisibilityDto>(), receipts = new Map<string, ExecutionCostVisibilityDto>();
  const current = (id: string) => values.get(id) ?? ExecutionCostVisibilityDtoSchema.parse({ projectId: id, revision: 0, visibility: 'hidden', updatedAt: null });
  globalThis.fetch = (async (raw: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(String(raw), 'http://localhost'), match = url.pathname.match(/^\/v1\/admin\/observability\/projects\/([^/]+)\/cost-visibility$/);
    if (url.pathname === '/v1/admin/runtime-images') return Response.json(RUNTIME_IMAGES);
    if (!match) return delegate(raw, options);
    const id = match[1]!;
    if (options?.method !== 'PUT') {
      reads.push(id);
      return state.readError ? Response.json({ error: 'unavailable', message: '可见性读取暂时失败', details: {} }, { status: 503 }) : Response.json(current(id));
    }
    const input = JSON.parse(String(options.body)) as SetExecutionCostVisibility; writes.push({ id, input });
    if (receipts.has(input.requestKey)) return Response.json(receipts.get(input.requestKey));
    if (state.conflict || input.expectedRevision !== current(id).revision) return Response.json({ error: 'conflict', message: '可见性版本已变更', details: {} }, { status: 409 });
    const result = ExecutionCostVisibilityDtoSchema.parse({ projectId: id, revision: input.expectedRevision + 1, visibility: input.visibility, updatedAt: new Date().toISOString() });
    values.set(id, result); receipts.set(input.requestKey, result);
    if (state.dropResponse) { state.dropResponse = false; throw new TypeError('Save receipt lost'); }
    return Response.json(result);
  }) as typeof fetch;
  return { directory, state, writes, reads, values, current };
}
async function choose(value: string) {
  const select = openDialog().querySelector('select');
  if (!select) throw new Error('No visibility selector');
  await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await page!.settle();
}
async function close() { await act(async () => openDialog().dispatchEvent(new Event('cancel', { cancelable: true }))); await page!.settle(); }
async function lastRow() {
  const button = [...openDialog().querySelectorAll('tbody button')].at(-1)! as HTMLButtonElement;
  if (!button) throw new Error('No project row');
  button.focus(); await act(async () => button.click()); await page!.settle(); return button;
}
async function openManager() { page = await renderApp('/admin/compute?tab=pricing&q=original'); await page.click('项目金额可见性'); }

describe('RFC-034 project cost visibility in token pricing', () => {
  test('last-row editor keeps the project page, focus and cancelled draft with no bulk settings reads', async () => {
    const b = backend(); await openManager();
    expect(b.reads).toEqual([]); expect(openDialog().querySelectorAll('tbody tr')).toHaveLength(20);
    const trigger = await lastRow();
    expect(openDialog().querySelector('h2')?.textContent).toContain('管理项目 57');
    expect(openDialog().textContent).toContain('人民币'); expect(b.reads).toHaveLength(1);
    await choose('project-members-and-services'); await close();
    expect(document.activeElement).toBe(trigger); expect(openDialog().querySelectorAll('tbody tr')).toHaveLength(20);
    await lastRow(); expect(openDialog().querySelector('select')?.value).toBe('project-members-and-services');
    await page!.click('保存可见性');
    expect(b.writes).toHaveLength(1); expect(b.writes[0]?.input).toMatchObject({ expectedRevision: 0, visibility: 'project-members-and-services' });
    expect(openDialog().querySelector('h2')?.textContent).toBe('项目金额可见性');
    await close(); expect(page!.search()).toMatchObject({ tab: 'pricing', q: 'original' });
    expect(b.directory.writes()).toEqual([]);
  });
  test('paging and switching projects use nested dialogs and preserve the original draft', async () => {
    const b = backend(); await openManager(); await page!.click('下一页');
    expect(openDialog().querySelectorAll('tbody tr')).toHaveLength(5);
    await lastRow(); expect(openDialog().querySelector('h2')?.textContent).toContain('管理项目 72');
    await choose('project-members-and-services'); await close();
    const first = openDialog().querySelector<HTMLButtonElement>('tbody button')!;
    await act(async () => first.click()); await page!.settle();
    expect(openDialog().getAttribute('role')).toBe('alertdialog');
    await close();
    expect(openDialog().querySelector('h2')?.textContent).toContain('管理项目 72');
    expect(openDialog().querySelector('select')?.value).toBe('project-members-and-services');
    await close(); expect(openDialog().querySelectorAll('tbody tr')).toHaveLength(5); expect(b.writes).toEqual([]);
  });
  test('CAS review preserves selection and lost receipt retry submits the same request', async () => {
    const b = backend(); await openManager(); await lastRow(); await choose('project-members-and-services');
    b.state.conflict = true; await page!.click('保存可见性');
    const first = b.writes[0]!;
    b.values.set(first.id, { ...b.current(first.id), revision: 2 });
    await page!.click('核对当前可见性'); expect(openDialog().textContent).toContain('当前版本 2');
    await page!.click('基于此版本继续编辑'); expect(openDialog().querySelector('select')?.value).toBe('project-members-and-services');
    b.state.conflict = false; b.state.dropResponse = true; await page!.click('保存可见性');
    expect(b.current(first.id).revision).toBe(3); expect(openDialog().textContent).toContain('Save receipt lost');
    await page!.click('保存可见性');
    expect(b.writes).toHaveLength(3); expect(b.writes[1]?.input.expectedRevision).toBe(2);
    expect(b.writes[1]?.input.requestKey).not.toBe(first.input.requestKey); expect(b.writes[2]).toEqual(b.writes[1]);
    expect(openDialog().querySelector('h2')?.textContent).toBe('项目金额可见性');
  });
  // A lost receipt can leave the server at a different value from the old base.
  test('returning to the original choice after an unconfirmed save still requires reconciliation', async () => {
    const b = backend(); await openManager(); await lastRow(); await choose('project-members-and-services');
    b.state.dropResponse = true; await page!.click('保存可见性');
    const id = b.writes[0]!.id;
    expect(b.current(id)).toMatchObject({ revision: 1, visibility: 'project-members-and-services' });
    await choose('hidden');
    expect(openDialog().querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
    await page!.click('核对当前可见性'); expect(openDialog().textContent).toContain('当前版本 1');
    await page!.click('基于此版本继续编辑'); expect(openDialog().querySelector('select')?.value).toBe('hidden');
    await page!.click('保存可见性');
    expect(b.current(id)).toMatchObject({ revision: 2, visibility: 'hidden' });
    expect(b.writes[1]!.input).toMatchObject({ expectedRevision: 1, visibility: 'hidden' });
  });
  test('unavailable setting stays read-only until a valid response arrives', async () => {
    const b = backend(); b.state.readError = true; await openManager(); await lastRow();
    expect(openDialog().textContent).toContain('可见性读取暂时失败');
    expect(openDialog().querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(openDialog().querySelector('select')).toBeNull(); expect(b.writes).toEqual([]);
    b.state.readError = false; await page!.reread();
    expect(openDialog().querySelector('select')?.value).toBe('hidden');
  });
});
