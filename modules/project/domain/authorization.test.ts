import { expect, test } from 'bun:test';
import { isAllowed } from './authorization';

test('任务存储终结只供负责人和平台管理员，开发者及应用用户不能确认丢弃', () => {
  expect(isAllowed('owner', 'manage-task-storage')).toBe(true);
  expect(isAllowed('admin', 'manage-task-storage')).toBe(true);
  for (const role of ['developer', 'tester', 'user', undefined] as const) expect(isAllowed(role, 'manage-task-storage')).toBe(false);
});

test('RFC-021 两个新动作只给负责人与平台管理员：下线／推迟／重新部署待验证版本、开关正式版本维护', () => {
  for (const action of ['manage-slots', 'manage-maintenance'] as const) {
    expect(isAllowed('owner', action)).toBe(true);
    expect(isAllowed('admin', action)).toBe(true);
    expect(isAllowed('developer', action)).toBe(false);
    expect(isAllowed('tester', action)).toBe(false);
    expect(isAllowed(undefined, action)).toBe(false);
  }
  // 开发者仍能发布到待命槽、查看项目；测试者只能试用。
  expect(isAllowed('developer', 'publish')).toBe(true);
  expect(isAllowed('tester', 'view')).toBe(false);
});

test('「用户」角色在项目里一个动作都没有：不看项目、不试用待命版、不管成员（2026-09-24 裁定）', () => {
  for (const action of ['view', 'view-preview', 'develop', 'publish', 'manage-members', 'manage-testers', 'manage-slots'] as const) {
    expect(isAllowed('user', action)).toBe(false);
  }
  expect(isAllowed('tester', 'view-preview')).toBe(true);
});
