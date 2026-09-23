import { expect, test } from 'bun:test';
import { isAllowed } from './authorization';

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
