import { expect, test } from 'bun:test';
import { ResourceIdSchema } from './ids';

test('资源身份只接受完整的小写 UUIDv7，不接受名称、前缀、其他版本或错误 variant', () => {
  expect(ResourceIdSchema.parse('019a0bf3-9ff4-7691-9aa7-43c381c573d9')).toBe('019a0bf3-9ff4-7691-9aa7-43c381c573d9');
  for (const id of ['standard-small', 'tsk_019a0bf39ff476919aa743c381c573d9', '019a0bf39ff476919aa743c381c573d9',
    '019a0bf3-9ff4-4691-9aa7-43c381c573d9', '019a0bf3-9ff4-7691-7aa7-43c381c573d9', '019A0BF3-9FF4-7691-9AA7-43C381C573D9', '', '019a0bf3']) {
    expect(ResourceIdSchema.safeParse(id).success).toBe(false);
  }
});
