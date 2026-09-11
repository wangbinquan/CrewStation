import { describe, expect, test } from 'bun:test';
import { createProjectModule } from '../wiring';

describe('project module', () => {
  test('装配后暴露模块名', () => {
    expect(createProjectModule({}).api.name).toBe('project');
  });
});
