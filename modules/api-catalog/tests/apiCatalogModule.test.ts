import { describe, expect, test } from 'bun:test';
import { createApiCatalogModule } from '../wiring';

describe('api-catalog module', () => {
  test('装配后暴露模块名', () => {
    expect(createApiCatalogModule({}).api.name).toBe('api-catalog');
  });
});
