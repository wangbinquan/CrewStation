import { describe, expect, test } from 'bun:test';
import { createConfigModule } from '../wiring';

describe('config module', () => {
  test('装配后暴露模块名', () => {
    expect(createConfigModule({}).api.name).toBe('config');
  });
});
