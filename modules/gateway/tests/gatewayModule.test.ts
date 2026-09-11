import { describe, expect, test } from 'bun:test';
import { createGatewayModule } from '../wiring';

describe('gateway module', () => {
  test('装配后暴露模块名', () => {
    expect(createGatewayModule({}).api.name).toBe('gateway');
  });
});
