import { describe, expect, test } from 'bun:test';
import { createBusinessTaskModule } from '../wiring';

describe('business-task module', () => {
  test('装配后暴露模块名', () => {
    expect(createBusinessTaskModule({}).api.name).toBe('business-task');
  });
});
