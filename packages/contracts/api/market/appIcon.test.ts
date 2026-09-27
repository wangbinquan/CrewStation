import { describe, expect, test } from 'bun:test';
import { AppIconSelectionSchema, AppIconSourceSchema, AppIconUrlSchema, validAppIconUrl } from './appIcon';
import { AppPresentationDtoSchema, SetAppPresentationRequestSchema } from './appListing';

describe('application icon sources', () => {
  test('application defaults and old clients preserve the absent selection', () => {
    expect(SetAppPresentationRequestSchema.parse({ description: '', icon: 'book', expectedRevision: 1 })).not.toHaveProperty('iconSource');
    expect(AppPresentationDtoSchema.parse({ description: '', icon: 'book', revision: 1, updatedAt: null })).not.toHaveProperty('iconSource');
    expect(AppIconSelectionSchema.parse({ kind: 'app' })).toEqual({ kind: 'app' });
    expect(AppIconSourceSchema.parse({ kind: 'upload', revision: 2 })).toEqual({ kind: 'upload', revision: 2 });
    expect(AppIconSelectionSchema.safeParse({ kind: 'upload', revision: 2 }).success).toBe(false);
  });
  test('image URL accepts absolute HTTP(S) and application-root paths only', () => {
    for (const url of ['https://example.test/icon.png', 'http://localhost:8080/favicon.ico', '/assets/icon.webp?version=3']) expect(AppIconUrlSchema.parse(url)).toBe(url);
    for (const url of ['', '//host/icon', '/\\host/icon', 'javascript:alert(1)', 'data:image/png;base64,abc', 'https://user:password@host/icon', 'https://host/a b', 'https://host/\nicon', 'assets/icon.png']) expect(validAppIconUrl(url)).toBe(false);
    expect(AppIconUrlSchema.safeParse('https://host/' + 'a'.repeat(2048)).success).toBe(false);
  });
  test('sources are strict and upload revisions are positive', () => {
    for (const value of [{ kind: 'app', url: '/icon' }, { kind: 'url', url: '/icon', unknown: true }, { kind: 'upload', revision: 0 }, { kind: 'upload', revision: 1, url: '/icon' }]) expect(AppIconSourceSchema.safeParse(value).success).toBe(false);
    expect(SetAppPresentationRequestSchema.safeParse({ description: '', icon: 'book', expectedRevision: 0, unknown: true }).success).toBe(false);
  });
});
