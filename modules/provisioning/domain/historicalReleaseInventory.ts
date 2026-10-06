import { HistoricalReleaseRegisteredInventorySchema, ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { z } from 'zod';
import type { InfrastructureOriginDocument, InfrastructureOriginReference } from './infrastructureOrigins';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const provenance = z.object({ version: z.literal('resource-identity/v1'), sourceColumn: z.literal('legacy_payload'), originalHash: hash, normalizedHash: hash }).strict();
/** Migration reproduction is a separate mandatory witness; matching caller-provided hashes alone are insufficient. */
export function historicalReleaseReferences(document: InfrastructureOriginDocument) {
  if (document.channel !== 'event' || document.name !== 'release.registered') throw precondition('不是受支持的历史发布事件');
  const original = HistoricalReleaseRegisteredInventorySchema.parse(document.legacyPayload), proof = provenance.parse(document.identityProvenance);
  if (proof.originalHash !== jsonHash(document.legacyPayload) || proof.normalizedHash !== jsonHash(document.payload)) throw precondition('历史发布事件的完整双摘要不符');
  if (!document.payload || typeof document.payload !== 'object' || Array.isArray(document.payload)) throw precondition('历史发布事件规范化正文缺失');
  const body = document.payload as Record<string, unknown>;
  const fields = { projectId: 'project', serviceId: 'service', releaseId: 'release' } as const;
  const current: InfrastructureOriginReference[] = Object.entries(fields).map(([field, kind]) => ({ kind, key: ResourceIdSchema.parse(body[field]) }));
  const legacy: InfrastructureOriginReference[] = Object.entries(fields).map(([field, kind]) => ({ kind, key: original[field as keyof typeof fields] }));
  return { current, legacy };
}
