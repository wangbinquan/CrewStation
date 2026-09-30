import type { Clock, Logger } from '@crewstation/kernel';
import { objectSpaceDeclaration } from '../domain/objectLedger';
import type { ObjectSpaceRecord } from '../domain/objectStorage';
import type { DataLedger } from '../ports/ledger';
import type { ObjectCatalogRepository } from '../ports/objectStorage';

export function objectLedgerProjection(catalog: ObjectCatalogRepository, ledger: DataLedger, clock: Clock, logger: Logger) {
  const project = async (space: ObjectSpaceRecord) => ledger.declare(objectSpaceDeclaration(space, await catalog.backend(space.backendId), clock.now()));
  return {
    catalog: { ...catalog, applyResourceChange: async (input: Parameters<ObjectCatalogRepository['applyResourceChange']>[0]) => {
      const receipt = await catalog.applyResourceChange(input);
      if (input.target.resourceType === 'object-space') { const space = await catalog.space(input.target.resourceId); if (space) await project(space); }
      return receipt;
    }, ensureSpace: async (input: Parameters<ObjectCatalogRepository['ensureSpace']>[0]) => {
      const space = await catalog.ensureSpace(input); await project(space); return space;
    } } satisfies ObjectCatalogRepository,
    resync: async () => {
      let count = 0;
      for (const space of await catalog.spaces()) {
        try { await project(space); count++; }
        catch { logger.warn('object space ledger projection pending', { spaceId: space.id }); }
      }
      return count;
    },
  };
}
