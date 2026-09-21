import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { resolveCapability } from '../../packages/testkit/capability';
import type { Browser, Page } from './cdp';
import { DEFAULT_CDP_PORT } from './cdp';
import { connectBrowser } from './consoleSession';

/** 样式验收只依赖浏览器，平台网关停机或未登录不应使这层防护跳过。 */
async function browserAvailable(): Promise<boolean> {
  let ready = false;
  try {
    const port = Number(process.env.CS_E2E_CDP_PORT ?? DEFAULT_CDP_PORT);
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    const info = await response.json() as { webSocketDebuggerUrl?: unknown };
    ready = response.ok && typeof info.webSocketDebuggerUrl === 'string';
  } catch { /* 能力闸门统一报告环境缺席。 */ }
  return resolveCapability('e2e', ready, '下拉样式验收所需的调试浏览器不可达');
}

const available = await browserAvailable();
let browser: Browser | undefined, page: Page, context: string;
const source = '../../apps/console/src/';
const read = (path: string) => Bun.file(new URL(`${source}${path}`, import.meta.url)).text();
const [tokens, base, select, field, native] = await Promise.all([
  read('app/theme/tokens.css'), read('app/theme/base.css'), read('shared/ui/selection/Select.css'),
  read('shared/ui/FormField.module.css'), read('features/dev-session/components/native/NativeWorkspace.module.css'),
]);

beforeAll(async () => {
  if (!available) return;
  browser = await connectBrowser();
  context = await browser.newContext();
  page = await browser.newPage(context);
});
afterAll(async () => {
  if (!browser) return;
  await browser.send('Target.disposeBrowserContext', { browserContextId: context });
  browser.close();
});

/** 不依赖身份或业务数据：在隔离页装载生产样式，真实浏览器负责布局、菜单及键盘事件。 */
async function fixture(width = 1280, scheme = 'light') {
  await page.goto('about:blank');
  await page.cmd('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
  await page.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  const html = `<style>${tokens}${base.replace(/@import[^;]+;/g, '')}${select}${field}${native}
    main { margin: 24px auto; padding: 20px; max-width: 640px; width: calc(100% - 32px); background: var(--cs-color-surface); border-radius: 12px; }
    form { display: grid; gap: 20px; } h1 { font-size: 20px; margin-bottom: 20px; } small { color: var(--cs-color-text-muted); }
  </style><main><h1>下拉选择 · CrewStation</h1><form>
    <label class="field"><span>项目状态</span><select id="status" name="status">
      <option value="all">全部状态</option><option value="ready" selected>运行中</option>
      <option value="disabled" disabled>维护中（暂不可选）</option><option value="failed">需要处理</option>
      <option value="long">很长的项目与分支说明 feature/unified-dropdowns-with-a-long-name-and-unbroken-identifier</option>
    </select></label><output id="result">ready</output>
    <label class="field"><span>项目模板</span><select id="required" name="template" required aria-invalid="true"><option value="">请选择模板</option><option value="basic">基础模板</option></select><small>请选择一个模板</small></label>
    <label class="field"><span>读取中</span><select id="disabled" name="disabled" disabled><option>正在读取可用档位…</option></select></label>
    <div class="workspace"><div class="toolbar"><label class="inlineField">算力档位<select id="compact"><option>平台默认档位</option><option>终端专用档位</option></select></label></div></div>
    <label class="field"><span>长列表</span><select id="many"><optgroup label="项目">${Array.from({ length: 80 }, (_, i) => `<option value="${i}">项目 ${i + 1} · 长列表滚动验证</option>`).join('')}</optgroup></select></label>
    <label class="field"><span>下一字段</span><input id="next" /></label>
  </form></main>`;
  await page.eval(`document.documentElement.lang = 'zh-CN'; document.body.innerHTML = ${JSON.stringify(html)};
    document.querySelector('#status').addEventListener('change', e => document.querySelector('#result').textContent = e.target.value)`);
}

async function click(selector: string) {
  await page.eval(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'nearest' })`);
  const point = await page.eval<{ x: number; y: number }>(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x + r.width / 2, y:r.y + r.height / 2}; })()`);
  await page.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await page.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  await page.eval('new Promise(resolve => requestAnimationFrame(() => resolve()))');
}

async function key(key: string, windowsVirtualKeyCode: number) {
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode });
  await page.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode });
}

describe.skipIf(!available)('统一下拉控件的真实浏览器外观与操作', () => {
  test.each([[1280, 'light'], [390, 'light'], [320, 'light'], [390, 'dark']] as const)('%dpx / %s：菜单采用主题样式，长选项不溢出，紧凑控件保持高度', async (width, scheme) => {
    await fixture(width, scheme);
    expect(base).toContain("@import '../../shared/ui/selection/Select.css'");
    const closed = await page.eval<{ appearance: string; radius: string; height: number; compact: number; overflow: number }>(`(() => {
      const s = document.querySelector('#status'), c = document.querySelector('#compact');
      return { appearance: getComputedStyle(s).appearance, radius: getComputedStyle(s).borderRadius, height: s.getBoundingClientRect().height, compact: c.getBoundingClientRect().height, overflow: document.documentElement.scrollWidth - innerWidth };
    })()`);
    expect(closed.appearance).toBe('base-select'); expect(closed.radius).toBe('8px');
    expect(closed.height).toBe(36); expect(closed.compact).toBe(28); expect(closed.overflow).toBeLessThanOrEqual(1);
    await click('#status');
    const opened = await page.eval<{ open: boolean; shadow: string; selected: string; left: number; right: number; gap: number }>(`(() => {
      const s = document.querySelector('#status'), p = getComputedStyle(s, '::picker(select)'), o = s.querySelector('[value="long"]'), r = o.getBoundingClientRect();
      return { open: s.matches(':open'), shadow: p.boxShadow, selected: getComputedStyle(s.selectedOptions[0]).backgroundColor, left: r.left, right: r.right,
        gap: s.options[0].getBoundingClientRect().top - s.getBoundingClientRect().bottom };
    })()`);
    expect(opened.open).toBe(true); expect(opened.shadow).not.toBe('none');
    expect(opened.selected).toBe(scheme === 'dark' ? 'rgb(32, 54, 91)' : 'rgb(234, 241, 255)');
    expect(opened.left).toBeGreaterThanOrEqual(0); expect(opened.right).toBeLessThanOrEqual(width);
    expect(opened.gap).toBeGreaterThanOrEqual(6); expect(opened.gap).toBeLessThanOrEqual(12);
    await key('Escape', 27);
    expect(await page.eval<boolean>('document.querySelector("#status").matches(":open")')).toBe(false);
    expect(page.takeErrors()).toEqual([]);
  });

  test('方向键跳过禁用项，Enter 提交真实表单值，Escape 取消临时选择', async () => {
    await fixture(); await click('#status'); await key('ArrowDown', 40); await key('Enter', 13);
    expect(await page.eval<string>('new FormData(document.querySelector("form")).get("status")')).toBe('failed');
    expect(await page.eval<string>('document.querySelector("#result").textContent')).toBe('failed');
    await click('#status'); await key('ArrowUp', 38); await key('Escape', 27);
    expect(await page.eval<string>('document.querySelector("#status").value')).toBe('failed');
    await click('#status'); await click('#status option[value="ready"]');
    expect(await page.eval<string>('document.querySelector("#result").textContent')).toBe('ready');
    expect(page.takeErrors()).toEqual([]);
  });

  test('禁用与必填校验保持有效，长列表限制高度并允许键盘滚到末项', async () => {
    await fixture(320, 'dark');
    expect(await page.eval<boolean>('document.querySelector("#required").checkValidity()')).toBe(false);
    expect(await page.eval<boolean>('new FormData(document.querySelector("form")).has("disabled")')).toBe(false);
    expect(await page.eval<string>('getComputedStyle(document.querySelector("#disabled")).cursor')).toBe('not-allowed');
    expect(await page.eval<string>('getComputedStyle(document.querySelector("#required")).borderColor')).toBe('rgb(255, 164, 173)');
    await click('#many'); await key('End', 35);
    const result = await page.eval<{ height: number; bottom: number; overflow: string }>(`(() => {
      const s = document.querySelector('#many'), p = getComputedStyle(s, '::picker(select)');
      return { height: parseFloat(p.height), overflow: p.overflowY, bottom: s.querySelector('option:last-child').getBoundingClientRect().bottom };
    })()`);
    expect(result.height).toBeLessThanOrEqual(320); expect(result.overflow).toBe('auto'); expect(result.bottom).toBeLessThanOrEqual(844);
    await key('Enter', 13);
    expect(await page.eval<string>('document.querySelector("#many").value')).toBe('79');
    await key('Tab', 9);
    expect(await page.eval<string>('document.activeElement.id')).toBe('next');
    expect(page.takeErrors()).toEqual([]);
  });

  test('视口底部的菜单向上展开，不受父容器 overflow 裁切', async () => {
    await fixture(320);
    await page.eval(`const edge = document.createElement('div'); edge.style.cssText = 'position:fixed;bottom:8px;right:8px;width:200px;height:40px;overflow:hidden';
      edge.innerHTML = '<label>边缘<select id="edge"><option>A</option><option>B</option><option>C</option></select></label>'; document.body.append(edge)`);
    await click('#edge');
    const bounds = await page.eval<{ top: number; bottom: number; trigger: number; right: number }>(`(() => {
      const s = document.querySelector('#edge'), first = s.options[0].getBoundingClientRect(), last = s.options[2].getBoundingClientRect();
      return { top: first.top, bottom: last.bottom, trigger: s.getBoundingClientRect().top, right: last.right };
    })()`);
    expect(bounds.top).toBeGreaterThanOrEqual(0); expect(bounds.bottom).toBeLessThan(bounds.trigger); expect(bounds.right).toBeLessThanOrEqual(320);
    expect(bounds.trigger - bounds.bottom).toBeLessThanOrEqual(12);
    await click('#edge option:last-child');
    expect(await page.eval<string>('document.querySelector("#edge").value')).toBe('C');
  });

  test('不支持可定制菜单时仍有主题边框、箭头与可聚焦的原生选择控件', async () => {
    await fixture(390, 'dark');
    // 去掉增强分支，验证不支持 base-select 时实际保留下来的 CSS，而非另写一份备用样式。
    await page.eval(`for (const sheet of document.styleSheets) {
      for (let i = sheet.cssRules.length - 1; i >= 0; i--) if (sheet.cssRules[i] instanceof CSSSupportsRule) sheet.deleteRule(i);
    } document.querySelector('#status').focus()`);
    const fallback = await page.eval<{ appearance: string; arrow: string; radius: string }>(`(() => {
      const s = getComputedStyle(document.querySelector('#status')); return { appearance: s.appearance, arrow: s.backgroundImage, radius: s.borderRadius };
    })()`);
    expect(fallback.appearance).toBe('none'); expect(fallback.arrow).not.toBe('none'); expect(fallback.radius).toBe('8px');
    expect(await page.eval<string>('document.activeElement.id')).toBe('status');
    expect(await page.eval<string>('new FormData(document.querySelector("form")).get("status")')).toBe('ready');
    expect(page.takeErrors()).toEqual([]);
  });
});
