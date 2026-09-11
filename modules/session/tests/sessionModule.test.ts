import { describe, expect, test } from 'bun:test';
import { createSessionModule } from '../wiring';

describe('session module', () => {
  test('装配后暴露模块名', () => {
    expect(createSessionModule({}).api.name).toBe('session');
  });
});
