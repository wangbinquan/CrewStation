import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { Brand } from '../shared/ui/Brand';
import { LocaleSwitch } from '../app/layout/LocaleSwitch';
import { renderElement } from './renderElement';

let ui: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { ui?.unmount(); ui = undefined; });

test('品牌字标的图形为装饰，单独图标带名称；单色版本继承所在主题颜色', async () => {
  ui = await renderElement(<><Brand /><Brand wordmark={false} size={16} /><Brand wordmark={false} monochrome size={24} /></>, {});
  const images = [...ui.host.querySelectorAll('img')];
  expect(images[0]?.alt).toBe('');
  expect(images[1]?.alt).toBe('CrewStation');
  expect(images[1]?.width).toBe(16);
  expect(ui.host.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('CrewStation');
});

test('紧凑语言按钮保留分组与每种语言的可访问名称', async () => {
  ui = await renderElement(<LocaleSwitch />, {});
  const group = ui.host.querySelector('[role="group"]');
  expect(group?.getAttribute('aria-label')).toBe('界面语言');
  expect([...group!.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'))).toEqual(['中文', 'English']);
});
