import type { Database } from '@crewstation/persistence';
import { objectCatalogRepository } from '../adapters/persistence/objectCatalog';
import { objectContentRepository } from '../adapters/persistence/objectContent';
import { objectUploadRepository } from '../adapters/persistence/objectUploads';
import { objectReadRepository } from '../adapters/persistence/objectReads';
import { archivePlanRepository } from '../adapters/persistence/archive/plans';
import { backendFixture, objectId, sourceFixture } from './objectFixtures';

export async function objectArchiveFixture(db: Database) {
  const catalog = objectCatalogRepository(db), uploads = objectUploadRepository(db), content = objectContentRepository(db);
  const backend = await catalog.registerBackend(backendFixture({ health: 'ready', observedAt: new Date().toISOString() })), source = sourceFixture();
  const storagePlan = await catalog.savePlan(objectId(), { name: 'Test', backendId: backend.id, quotaBytes: 1000, maxObjectBytes: 1000, maxConcurrentTransfers: 4, enabled: true });
  await catalog.authorizePlans(source.projectId, 1, [storagePlan.id]);
  const space = await catalog.ensureSpace({ ...source, id: objectId(), planId: storagePlan.id, deploymentMode: 'local' }), authority = { source };
  const input = { requestKey: objectId(), name: 'artifact', mediaType: 'text/plain', size: 100, sha256: 'a'.repeat(64) };
  const upload = await uploads.reserve(space.id, objectId(), input, authority), claim = await uploads.begin(upload.id, objectId(), objectId(), authority);
  await uploads.finish(claim.attempt, { receivedBytes: 100, sha256: input.sha256 }); await uploads.requestCommit(upload.id, authority);
  const verification = (await uploads.claimVerification(objectId()))!;
  const object = (await uploads.verified(verification.attempt, { size: 100, sha256: input.sha256 }))!;
  const plans = archivePlanRepository(db), taskId = objectId();
  const plan = await plans.create(space.id, taskId, objectId(), objectId(), authority);
  return { catalog, content, backend, source, space, authority, object, plans, plan, taskId, reads: objectReadRepository(db) };
}
