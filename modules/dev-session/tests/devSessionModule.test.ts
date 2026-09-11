import { describe, expect, test } from 'bun:test';
import { createDevSessionModule } from '../wiring';

describe('dev-session module', () => {
  test('装配后暴露模块名', () => {
    expect(createDevSessionModule({}).api.name).toBe('dev-session');
  });
});
