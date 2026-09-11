import { describe, expect, test } from 'bun:test';
import { createEventsModule } from '../wiring';

describe('events module', () => {
  test('装配后暴露模块名', () => {
    expect(createEventsModule({}).api.name).toBe('events');
  });
});
