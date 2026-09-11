import { describe, expect, test } from 'bun:test';
import { createDataModule } from '../wiring';

describe('data module', () => {
  test('装配后暴露模块名', () => {
    expect(createDataModule({}).api.name).toBe('data');
  });
});
