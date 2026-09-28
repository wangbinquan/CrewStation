import type { UserId } from '@crewstation/contracts';
import { AdministrativeArchiveRevisionSchema, AdministrativeFinalizationSchema, ArchiveLossPageQuerySchema, ArchiveRevisionPreviewRequestSchema, ConfirmFinalizationLossSchema, OperatorArchivePlanSchema, TaskIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseParams, parseQuery } from '@crewstation/http';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { BusinessStorageOperatorApi } from '../api/storageOperator';
import { executionBody } from './executionBody';
import { DeleteArchiveArtifactsSchema } from '@crewstation/contracts';

export function storageOperatorRoutes(api: BusinessStorageOperatorApi, isAdmin: (id: UserId) => Promise<boolean>) {
  const router = new Hono<AppEnv>();
  const taskId = (c: Context<AppEnv>) => parseParams(c, z.object({ taskId: TaskIdSchema })).taskId;
  const actor = async (c: Context<AppEnv>) => { const a = await actorFrom(c, (id) => isAdmin(id as UserId)); return { userId: a.userId as UserId, isAdmin: a.isAdmin }; };
  router.get('/v3/object-storage/tasks/:taskId/finalization-preview', async (c) => c.json(await api.previewStorageFinalization(await actor(c), taskId(c))));
  router.post('/v3/object-storage/tasks/:taskId/delete-artifacts', async (c) => c.json(await api.deleteStorageArtifacts(await actor(c), taskId(c), await executionBody(c, DeleteArchiveArtifactsSchema)), 202));
  router.post('/v3/object-storage/tasks/:taskId/archive-revision-preview', async (c) => c.json(await api.previewStorageArchiveRevision(await actor(c), taskId(c), await executionBody(c, ArchiveRevisionPreviewRequestSchema))));
  router.get('/v3/object-storage/tasks/:taskId/loss-assessment', async (c) => c.json(await api.assessStorageLoss(await actor(c), taskId(c), parseQuery(c, ArchiveLossPageQuerySchema))));
  router.post('/v3/object-storage/tasks/:taskId/confirm-loss', async (c) => c.json(await api.confirmStorageLoss(await actor(c), taskId(c), await executionBody(c, ConfirmFinalizationLossSchema)), 202));
  router.post('/v3/object-storage/tasks/:taskId/archive-plans', async (c) => c.json(await api.prepareStorageArchive(await actor(c), taskId(c), await executionBody(c, OperatorArchivePlanSchema)), 201));
  router.post('/v3/object-storage/tasks/:taskId/finalize', async (c) => c.json(await api.finalizeStorageAsOperator(await actor(c), taskId(c), await executionBody(c, AdministrativeFinalizationSchema)), 202));
  router.post('/v3/object-storage/tasks/:taskId/revise-archive', async (c) => c.json(await api.reviseStorageAsOperator(await actor(c), taskId(c), await executionBody(c, AdministrativeArchiveRevisionSchema)), 202));
  return router;
}
