import type { z } from 'zod';
import type { ObjectStorageDeclaration } from '../api/object-storage/requests';

/** Retain the field until this check, so v2 cannot silently discard a v3 storage request. */
export function requireObjectStorageManifestVersion(manifest: { apiVersion: string; spec: { data?: ObjectStorageDeclaration } }, ctx: z.RefinementCtx): void {
  if (manifest.spec.data && manifest.apiVersion !== 'crewstation/v3') ctx.addIssue({
    code: 'custom', path: ['spec', 'data'], message: '对象存储需要 apiVersion: crewstation/v3',
  });
}
