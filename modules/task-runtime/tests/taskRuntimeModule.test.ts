import { describe, expect, test } from 'bun:test';
import { createTaskRuntimeModule } from '../wiring';

describe('task-runtime module', () => {
  test('装配后暴露模块名', () => {
    expect(createTaskRuntimeModule({}).api.name).toBe('task-runtime');
  });
});
