import { describe, expect, test } from 'bun:test';
import { createEgressModule } from '../wiring';

describe('egress module', () => {
  test('装配后暴露模块名', () => {
    expect(createEgressModule({}).api.name).toBe('egress');
  });
});
