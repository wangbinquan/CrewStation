import { ResourceIdSchema } from '@crewstation/contracts';
export function parseImageCatalogSearch(raw: Record<string, unknown>): { q?: string; before?: string } {
  return { ...(typeof raw.q === 'string' && raw.q.trim() ? { q: raw.q.trim().slice(0, 120) } : {}), ...(ResourceIdSchema.safeParse(raw.before).success ? { before: String(raw.before) } : {}) };
}
