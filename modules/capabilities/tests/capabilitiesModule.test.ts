import { describe, expect, test } from 'bun:test';
import { createCapabilitiesModule } from '../wiring';

describe('capabilities module', () => {
  test('装配后暴露模块名', () => {
    expect(createCapabilitiesModule({}).api.name).toBe('capabilities');
  });
});
