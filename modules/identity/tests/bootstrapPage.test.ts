import { afterEach, expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import type { Event, HTMLFormElement, HTMLInputElement } from 'happy-dom';
import { renderBootstrapPage } from '../application/bootstrapPage';
import { renderLoginPage } from '../application/loginPages';

let window: Window;
let document: Window['document'];
afterEach(async () => { await window?.happyDOM.close(); });

function render(html: string, hash = ''): HTMLFormElement {
  // 仅执行本仓生成的内联脚本；独立 Window 不替换 Bun 的 fetch、Request、Response。
  window = new Window({ url: `http://console.cs.localhost/auth/bootstrap${hash}` });
  document = window.document;
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  document.open();
  document.write(html.replace(/<script>[\s\S]*?<\/script>/g, ''));
  document.close();
  const globals = { document, location: window.location, history: window.history, URLSearchParams };
  for (const script of scripts) runInNewContext(script ?? '', globals);
  return document.querySelector('form') as HTMLFormElement;
}

function field(name: string): HTMLInputElement {
  return document.getElementById(name) as HTMLInputElement;
}

function submit(form: HTMLFormElement): Event {
  const event = new window.Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
  return event;
}

test('安装链接直接填入令牌并清除 URL，焦点落到用户名，逐字段显示所有空值错误', () => {
  const form = render(renderBootstrapPage(), '#token=one-time-test-token');
  expect(field('token').value).toBe('one-time-test-token');
  expect(window.location.hash).toBe('');
  expect(document.activeElement?.id).toBe('username');
  expect(submit(form).defaultPrevented).toBe(true);
  expect(document.querySelectorAll('[aria-invalid="true"]').length).toBe(5);
  expect(document.activeElement?.id).toBe('username');
  expect(form.querySelector('button')?.disabled).toBe(false);
});

test('非法用户名、邮箱、短密码和确认不一致都有字段反馈，修正后允许提交', () => {
  const form = render(renderBootstrapPage(), '#token=one-time-test-token');
  // 真实 Chrome 曾因未转义短横线把整个 pattern 静默丢弃；按浏览器的 v 模式锁住它。
  const browserPattern = new RegExp(field('username').pattern, 'v');
  expect(browserPattern.test('Invalid!')).toBe(false);
  expect(browserPattern.test('my-admin')).toBe(true);
  for (const [name, value] of Object.entries({ username: 'Invalid', displayName: '张三', email: 'invalid', password: 'short', confirmPassword: 'another-test-password' })) field(name).value = value;
  expect(submit(form).defaultPrevented).toBe(true);
  for (const name of ['username', 'email', 'password', 'confirmPassword']) expect(field(name).getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById('confirmPassword-error')?.textContent).toContain('不一致');
  for (const [name, value] of Object.entries({ username: 'my-admin', email: 'admin@example.com', password: 'my-test-password', confirmPassword: 'my-test-password' })) field(name).value = value;
  expect(submit(form).defaultPrevented).toBe(false);
  expect(form.querySelector('button')?.disabled).toBe(true);
});

test('普通访问说明令牌来源，失败页保留非口令资料并转义 HTML', () => {
  render(renderBootstrapPage('引导令牌不正确', { username: 'my-admin', displayName: '<img src=x onerror=alert(1)>', email: 'admin@example.com', token: 'wrong', password: 'secret-value', confirmPassword: 'secret-value' }));
  expect(document.querySelector('#token-fields')?.hasAttribute('hidden')).toBe(false);
  expect(field('username').value).toBe('my-admin');
  expect(field('displayName').value).toBe('<img src=x onerror=alert(1)>');
  expect(document.querySelector('img[src="x"]')).toBeNull();
  expect(field('token').value).toBe('');
  expect(field('password').value).toBe('');
  expect(document.activeElement?.id).toBe('token');
});

test('管理员已创建时旧初始化链接不会保留令牌或重新显示创建表单', () => {
  const discovery = { mode: 'ready' as const, passwordLoginEnabled: true, bootstrapTokenEnabled: false, providers: [], loginPath: '/auth/login', logoutPath: '/auth/logout', jwksPath: '/.well-known/jwks.json' };
  render(renderLoginPage({ discovery, returnTo: '/' }), '#token=retired-token');
  expect(window.location.hash).toBe('');
  expect(document.querySelector('#bootstrap-form')).toBeNull();
  expect(field('password').autocomplete).toBe('current-password');
});
