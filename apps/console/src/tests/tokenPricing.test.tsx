import './domSetup';
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { TokenPriceVersionSchema } from '@crewstation/contracts';
import type { SaveTokenPrice, TokenPriceProfile, TokenPriceVersion } from '@crewstation/contracts';
import { act } from 'react';
import { computeBackend, ADMIN_ID, profileDetail, profileIdOf } from './computeProfileFixture';
import { renderApp } from './renderApp';
import { openDialog } from './confirmDialogDriver';
import { initialTokenPriceDraft, tokenPriceRequest } from '../features/admin/model/tokenPriceDraft';
import { parseComputeSearch } from '../features/admin/model/computeSearch';

let page: Awaited<ReturnType<typeof renderApp>> | undefined;
let restore: (() => void) | undefined;
afterEach(() => { page?.unmount(); page = undefined; restore?.(); restore = undefined; });
const root = '/v1/admin/observability/pricing/profiles';
function backend() {
  const base = computeBackend([profileDetail()]);
  const previous = globalThis.fetch;
  const profiles: TokenPriceProfile[] = Array.from({ length: 24 }, (_, i) => ({
    id: profileIdOf('price-' + i), name: 'price-' + i, protocol: i === 0 ? 'terminal' : 'opencode',
    revision: 1, model: 'model-' + i, pricingRevision: 0,
  }));
  const versions: TokenPriceVersion[] = [], writes: Array<{ id: string; input: SaveTokenPrice }> = [];
  const state = { conflict: false, dropResponse: false };
  const receipts = new Map<string, TokenPriceVersion>();
  globalThis.fetch = (async (raw: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(String(raw), 'http://localhost');
    if (!url.pathname.startsWith(root)) return previous(raw, options);
    if (url.pathname === root) return Response.json({ items: profiles });
    const id = url.pathname.split('/').at(-2)!;
    if (options?.method === 'POST') {
      const input = JSON.parse(String(options.body)) as SaveTokenPrice;
      writes.push({ id, input });
      const receipt = receipts.get(input.requestKey);
      if (receipt) return Response.json(receipt, { status: 201 });
      const current = profiles.find((row) => row.id === id)!;
      if (input.profileRevision !== current.revision || input.protocol !== current.protocol) return Response.json({ error: 'conflict', message: '算力档位已变更', details: { code: 'profile_revision_conflict', profileRevision: current.revision } }, { status: 409 });
      if (state.conflict) return Response.json({ error: 'conflict', message: '价格已更新，草稿已保留', details: { revision: 4 } }, { status: 409 });
      const { expectedRevision, requestKey, ...price } = input;
      const version = TokenPriceVersionSchema.parse({ ...price, id: Bun.randomUUIDv7(), profileId: id, revision: expectedRevision + 1, createdAt: new Date().toISOString(), createdBy: ADMIN_ID });
      versions.push(version);
      receipts.set(requestKey, version);
      current.pricingRevision = version.revision;
      if (state.dropResponse) { state.dropResponse = false; throw new TypeError('Network response lost'); }
      return Response.json(version, { status: 201 });
    }
    const limit = Number(url.searchParams.get('limit') ?? '50'), before = Number(url.searchParams.get('beforeRevision') ?? '9999');
    const all = versions.filter((row) => row.profileId === id && row.revision < before).reverse();
    const items = all.slice(0, limit);
    return Response.json({ items, revision: state.conflict ? 4 : profiles.find((row) => row.id === id)?.pricingRevision ?? 0, ...(all.length > limit ? { nextBeforeRevision: items.at(-1)!.revision } : {}) });
  }) as typeof fetch;
  restore = () => { globalThis.fetch = previous; base.restore(); };
  return { profiles, versions, writes, state, runtimeWrites: base.writes };
}
function field(label: string) {
  const node = [...openDialog().querySelectorAll('label')].find((item) => item.querySelector('span')?.textContent === label)?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
  if (!node) throw new Error('Missing price field ' + label);
  return node;
}
async function type(label: string, value: string) {
  const node = field(label);
  await act(async () => {
    node.focus();
    const prototype = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  });
  await page!.settle();
}
async function openLast() {
  const button = [...document.querySelectorAll('tbody button')].filter((node) => node.textContent === '配置 Token 单价').at(-1)! as HTMLButtonElement;
  button.focus(); await act(async () => button.click()); await page!.settle();
  return button;
}
async function close() { await act(async () => openDialog().dispatchEvent(new Event('cancel', { cancelable: true }))); await page!.settle(); }
async function fill() {
  await type('模型服务 / Provider', 'example');
  await type('非缓存输入', '0.1');
  await type('缓存读取', '0');
  await type('输出', '1.2');
  await type('定价来源 / 说明', 'configured CNY price');
}
describe('RFC-034 token pricing user flow', () => {
  test('cost tab, last-row dialog, invalid price, close/reopen draft and independent CNY save', async () => {
    const b = backend();

    page = await renderApp('/admin/compute?tab=pricing&q=price');

    expect(page.search()).toMatchObject({ tab: 'pricing', q: 'price' });
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Token 成本');
    const trigger = await openLast();

    expect(openDialog().querySelector('h2')?.textContent).toContain('price-23');
    await fill();

    await type('非缓存输入', '-1'); await page.click('保存价格版本');

    expect(openDialog().textContent).toContain('最多 6 位小数'); expect(b.writes).toHaveLength(0);
    await type('非缓存输入', '0.1');
    await close(); expect(document.activeElement === trigger).toBe(true);
    await openLast(); expect(field('非缓存输入').value).toBe('0.1');
    await page.click('保存价格版本');
    expect(document.querySelector('dialog[open]')?.textContent ?? null).toBeNull();
    expect(b.writes).toHaveLength(1);
    expect(b.writes[0]?.input).toMatchObject({ currency: 'CNY', profileRevision: 1, expectedRevision: 0, rates: { input: '0.1', cacheRead: '0', cacheWrite: null, output: '1.2' } });
    expect(b.runtimeWrites).toEqual([]);
    expect(page.search()).toMatchObject({ tab: 'pricing', q: 'price' });
    const history = [...document.querySelectorAll('tbody button')].filter((node) => node.textContent === '价格历史').at(-1)! as HTMLButtonElement;
    await act(async () => history.click()); await page.settle();
    expect(openDialog().textContent).toContain('¥0.1'); expect(openDialog().textContent).toContain('CNY-v1');
    expect(openDialog().textContent).not.toContain('$'); await close();
  });
  test('conflict retains draft and requires checking the latest revision before retry', async () => {
    const b = backend(); b.state.conflict = true;
    page = await renderApp('/admin/compute?tab=pricing');
    await openLast(); await fill(); await page.click('保存价格版本');
    expect(openDialog().textContent).toContain('草稿已保留'); expect(field('非缓存输入').value).toBe('0.1');
    const key = b.writes[0]!.input.requestKey;
    await page.click('核对当前价格版本'); expect(openDialog().textContent).toContain('当前价格版本为 4');
    await page.click('基于此版本继续编辑');
    b.state.conflict = false;
    await page.click('保存价格版本');
    expect(b.writes[1]?.input.expectedRevision).toBe(4);
    expect(b.writes[1]?.input.requestKey).not.toBe(key);
    expect(b.runtimeWrites).toEqual([]);
  });
});
describe('RFC-034 price save recovery', () => {
  test('lost save response retries the exact request after its activation time', async () => {
    const b = backend(); b.state.dropResponse = true;
    page = await renderApp('/admin/compute?tab=pricing');
    await openLast(); await fill(); await page.click('保存价格版本');
    expect(b.versions).toHaveLength(1);
    expect(field('非缓存输入').value).toBe('0.1');
    const first = b.writes[0]!.input;
    const now = spyOn(Date, 'now').mockReturnValue(Date.parse(first.effectiveFrom) + 60_000);
    try { await page.click('保存价格版本'); } finally { now.mockRestore(); }
    expect(b.writes).toHaveLength(2);
    expect(b.writes[1]!.input).toEqual(first);
    expect(b.versions).toHaveLength(1);
    expect(document.querySelector('dialog[open]')?.textContent ?? null).toBeNull();
  });
  test('changed profile can be inspected and adopted without discarding or replacing the draft model', async () => {
    const b = backend();
    page = await renderApp('/admin/compute?tab=pricing');
    await openLast(); await fill();
    Object.assign(b.profiles[23]!, { revision: 2, protocol: 'claude-code', model: 'new-default-model' });
    await page.click('保存价格版本');
    expect(openDialog().textContent).toContain('算力档位已变更');
    const firstKey = b.writes[0]!.input.requestKey;
    await close(); await openLast();
    expect(field('实际模型').value).toBe('model-23');
    await page.click('核对当前价格版本');
    expect(openDialog().textContent).toContain('当前档位修订 2 · claude-code · 默认模型 new-default-model');
    await page.click('基于此版本继续编辑');
    expect(field('实际模型').value).toBe('model-23');
    expect(field('非缓存输入').value).toBe('0.1');
    await page.click('保存价格版本');
    expect(b.writes[1]?.input).toMatchObject({ profileRevision: 2, protocol: 'claude-code', model: 'model-23', rates: { input: '0.1' } });
    expect(b.writes[1]?.input.requestKey).not.toBe(firstKey);
    expect(b.runtimeWrites).toEqual([]);
    expect(document.querySelector('dialog[open]')?.textContent ?? null).toBeNull();
  });
});
describe('RFC-034 price draft validation', () => {
  test('unsupported terminal, empty history, clear, and leaving a dirty draft use existing UI behavior', async () => {
    const b = backend();
    page = await renderApp('/admin/compute?tab=pricing');
    const terminalRow = document.querySelector('tbody tr')!;
    expect((terminalRow.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => (terminalRow.querySelectorAll('button')[1] as HTMLButtonElement).click()); await page.settle();
    expect(openDialog().textContent).toContain('未定价'); await close();
    await openLast(); await fill(); await page.click('清空');
    expect(field('非缓存输入').value).toBe('');
    await fill(); await close();
    await page.requestNavigate('/admin/compute');
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Token 成本');
    await page.click('继续编辑');
    expect(page.search().tab).toBe('pricing');
    expect(b.writes).toEqual([]);
  });
  test('draft validation keeps unknown distinct from zero and rejects invalid time/precision', () => {
    const profile: TokenPriceProfile = { id: profileIdOf('sample'), name: 'sample', protocol: 'opencode', model: null, revision: 1, pricingRevision: 0 };
    const now = Date.parse('2026-09-28T00:00:00Z'), initial = initialTokenPriceDraft(profile, now);
    const draft = { ...initial, provider: 'provider', model: 'actual-model', sourceNote: 'source', input: '0', output: '0.000001' };
    expect(tokenPriceRequest(draft, profile, 0, 'request-key', now).input?.rates).toEqual({ input: '0', output: '0.000001', cacheRead: null, cacheWrite: null });
    expect(tokenPriceRequest({ ...draft, effectiveFrom: 'invalid' }, profile, 0, 'request-key', now).errors.effectiveFrom).toBeDefined();
    expect(tokenPriceRequest({ ...draft, input: '1e3' }, profile, 0, 'request-key', now).errors.input).toBeDefined();
    expect(parseComputeSearch({ tab: 'pricing', q: ' model ', create: true })).toEqual({ tab: 'pricing', q: 'model' });
  });
});
