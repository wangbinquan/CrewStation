import { describe, expect, test } from 'bun:test';
import { createObservabilityModule } from '../wiring';

describe('observability module', () => {
  test('装配后暴露模块名', () => {
    expect(createObservabilityModule({}).api.name).toBe('observability');
  });
});
