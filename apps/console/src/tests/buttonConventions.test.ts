import { expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { consoleSources, consoleStyles } from './sourceScan';

// 2026-09-23 作者裁定的按钮规则（RFC-003 design §6 修订）：页面自动局部刷新，不提供刷新按钮；按钮文案不带＋、箭头这类
// 非正式符号；按钮只有两档高度，尺寸只在 Button 样式里定义。这里守住「新代码不再把它们加回来」。

const SRC = resolve(import.meta.dir, '..');

/** 与 app/i18n/messageCatalog.ts 同一套来源：app 的文案加每个 feature 的 i18n/zh-CN.ts。 */
async function catalog(): Promise<ReadonlyMap<string, string>> {
  const features = join(SRC, 'features');
  const files = [join(SRC, 'app', 'i18n', 'zh-CN.ts'), ...readdirSync(features).map((feature) => join(features, feature, 'i18n', 'zh-CN.ts')).filter((file) => existsSync(file))];
  const messages = new Map<string, string>();
  for (const file of files) for (const [key, value] of Object.entries(((await import(file)) as { messages: Record<string, string> }).messages)) messages.set(key, value);
  return messages;
}

/** 按钮与按钮样式链接的开始标签到结束标签；开始标签里的 `=>`（onClick 等）不算标签结束。 */
const BUTTON = /<(Button|ButtonLink|ExternalButtonLink)\b((?:=>|[^>])*)>([\s\S]*?)<\/\1>/g;
const KEY = /\bt\(\s*'([a-z][\w-]*(?:\.[\w-]+)+)'/g;

interface Label { readonly path: string; readonly key?: string; readonly text: string }

/** 去掉 JSX 表达式（按花括号配对，模板字符串里的 `${}` 一并去掉），只留直接写在标签里的文字。 */
function literalText(children: string): string {
  let depth = 0, out = '';
  for (const char of children) {
    if (char === '{') depth += 1;
    else if (char === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += char;
  }
  return out.trim();
}

/** 每个按钮的文案：取自 t('…') 的按文案表展开，直接写在标签里的按原文。 */
async function buttonLabels(): Promise<readonly Label[]> {
  const messages = await catalog(), labels: Label[] = [];
  for (const file of consoleSources()) {
    for (const [, , , children = ''] of file.code.matchAll(BUTTON)) {
      const keys = [...children.matchAll(KEY)].map((match) => match[1]!);
      for (const key of keys) labels.push({ path: file.path, key, text: messages.get(key) ?? '' });
      const literal = literalText(children);
      if (literal) labels.push({ path: file.path, text: literal });
    }
  }
  return labels;
}

/** 纯粹的「再读一次」：刷新、重新读取／加载／查询、读取最新、检查更新。操作失败后的「重试」是重做那次操作，不在此列。 */
const REFRESH = /刷新|^重新(读取|加载|查询)|读取最新|检查.*更新/;

/** 看起来像刷新、实际是别的动作的按钮：每条写明为什么保留。 */
const NOT_REFRESH: ReadonlyArray<{ readonly key: string; readonly why: string }> = [
  { key: 'catalog.swagger.reloadDocument', why: '文档本身每 30 秒自动重读；这个按钮是「装入新文档」，会丢掉 Swagger 里的输入，所以由人决定' },
  { key: 'admin.users.refreshRole', why: '保存角色时撞上别人刚改过（冲突）才出现：放弃自己的草稿、按服务端当前角色重来' },
  { key: 'admin.profile.discard', why: '保存档位时撞上别人刚改过（冲突）才出现：放弃自己的修改、换成服务端的最新内容' },
  { key: 'activity.refresh', why: 'AgentActivityMenu 已按 RFC-011 从页面上拿掉（不挂载），组件留作参考' },
  { key: 'devSession.preview.reload', why: '作者裁定保留（原「刷新」改名）：重新加载开发预览里的应用页面，不是重读平台数据' },
];

test('没有刷新按钮：按钮文案不是「刷新／重新读取／重新加载／重新查询」这类纯粹的再读一次', async () => {
  const offenders = (await buttonLabels()).filter((label) => REFRESH.test(label.text) && !NOT_REFRESH.some((item) => item.key === label.key))
    .map((label) => `${label.path}: ${label.key ?? ''} ${label.text}`);
  expect(offenders).toEqual([]);
  expect(consoleSources().filter((file) => /\bPageRefresh\b/.test(file.code)).map((file) => file.path)).toEqual([]);
});

test('按钮文案不带＋、箭头、展开三角这类非正式符号', async () => {
  const offenders = (await buttonLabels()).filter((label) => /[＋↗↘↙↖→←↑↓▾▴▸◂⟳↻]/.test(label.text)).map((label) => `${label.path}: ${label.key ?? ''} ${label.text}`);
  expect(offenders).toEqual([]);
});

/** 以按钮元素为目标、却不是动作按钮的控件：各自有独立的外观，不受两档高度约束。 */
const NOT_ACTION_BUTTONS: ReadonlyArray<{ readonly path: string; readonly why: string }> = [
  { path: 'shared/ui/Tabs.module.css', why: '页签条里的页签' },
  { path: 'shared/ui/navigation/SectionNavigation.module.css', why: '分区导航项（两行文字的导航卡）' },
  { path: 'app/layout/activity/AgentActivityMenu.module.css', why: 'AgentActivityMenu 已按 RFC-011 从页面上拿掉（不挂载）' },
];

test('按钮只有两档高度：样式里不给动作按钮（button 元素或按钮样式链接）另定高度、内边距或字号', () => {
  const offenders: string[] = [];
  for (const file of consoleStyles()) {
    if (file.path === 'shared/ui/Button.module.css' || NOT_ACTION_BUTTONS.some((item) => item.path === file.path)) continue;
    // 声明块里不含花括号：@media 里的规则按最内层匹配，不会被外层吞掉。
    for (const [, selector = '', body = ''] of file.code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/(^|;|\s)(min-height|height|padding(-\w+)?|font-size)\s*:/.test(body)) continue;
      for (const part of selector.split(',').map((item) => item.trim())) {
        // 明确排除 data-button 的规则只作用于页签、树节点这类原生按钮，它们可以有自己的密度；动作按钮（Button／ButtonLink 都带 data-button）不行。
        if (part.includes(':not([data-button])')) continue;
        if (/(^|[\s>+~(])button\b|\[data-button\]/.test(part)) offenders.push(`${file.path}: ${part}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});

test('例外清单里的每一条都还在，删掉按钮或样式后要一起删掉例外', async () => {
  const keys = new Set((await buttonLabels()).map((label) => label.key));
  for (const item of NOT_REFRESH) expect(keys.has(item.key)).toBe(true);
  const styles = new Set(consoleStyles().map((file) => file.path));
  for (const item of NOT_ACTION_BUTTONS) expect(styles.has(item.path)).toBe(true);
});
