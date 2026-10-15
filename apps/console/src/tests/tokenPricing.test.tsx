// RFC-034 v2 §3.3：价格线 = 算力档位 × 实际模型，每次保存追加版本（expectedLatestId 比较并设置）；
// 冲突保留草稿并核对最新版本；留空是未知、0 是免费；内置价格线与新增模型。
import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import type { ObservationPrice, ObservationPricingDirectory, SaveObservationPrice } from '@crewstation/contracts';
import { act } from 'react';
import { ADMIN_ID, computeBackend, profileDetail, profileIdOf } from './computeProfileFixture';
import { openDialog } from './confirmDialogDriver';
import { renderApp } from './renderApp';
import { initialTokenPriceDraft, tokenPriceRequest } from '../features/admin/model/tokenPriceDraft';
import { parseComputeSearch } from '../features/admin/model/computeSearch';

let page: Awaited<ReturnType<typeof renderApp>> | undefined;
let restore: (() => void) | undefined;
afterEach(() => { page?.unmount(); page = undefined; restore?.(); restore = undefined; });
const root = '/v1/admin/observability/pricing';

function backend() {
  const base = computeBackend([profileDetail()]), previous = globalThis.fetch, profileId = profileIdOf('price-a');
  const versions: ObservationPrice[] = [], writes: Array<{ profileId: string; input: SaveObservationPrice }> = [];
  const latest = (id: string, model: string) => versions.filter((row) => row.profileId === id && row.model === model).at(-1) ?? null;
  const append = (id: string, input: Omit<SaveObservationPrice, 'expectedLatestId'>): ObservationPrice => {
    const version = { id: Bun.randomUUIDv7(), profileId: id, model: input.model, rates: input.rates, effectiveFrom: input.effectiveFrom, createdAt: new Date().toISOString(), createdBy: ADMIN_ID, note: input.note };
    versions.push(version);
    return version;
  };
  const lines = (id: string, models: readonly string[]) => [...new Set([...models, ...versions.filter((row) => row.profileId === id).map((row) => row.model)])]
    .map((model) => ({ model, calls: model === 'zhipu/glm-5' ? 12 : 0, current: latest(id, model) }));
  const directory = (): ObservationPricingDirectory => ({ profiles: [
    { profileId, name: 'price-a', protocol: 'opencode', builtin: false, configuredModel: 'zhipu/glm-5', models: lines(profileId, ['zhipu/glm-5']) },
    { profileId: 'builtin:claude-code', name: 'claude-code', protocol: 'claude-code', builtin: true, configuredModel: null, models: lines('builtin:claude-code', []) },
  ] });
  globalThis.fetch = (async (raw: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(String(raw), 'http://localhost');
    if (!url.pathname.startsWith(root)) return previous(raw, options);
    if (url.pathname === root) return Response.json(directory());
    const [, encoded, history] = /^\/v1\/admin\/observability\/pricing\/([^/]+)(\/history)?$/.exec(url.pathname)!, id = decodeURIComponent(encoded!);
    if (history) return Response.json({ items: versions.filter((row) => row.profileId === id && row.model === url.searchParams.get('model')).reverse() });
    const input = JSON.parse(String(options!.body)) as SaveObservationPrice;
    writes.push({ profileId: id, input });
    if ((latest(id, input.model)?.id ?? null) !== input.expectedLatestId) return Response.json({ error: 'conflict', message: '这条价格线在打开后已被修改，请刷新后再保存', details: { code: 'price_conflict' } }, { status: 409 });
    return Response.json(append(id, input), { status: 201 });
  }) as typeof fetch;
  restore = () => { globalThis.fetch = previous; base.restore(); };
  return { profileId, versions, writes, append, runtimeWrites: base.writes };
}
function field(label: string) {
  const node = [...openDialog().querySelectorAll('label')].find((item) => item.querySelector('span')?.textContent === label)?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
  if (!node) throw new Error('Missing price field ' + label);
  return node;
}
async function type(label: string, value: string) {
  const node = field(label);
  await act(async () => {
    // 受控输入：先聚焦，再用原生 setter 写值并派发 input／keyup，React 才认作一次用户输入。
    node.focus();
    const prototype = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  });
  await page!.settle();
}
async function rowButton(model: string, label: string) {
  const button = [...document.querySelectorAll(`tr[data-price-model="${model}"] button`)].find((node) => node.textContent === label) as HTMLButtonElement;
  button.focus(); await act(async () => button.click()); await page!.settle();
  return button;
}
const rowText = (model: string) => document.querySelector(`tr[data-price-model="${model}"]`)?.textContent ?? '';
const dialogOpen = () => document.querySelector('dialog[open]') !== null;

describe('RFC-034 v2 token pricing', () => {
  test('each profile lists its configured model; saving appends a version against the current one', async () => {
    const b = backend(); page = await renderApp('/admin/compute?tab=pricing');
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Token 成本');
    expect(rowText('zhipu/glm-5')).toContain('档位配置'); expect(rowText('zhipu/glm-5')).toContain('12 次执行'); expect(rowText('zhipu/glm-5')).toContain('未定价');
    expect(page.text()).toContain('还没有配置模型，也没有执行用过的模型');
    await rowButton('zhipu/glm-5', '配置价格');
    expect(openDialog().querySelector('h2')?.textContent).toBe('price-a · Token 成本');
    expect((field('实际模型') as HTMLInputElement).readOnly).toBe(true);
    await type('输入', '-1'); await type('缓存读取', '0.5'); await type('输出', '8');
    await page.click('保存价格版本');
    expect(openDialog().textContent).toContain('最多 6 位小数'); expect(b.writes).toHaveLength(0);
    await type('输入', '2'); await page.click('保存价格版本');
    expect(dialogOpen()).toBe(false);
    expect(b.writes[0]?.input).toMatchObject({ model: 'zhipu/glm-5', rates: { input: '2', cacheRead: '0.5', cacheWrite: null, output: '8' }, expectedLatestId: null });
    expect(rowText('zhipu/glm-5')).toContain('输入 ¥2 · 缓存读取 ¥0.5 · 缓存写入 未知 · 输出 ¥8');
    await rowButton('zhipu/glm-5', '配置价格');
    expect(field('输入').value).toBe('2');
    await type('输入', '3'); await page.click('保存价格版本');
    expect(b.writes[1]?.input.expectedLatestId).toBe(b.versions[0]!.id); expect(b.versions).toHaveLength(2);
    await rowButton('zhipu/glm-5', '价格历史');
    expect([...openDialog().querySelectorAll('tbody tr')].map((row) => row.querySelectorAll('td')[1]?.textContent)).toEqual(['¥3', '¥2']);
    expect(b.runtimeWrites).toEqual([]);
  });

  test('a concurrent version makes the save conflict; the draft stays and continues from the latest version', async () => {
    const b = backend(); page = await renderApp('/admin/compute?tab=pricing');
    await rowButton('zhipu/glm-5', '配置价格'); await type('输入', '4'); await type('输出', '9');
    const other = b.append(b.profileId, { model: 'zhipu/glm-5', rates: { input: '1', cacheRead: null, cacheWrite: null, output: '2' }, effectiveFrom: new Date().toISOString(), note: 'other admin' });
    await page.click('保存价格版本');
    expect(openDialog().textContent).toContain('已被修改'); expect(field('输入').value).toBe('4');
    await page.click('核对当前价格版本');
    expect(openDialog().textContent).toContain('单价 1 / — / — / 2');
    await page.click('基于此版本继续编辑');
    await page.click('保存价格版本');
    expect(b.writes.map((write) => write.input.expectedLatestId)).toEqual([null, other.id]);
    expect(dialogOpen()).toBe(false);
  });

  test('a new model needs its name; an empty rate is unknown while 0 is explicitly free', async () => {
    const b = backend(); page = await renderApp('/admin/compute?tab=pricing&q=claude');
    expect(page.search()).toMatchObject({ tab: 'pricing', q: 'claude' });
    expect(page.text()).toContain('内置'); expect(page.text()).not.toContain('price-a');
    await page.click('添加模型价格');
    expect((field('实际模型') as HTMLInputElement).readOnly).toBe(false);
    await type('输入', '0'); await page.click('保存价格版本');
    expect(openDialog().textContent).toContain('请填写有效值'); expect(b.writes).toHaveLength(0);
    await type('实际模型', 'anthropic/claude-sonnet'); await page.click('保存价格版本');
    expect(b.writes[0]).toMatchObject({ profileId: 'builtin:claude-code', input: { model: 'anthropic/claude-sonnet', rates: { input: '0', cacheRead: null, cacheWrite: null, output: null }, expectedLatestId: null } });
    expect(rowText('anthropic/claude-sonnet')).toContain('输入 ¥0 · 缓存读取 未知');
  });

  test('draft requests keep unknown distinct from zero and reject bad time or precision', () => {
    const now = Date.parse('2026-10-14T00:00:00Z'), current: ObservationPrice = { id: 'v1', profileId: 'p', model: 'm', rates: { input: '2', cacheRead: null, cacheWrite: null, output: '8' },
      effectiveFrom: '2026-10-01T00:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z', createdBy: ADMIN_ID, note: '' };
    const draft = initialTokenPriceDraft('m', current, now);
    expect(draft).toMatchObject({ model: 'm', input: '2', cacheRead: '', output: '8' });
    expect(tokenPriceRequest({ ...draft, cacheRead: '0' }, 'v1').input).toMatchObject({ rates: { input: '2', cacheRead: '0', cacheWrite: null, output: '8' }, expectedLatestId: 'v1' });
    expect(tokenPriceRequest({ ...draft, effectiveFrom: 'invalid' }, 'v1').errors.effectiveFrom).toBeDefined();
    expect(tokenPriceRequest({ ...draft, input: '0.0000001' }, 'v1').errors.input).toBeDefined();
    expect(tokenPriceRequest({ ...draft, model: ' ' }, null).errors.model).toBeDefined();
    expect(parseComputeSearch({ tab: 'pricing', q: ' model ', create: true })).toEqual({ tab: 'pricing', q: 'model' });
  });
});
