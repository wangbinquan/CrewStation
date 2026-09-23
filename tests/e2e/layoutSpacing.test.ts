import { afterAll, describe, expect, test } from 'bun:test';
import type { Page } from './cdp';
import { e2eAvailable, open, settle } from './consoleSession';
import { openAdminSession } from './session';

const available = await e2eAvailable();
const session = available ? await openAdminSession() : undefined;

afterAll(async () => { await session?.close(); }, 30_000);

async function viewport(page: Page, width: number) {
  await page.cmd('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
}

async function click(page: Page, label: string) {
  await page.eval(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === ${JSON.stringify(label)});
    if (!button) throw new Error('Missing button: ' + ${JSON.stringify(label)});
    button.click();
  })()`);
  await settle(page);
}

async function spacing(page: Page, label: string, row = false) {
  return page.eval<{ before: number | null; after: number | null; height: number; width: number; containerWidth: number; overflow: number }>(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === ${JSON.stringify(label)});
    if (!button) throw new Error('Missing button: ' + ${JSON.stringify(label)});
    const target = ${row} ? button.parentElement : button;
    const rect = target.getBoundingClientRect(), buttonRect = button.getBoundingClientRect();
    const previous = target.previousElementSibling, next = target.nextElementSibling;
    return {
      before: previous ? rect.top - previous.getBoundingClientRect().bottom : null,
      after: next ? next.getBoundingClientRect().top - rect.bottom : null,
      height: buttonRect.height, width: buttonRect.width,
      containerWidth: target.parentElement.getBoundingClientRect().width,
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  })()`);
}

/** 卡片头里的列表级动作（如「新增身份提供方」）：量标题与按钮、标题栏与正文之间的真实留白。 */
async function headerSpacing(page: Page, label: string) {
  return page.eval<{ titleGap: number; bodyGap: number; height: number; width: number; containerWidth: number; overflow: number }>(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === ${JSON.stringify(label)});
    const header = button?.closest('header'), title = header?.querySelector('h2'), content = header?.nextElementSibling?.firstElementChild;
    if (!button || !header || !title || !content) throw new Error('Missing card header or content: ' + ${JSON.stringify(label)});
    const action = button.getBoundingClientRect(), heading = title.getBoundingClientRect(), container = header.getBoundingClientRect();
    return {
      titleGap: Math.max(action.left - heading.right, action.top - heading.bottom),
      bodyGap: content.getBoundingClientRect().top - container.bottom,
      height: action.height, width: action.width, containerWidth: container.width,
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  })()`);
}

/** 「签发推送凭据」与上方 Dockerfile 框之间的真实距离（2026-09-23 起按钮在卡片底部操作条里，RFC-003 design §6）。 */
async function sampleToIssueSpacing(page: Page) {
  return page.eval<{ gap: number; height: number; width: number; containerWidth: number; overflow: number }>(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === '签发推送凭据');
    const sample = document.querySelector('pre[aria-label="示例 Dockerfile"]');
    if (!button || !sample) throw new Error('Missing issue button or sample Dockerfile');
    const rect = button.getBoundingClientRect();
    return {
      gap: rect.top - sample.getBoundingClientRect().bottom, height: rect.height, width: rect.width,
      containerWidth: button.parentElement.getBoundingClientRect().width, overflow: document.documentElement.scrollWidth - innerWidth,
    };
  })()`);
}

describe.skipIf(!session)('卡片操作区的真实布局间距', () => {
  test.each([1280, 390])('%dpx：镜像示例与凭据操作之间留白，按钮保持自然尺寸', async (width) => {
    const page = session!.admin;
    await viewport(page, width);
    await open(page, '/admin/compute');
    const actual = await sampleToIssueSpacing(page);
    // 实机故障是按钮与 Dockerfile 框相距 0px；DOM 存在或 className 正确都不能证明修复。
    expect(actual.gap).toBeGreaterThanOrEqual(8);
    expect(actual.height).toBeLessThan(60);
    expect(actual.width).toBeLessThan(actual.containerWidth);
    expect(actual.overflow).toBeLessThanOrEqual(1);
    expect(page.takeErrors()).toEqual([]);
  }, 45_000);

  test.each([1280, 390, 320])('%dpx：身份提供方标题、新增操作和内容之间留白', async (width) => {
    const page = session!.admin;
    await viewport(page, width);
    await open(page, '/admin/authentication');
    const actual = await headerSpacing(page, '新增身份提供方');
    // RFC-014 将新增操作移到标题栏；仍锁住标题与按钮、标题栏与列表／空态的真实间距。
    expect(actual.titleGap).toBeGreaterThanOrEqual(8);
    expect(actual.bodyGap).toBeGreaterThanOrEqual(8);
    expect(actual.height).toBeLessThan(60);
    expect(actual.width).toBeLessThan(actual.containerWidth);
    expect(actual.overflow).toBeLessThanOrEqual(1);
    expect(page.takeErrors()).toEqual([]);
  }, 45_000);
});

describe.skipIf(!session?.project)('项目操作区的真实布局间距', () => {
  test.each([1280, 390])('%dpx：发布准备弹窗的底部按钮上下留白、不超出窗口，来源按钮之间留白', async (width) => {
    const page = session!.admin;
    await viewport(page, width);
    await open(page, `/projects/${session!.project!.id}/release`);
    await click(page, '准备发布');
    // 2026-09-23 起发布准备是弹窗，按钮在弹窗底部的操作条里：量它与操作条上下边的留白，以及弹窗离窗口两侧的距离。
    const actual = await page.eval<{ top: number; bottom: number; left: number; right: number; width: number; containerWidth: number; overflow: number }>(`(() => {
      const dialog = document.querySelector('dialog[open]');
      if (!dialog) throw new Error('Missing dialog');
      const button = [...dialog.querySelectorAll('button')].find((node) => node.textContent.trim() === '检查发布来源');
      if (!button) throw new Error('Missing button: 检查发布来源');
      const footer = button.parentElement.parentElement.getBoundingClientRect(), rect = button.getBoundingClientRect(), frame = dialog.getBoundingClientRect();
      return { top: rect.top - footer.top, bottom: footer.bottom - rect.bottom, left: frame.left, right: innerWidth - frame.right, width: rect.width, containerWidth: footer.width, overflow: document.documentElement.scrollWidth - innerWidth };
    })()`);
    expect(actual.top).toBeGreaterThanOrEqual(8);
    expect(actual.bottom).toBeGreaterThanOrEqual(8);
    expect(actual.left).toBeGreaterThanOrEqual(15);
    expect(actual.right).toBeGreaterThanOrEqual(15);
    expect(actual.width).toBeLessThan(actual.containerWidth);
    expect(actual.overflow).toBeLessThanOrEqual(1);
    const sourceGap = await page.eval<number>(`(() => {
      const buttons = [...document.querySelectorAll('button')];
      const first = buttons.find((node) => node.textContent === '已推送分支').getBoundingClientRect();
      const second = buttons.find((node) => node.textContent === '当前开发会话').getBoundingClientRect();
      return Math.abs(first.top - second.top) < 1 ? second.left - first.right : second.top - first.bottom;
    })()`);
    expect(sourceGap).toBeGreaterThanOrEqual(8);
    expect(page.takeErrors()).toEqual([]);
    await click(page, '取消');
  }, 45_000);

  test('告警状态筛选与调用链「按 trace_id 打开」的操作有独立间隔', async () => {
    const page = session!.admin;
    await viewport(page, 390);
    await open(page, `/projects/${session!.project!.id}/operations?tab=alerts`);
    // 基线 v0.3.13（D61）删除了项目级告警订阅：告警页不再有订阅卡片和「添加订阅」。
    expect(await page.eval<boolean>(`(() => [...document.querySelectorAll('button')].some((node) => node.textContent.trim() === '添加订阅'))()`)).toBe(false);
    // 2026-09-23 状态筛选改成分段控件后曾紧贴下方的记录或空态（0px）：量它与下一个元素的真实间距。
    const filterGap = await page.eval<number>(`(() => {
      const group = document.querySelector('main [role="group"][aria-label="状态"]'), next = group?.nextElementSibling;
      if (!group || !next) throw new Error('Missing alert state filter or the content below it');
      return next.getBoundingClientRect().top - group.getBoundingClientRect().bottom;
    })()`);
    expect(filterGap).toBeGreaterThanOrEqual(8);
    await open(page, `/projects/${session!.project!.id}/operations?tab=trace`);
    // 2026-09-23 调用链改成列表＋详情：「打开」按钮与左边的输入框在同一行，量它与输入框之间的横向留白。
    const gap = await page.eval<number>(`(() => {
      const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === '打开');
      const field = button?.previousElementSibling;
      if (!button || !field) throw new Error('Missing open-by-trace_id form');
      const a = field.getBoundingClientRect(), b = button.getBoundingClientRect();
      return Math.abs(a.bottom - b.bottom) < 2 ? b.left - a.right : b.top - a.bottom;
    })()`);
    expect(gap).toBeGreaterThanOrEqual(8);
    const query = await spacing(page, '打开');
    expect(query.overflow).toBeLessThanOrEqual(1);
    expect(page.takeErrors()).toEqual([]);
  }, 45_000);
});
