import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import type { ProjectDto } from '@crewstation/contracts';
import { ProjectIdSchema, UserIdSchema } from '@crewstation/contracts';
import { ProjectDeletionProvider } from '../app/project/ProjectDeletionProvider';
import { ProjectLifecycleCard } from '../features/projects/components/ProjectLifecycleCard';
import { messages } from '../features/projects/i18n/zh-CN';
import { deletionPlan } from './projectDeletionFixture';
import { renderElement } from './renderElement';
import { openDialog } from './confirmDialogDriver';
import { act } from 'react';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; sessionStorage.clear(); });
const plan = deletionPlan(), userId = UserIdSchema.parse('01a0f30b-c652-7000-8d6f-553e3b5f6138');
const project: ProjectDto = { id: ProjectIdSchema.parse(plan.target.id), name: plan.target.name, slug: plan.target.slug,
  namespace: plan.target.namespace, kind: 'DigitalWorker', state: 'archived', ownerUserId: userId, createdAt: '2026-09-30T04:00:00Z' };
function fixture(admin = true) {
  let available = false; const paths: string[] = [];
  globalThis.fetch = (async (raw) => {
    const path = new URL(String(raw), 'http://localhost').pathname; paths.push(path);
    if (path === '/v1/me') return Response.json({ id: userId, name: 'Viewer', platformRole: admin ? 'admin' : 'developer', isAdmin: admin, memberships: [] });
    if (path.endsWith('/capabilities')) return Response.json({ available });
    if (path.endsWith('/deletion-operation')) return Response.json({ projectId: project.id, operation: null });
    if (path.endsWith('/deletion-plans')) return Response.json(plan);
    throw Error('Unexpected write');
  }) as typeof fetch;
  return { paths, enable: () => { available = true; } };
}
test('archived projects expose permanent deletion only with real server capability, and close returns focus to the lifecycle button', async () => {
  const f = fixture(); page = await renderElement(<ProjectDeletionProvider><ProjectLifecycleCard project={project} isAdmin unavailable={false} /></ProjectDeletionProvider>, messages);
  expect(page.button('永久删除项目')).toBeUndefined(); f.enable(); await page.reread();
  const trigger = page.button('永久删除项目'); trigger.focus(); await page.click('永久删除项目');
  expect(openDialog().textContent).toContain(project.name); expect(openDialog().textContent).toContain('业务数据');
  await page.click('继续删除…'); expect(document.querySelectorAll('dialog[open]')).toHaveLength(2);
  await act(async () => openDialog().dispatchEvent(new Event('cancel', { cancelable: true }))); await page.settle();
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(1); await page.click('关闭');
  expect(document.activeElement).toBe(trigger); expect(page.text()).toContain('项目已归档');
  expect(f.paths.some(path => path.endsWith('/deletions') || path.endsWith('/archive'))).toBe(false);
});
test('an ordinary member cannot get a deletion entry even if the card receives stale administrator props', async () => {
  const f = fixture(false); f.enable();
  page = await renderElement(<ProjectDeletionProvider><ProjectLifecycleCard project={project} isAdmin unavailable={false} /></ProjectDeletionProvider>, messages);
  expect(page.button('永久删除项目')).toBeUndefined(); expect(f.paths).toEqual(['/v1/me']);
});
