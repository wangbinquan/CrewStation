import { RuntimeImageCatalogEntryDtoSchema } from '@crewstation/contracts';
import type { RuntimeImageCatalogEntryDto } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, desc, inArray, lt, sql } from 'drizzle-orm';
import type { Page } from '../../ports/repositories';
import { imageBuilds, imageValidations, imageVersions, runtimeImages } from './tables';

/** 每页固定最多四次查询，不能把浏览器 N+1 改成数据库 N+1。先分页，再批量取最新记录。 */
export async function readAdminCatalog(db: Executor, page: Page): Promise<RuntimeImageCatalogEntryDto[]> {
  const images = await db.select().from(runtimeImages).where(and(
    page.before ? lt(runtimeImages.id, page.before) : undefined,
    page.search ? sql`strpos(lower(${runtimeImages.name} || ' ' || (${runtimeImages.payload}->>'description')), lower(${page.search})) > 0` : undefined,
  )).orderBy(desc(runtimeImages.id)).limit(page.limit);
  if (!images.length) return [];
  const ids = images.map((row) => row.id);
  const [versions, builds] = await Promise.all([
    db.selectDistinctOn([imageVersions.imageId]).from(imageVersions).where(inArray(imageVersions.imageId, ids)).orderBy(imageVersions.imageId, desc(imageVersions.id)),
    db.selectDistinctOn([imageBuilds.imageId]).from(imageBuilds).where(inArray(imageBuilds.imageId, ids)).orderBy(imageBuilds.imageId, desc(imageBuilds.id)),
  ]);
  const validations = versions.length ? await db.selectDistinctOn([imageValidations.versionId]).from(imageValidations).where(inArray(imageValidations.versionId, versions.map((v) => v.id))).orderBy(imageValidations.versionId, desc(imageValidations.id)) : [];
  const byImage = new Map(versions.map((v) => [v.imageId, v.payload])), buildByImage = new Map(builds.map((b) => [b.imageId, b.payload]));
  const byVersion = new Map(validations.map((v) => [v.versionId, v.payload]));
  return images.map(({ id, payload }) => {
    const version = byImage.get(id), validation = version ? byVersion.get(version.id) : undefined;
    // Schema picks are the response boundary: execution internals and output must never leak into the list.
    return RuntimeImageCatalogEntryDtoSchema.parse({ ...payload, summary: {
      version: version ?? null, build: buildByImage.get(id) ?? null,
      validation: validation ? { id: validation.id, state: validation.state, usage: validation.target.usage } : null,
    } });
  });
}
