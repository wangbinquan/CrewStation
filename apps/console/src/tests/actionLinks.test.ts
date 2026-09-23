import { expect, test } from 'bun:test';
import { consoleSources } from './sourceScan';

/** 开始标签里的 `=>`（onClick 等箭头函数）不算标签结束。 */
const LINK = /<(Link|a)\b((?:=>|[^>])*)>([\s\S]*?)<\/\1>/g;

/** 文案取自 t(...) 却是引用而非动作的链接：每条写明为什么不做成按钮。 */
const REFERENCES: ReadonlyArray<{ readonly path: string; readonly contains: string; readonly why: string }> = [
  { path: 'features/projects/components/summary/ProjectRecentActivity.tsx', contains: "'timeline.switch'", why: '最近动态里一整句切流记录，指向那次发布本身' },
];

/**
 * 2026-09-23 裁定：工作台里的动作型跳转（新建、返回、查看日志、打开外部地址…）一律是按钮样子，用 ButtonLink／ExternalButtonLink；
 * 名字、标签、地址这类引用型链接和自带样式的导航项仍是链接。判据：文案取自 t(...) 的裸 <Link>／<a> 就是动作。
 */
test('动作型跳转一律是按钮样式：文案取自 t(...) 的裸 <Link>／<a> 必须改用 ButtonLink', () => {
  const offenders: string[] = [];
  for (const file of consoleSources()) {
    for (const match of file.code.matchAll(LINK)) {
      const [, , attributes = '', children = ''] = match;
      // 带 className 或 activeProps 的是自带样式的导航项（顶栏、左栏、子导航页签）；文案不取自 t(...) 的是引用。
      if (/\b(className|activeProps)=/.test(attributes) || !/\bt\(/.test(children)) continue;
      if (REFERENCES.some((item) => file.path === item.path && children.includes(item.contains))) continue;
      offenders.push(`${file.path}: ${children.replace(/\s+/g, ' ').trim().slice(0, 80)}`);
    }
  }
  expect(offenders).toEqual([]);
});

test('例外清单里的每一条都还在，删掉引用后要一起删掉例外', () => {
  const sources = consoleSources();
  for (const item of REFERENCES) expect(sources.find((file) => file.path === item.path)?.code ?? '').toContain(item.contains);
});
