import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ManifestKind } from '@crewstation/contracts';
import { currentAdminPage } from '../shared/admin/adminNavigation';
import { computeProjectId, projectComputeFixture } from './projectComputeFixture';
import { renderApp } from './renderApp';

// 2026-09-24 作者裁定：项目管理只列数字人，接入容器相关的页面都归「能力接入」——新建接入容器、接入项目的开通页与资源配置页
// 虽然路径在 /admin/projects 下，左栏也高亮「能力接入」，返回与顶栏「平台管理」回接入容器页签；数字人照旧归项目管理。
const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

/** 在算力夹具上把项目换成指定种类；`project.hold` 挂住项目读取，模拟种类还没读到。 */
function fixture(kind: ManifestKind) {
  const compute = projectComputeFixture(), fallback = globalThis.fetch;
  const project = { hold: undefined as Promise<void> | undefined };
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path !== `/v1/projects/${computeProjectId}`) return fallback(input, init);
    if (project.hold) await project.hold;
    return Response.json({ ...await (await fallback(input, init)).json(), kind });
  }) as typeof fetch;
  return { ...compute, project };
}

const currentNav = () => [...document.querySelectorAll('nav[aria-label="主导航"] ul a[aria-current="page"]')].map((link) => link.textContent);
const topBarAdmin = () => [...document.querySelectorAll('header a')].find((link) => link.textContent === '平台管理')?.getAttribute('href');
const resourcesPath = `/admin/projects/${computeProjectId}/resources`;

describe('左栏当前项的计算', () => {
  test('按整段路径取最长前缀，总览只认完全相同；接入容器相关页归能力接入，种类未知时不标', () => {
    expect(currentAdminPage('/admin', false)).toBe('/admin');
    expect(currentAdminPage('/admin/', false)).toBe('/admin');
    expect(currentAdminPage('/admin/requests', false)).toBe('/admin/requests');
    expect(currentAdminPage('/admin/projects', false)).toBe('/admin/projects');
    expect(currentAdminPage('/admin/projects/resource-templates', false)).toBe('/admin/projects');
    expect(currentAdminPage(resourcesPath, false)).toBe('/admin/projects');
    expect(currentAdminPage('/admin/cluster/', false)).toBe('/admin/cluster');
    // 前缀要是整段：/admin/projects-x 不是项目管理的子页，没登记的管理页也不借总览的光。
    expect(currentAdminPage('/admin/projects-x', false)).toBeUndefined();
    expect(currentAdminPage('/admin/unknown', false)).toBeUndefined();
    expect(currentAdminPage('/admin/projects/new', true)).toBe('/admin/capabilities');
    expect(currentAdminPage(resourcesPath, true)).toBe('/admin/capabilities');
    expect(currentAdminPage(resourcesPath, undefined)).toBeUndefined();
  });
});

describe('接入容器相关页面归能力接入', () => {
  test('新建接入容器高亮能力接入，新建数字人仍高亮项目管理', async () => {
    fixture('DigitalWorker'); page = await renderApp('/admin/projects/new?scope=integration');
    // 改之前路由按前缀把「项目管理」标成当前项：它在 /admin/projects 下。
    expect(currentNav()).toEqual(['能力接入']);
    // 顶栏只在项目里才回项目所在的目录；新建时还没有项目，照旧去管理总览。
    expect(topBarAdmin()).toBe('/admin');
    await page.navigate('/admin/projects/new?scope=digital-worker');
    expect(currentNav()).toEqual(['项目管理']);
  });

  test('接入项目的资源配置：左栏是能力接入，返回与顶栏都回接入容器页签', async () => {
    fixture('APIProxy'); page = await renderApp(resourcesPath);
    expect(currentNav()).toEqual(['能力接入']);
    expect(topBarAdmin()).toBe('/admin/capabilities?tab=integrations');
    expect(page.text()).not.toContain('返回项目管理');
    await page.click('返回接入容器');
    expect([page.path(), page.search().tab]).toEqual(['/admin/capabilities', 'integrations']);
    expect(currentNav()).toEqual(['能力接入']);
  });

  test('数字人的资源配置照旧归项目管理', async () => {
    fixture('DigitalWorker'); page = await renderApp(resourcesPath);
    expect(currentNav()).toEqual(['项目管理']);
    expect(topBarAdmin()).toBe('/admin/projects');
    expect(page.text()).not.toContain('返回接入容器');
    await page.click('返回项目管理'); expect(page.path()).toBe('/admin/projects');
  });

  test('接入项目的开通页左栏也是能力接入，顶栏回接入容器页签', async () => {
    fixture('EventProducer'); page = await renderApp(`/admin/projects/${computeProjectId}/provisioning`);
    expect(currentNav()).toEqual(['能力接入']);
    expect(topBarAdmin()).toBe('/admin/capabilities?tab=integrations');
  });

  test('项目种类读到之前不标当前项、不给返回，免得先亮项目管理再跳走', async () => {
    const f = fixture('APIProxy'); let release = () => {};
    f.project.hold = new Promise<void>((resolve) => { release = resolve; });
    page = await renderApp(resourcesPath);
    expect(currentNav()).toEqual([]);
    expect(page.text()).not.toContain('返回项目管理'); expect(page.text()).not.toContain('返回接入容器');
    await act(async () => { release(); }); await page.settle();
    expect(currentNav()).toEqual(['能力接入']); expect(page.text()).toContain('返回接入容器');
  });

  test('非管理员停在拒绝页，外壳不会为判断归属去读项目', async () => {
    const f = fixture('APIProxy'); f.state.admin = false; page = await renderApp(resourcesPath);
    expect(page.text()).toContain('仅平台管理员可见');
    expect(f.calls.filter((path) => path === `/v1/projects/${computeProjectId}`)).toEqual([]);
  });
});
