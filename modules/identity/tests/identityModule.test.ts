import { describe, expect, test } from 'bun:test';
import { createIdentityModule } from '../wiring';

describe('identity module', () => {
  test('装配后暴露模块名', () => {
    expect(createIdentityModule({}).api.name).toBe('identity');
  });
});
