import { describe, expect, test } from 'bun:test';
import { createReleaseModule } from '../wiring';

describe('release module', () => {
  test('装配后暴露模块名', () => {
    expect(createReleaseModule({}).api.name).toBe('release');
  });
});
