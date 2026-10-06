import { HistoricalReleaseRegisteredInventorySchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { reproduceIdentityDocument } from '@crewstation/persistence';
import type { ResourceIdentityDirectory } from '@crewstation/persistence';
import { eventbusMigrations } from './publish';

/** Only the actual, locked identity migration is supported. This reader never sends/replays an event. */
export async function reproduceHistoricalRelease(original: unknown, identities: Pick<ResourceIdentityDirectory, 'resolve'>): Promise<unknown> {
  const parsed = HistoricalReleaseRegisteredInventorySchema.parse(original);
  const declarations = eventbusMigrations.files.flatMap((file) => 'identity' in file ? file.identity.documents ?? [] : [])
    .filter((entry) => entry.table === 'domain_events' && entry.column === 'legacy_payload' && entry.targetColumn === 'payload' && entry.where?.['topic'] === 'release.registered');
  const declaration = declarations[0];
  if (declarations.length !== 1 || !declaration || jsonHash(declaration) !== 'd20df4888d2aa868747e6afb4e4346973bb6361968436510845cf92995ae445c')
    throw precondition('旧发布事件的原迁移声明无法核实');
  return reproduceIdentityDocument(original, declaration, { topic: 'release.registered', identity_project_id: parsed.projectId, identity_service_id: parsed.serviceId }, identities.resolve);
}
