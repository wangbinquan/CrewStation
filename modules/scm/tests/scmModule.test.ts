import { describe, expect, test } from 'bun:test';
import { createScmModule } from '../wiring';

describe('scm module', () => {
  test('装配后暴露模块名', () => {
    expect(createScmModule({}).api.name).toBe('scm');
  });
});
