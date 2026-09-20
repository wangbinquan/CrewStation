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

describe.skipIf(!session)('卡片操作区的真实布局间距', () => {
  test.each([1280, 390])('%dpx：镜像示例与凭据操作之间留白，按钮保持自然尺寸', async (width) => {
    const page = session!.admin;
    await viewport(page, width);
    await open(page, '/admin/compute');
    const actual = await spacing(page, '签发推送凭据', true);
    // 实机故障是按钮与 Dockerfile 框相距 0px；DOM 存在或 className 正确都不能证明修复。
    expect(actual.before).not.toBeNull();
    expect(actual.before!).toBeGreaterThanOrEqual(8);
    expect(actual.height).toBeLessThan(60);
    expect(actual.width).toBeLessThan(actual.containerWidth);
    expect(actual.overflow).toBeLessThanOrEqual(1);
    expect(page.takeErrors()).toEqual([]);
  }, 45_000);

  test.each([1280, 390])('%dpx：身份提供方列表或空态与新增按钮之间留白', async (width) => {
    const page = session!.admin;
    await viewport(page, width);
    await open(page, '/admin/authentication');
    const actual = await spacing(page, '新增身份提供方');
    // 有数据和没有数据时都应由容器留出间隔，不依赖表格最后一行的 padding。
    expect(actual.before).not.toBeNull();
    expect(actual.before!).toBeGreaterThanOrEqual(8);
    expect(actual.width).toBeLessThan(actual.containerWidth);
    expect(actual.overflow).toBeLessThanOrEqual(1);
    expect(page.takeErrors()).toEqual([]);
  }, 45_000);
});

describe.skipIf(!session?.project)('项目操作区的真实布局间距', () => {
  test.each([1280, 390])('%dpx：发布检查按钮上下留白，来源按钮之间留白', async (width) => {
    const page = session!.admin;
    await viewport(page, width);
    await open(page, `/projects/${session!.project!.id}/release`);
    await click(page, '准备发布');
    const actual = await spacing(page, '检查发布来源');
    // 原表单按钮同时贴住上方字段与下方说明，修复必须覆盖两侧。
    expect(actual.before!).toBeGreaterThanOrEqual(8);
    expect(actual.after!).toBeGreaterThanOrEqual(8);
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
    await click(page, '收起准备');
  }, 45_000);

  test('告警订阅与调用链查询的操作按钮有独立间隔', async () => {
    const page = session!.admin;
    await viewport(page, 390);
    await open(page, `/projects/${session!.project!.id}/operations?tab=alerts`);
    const add = await spacing(page, '添加订阅');
    expect(add.before!).toBeGreaterThanOrEqual(8);
    await open(page, `/projects/${session!.project!.id}/operations?tab=trace`);
    const query = await spacing(page, '查询调用链');
    expect(query.before!).toBeGreaterThanOrEqual(8);
    expect(query.overflow).toBeLessThanOrEqual(1);
    expect(page.takeErrors()).toEqual([]);
  }, 45_000);
});
