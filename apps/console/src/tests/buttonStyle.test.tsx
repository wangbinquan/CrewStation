import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { Button, ButtonSizeContext } from '../shared/ui/Button';
import { ExternalButtonLink } from '../shared/ui/navigation/ButtonLink';
import { consoleStyles, sourceAt } from './sourceScan';
import { renderElement } from './renderElement';

let rendered: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { rendered?.unmount(); rendered = undefined; });

/** 取出某条规则的声明块；只认选择器完全相同的那条。 */
function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return '';
  return css.slice(start, css.indexOf('}', start));
}

// 2026-09-23 作者裁定：全站按钮只有两档高度（标准 32、紧凑 26）；危险动作红字红框，最终确认红底白字。
test('两档高度只在 Button 样式里定义：标准 32px，small 26px，内边距不再撑高', () => {
  const css = sourceAt(consoleStyles(), 'shared/ui/Button.module.css').code;
  expect(block(css, '.button')).toContain('min-height: 32px;');
  expect(block(css, '.button')).toContain('padding: 0 var(--cs-space-3);');
  expect(block(css, '.small')).toContain('min-height: 26px;');
  expect(block(css, '.small')).toContain('padding: 0 var(--cs-space-2);');
});

test('危险动作：触发按钮红字红框，最终确认红底白字；暗色主题有单独的实心红', async () => {
  rendered = await renderElement(<>
    <Button variant="danger">下线</Button>
    <Button variant="dangerPrimary" size="small">确认下线</Button>
  </>, {});
  const [trigger, confirm] = [...rendered.host.querySelectorAll('button')];
  expect(trigger!.className.split(' ')).toEqual(['button', 'danger']);
  expect(confirm!.className.split(' ')).toEqual(['button', 'dangerPrimary', 'small']);
  const css = sourceAt(consoleStyles(), 'shared/ui/Button.module.css').code;
  expect(block(css, '.danger')).toContain('color: var(--cs-color-danger);');
  expect(block(css, '.dangerPrimary')).toContain('background: var(--cs-color-danger-solid);');
  expect(block(css, '.dangerPrimary')).toContain('color: var(--cs-color-on-danger);');
  const tokens = sourceAt(consoleStyles(), 'app/theme/tokens.css').code;
  const [light = '', dark = ''] = tokens.split('@media (prefers-color-scheme: dark)');
  for (const name of ['--cs-color-danger-solid:', '--cs-color-danger-solid-hover:']) {
    expect(light).toContain(name);
    expect(dark).toContain(name);
  }
  expect(light).toContain('--cs-color-on-danger:');
});

// 开发页整片是工具条密度：由区域缺省档位给出紧凑档，页面样式不再改写按钮尺寸（2026-09-23 裁定）。
test('区域缺省档位：区域里的按钮与按钮样式链接不写 size 也是紧凑档，区域外仍是标准档；都带 data-button', async () => {
  rendered = await renderElement(<>
    <Button>区域外</Button>
    <ButtonSizeContext.Provider value="small">
      <Button variant="primary">区域内</Button>
      <ExternalButtonLink href="//preview.test">打开预览</ExternalButtonLink>
    </ButtonSizeContext.Provider>
  </>, {});
  const [outside, inside] = [...rendered.host.querySelectorAll('button')], link = rendered.host.querySelector('a')!;
  expect(outside!.className.split(' ')).toEqual(['button', 'secondary']);
  expect(inside!.className.split(' ')).toEqual(['button', 'primary', 'small']);
  expect(link.className.split(' ')).toEqual(['button', 'secondary', 'small']);
  for (const node of [outside!, inside!, link]) expect(node.hasAttribute('data-button')).toBe(true);
});
