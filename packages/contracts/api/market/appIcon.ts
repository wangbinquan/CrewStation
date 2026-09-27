import { z } from 'zod';

/** Root-relative paths resolve against the authorized application origin, never the console. */
export function validAppIconUrl(value: string): boolean {
  if ([...value].some((char) => char.charCodeAt(0) <= 32 || char === '\\')) return false;
  if (value.startsWith('/')) return !value.startsWith('//');
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
export const AppIconUrlSchema = z.string().trim().min(1).max(2048).refine(validAppIconUrl, 'Use an HTTP(S) image URL or an application-relative path');
export const AppIconSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('app') }).strict(),
  z.object({ kind: z.literal('url'), url: AppIconUrlSchema }).strict(),
]);
export const AppIconSourceSchema = z.union([AppIconSelectionSchema, z.object({ kind: z.literal('upload'), revision: z.number().int().positive() }).strict()]);
export type AppIconSelection = z.infer<typeof AppIconSelectionSchema>;
export type AppIconSource = z.infer<typeof AppIconSourceSchema>;
export const APP_ICON_MAX_BYTES = 2 * 1024 * 1024;
