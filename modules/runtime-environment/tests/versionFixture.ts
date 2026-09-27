import type { RuntimeImageValidationTarget, RuntimeImageVersionDto } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { imageContentDigest } from '../domain/contentDigest';
import { digest, type RuntimeImageFixture } from './runtimeImageFixture';

/** 用途与引用用例从一个已登记版本开始；真实 builder 的验证在独立测试中进行。 */
export async function builtVersion(f: RuntimeImageFixture): Promise<RuntimeImageVersionDto> {
  const image = await f.image(), revision = await f.revision(image.id);
  const build = await f.api.startBuild(f.developer, f.project, image.id, { requestKey: newResourceId(), revisionId: revision.id });
  const version: RuntimeImageVersionDto = { id: newResourceId(), projectId: f.project, imageId: image.id, revisionId: revision.id, buildId: build.id, repository: 'registry.test/project/tools', digest, architecture: 'linux/amd64', state: 'available', createdAt: build.createdAt, initializerDigest: imageContentDigest(revision.initializer), toolsDigest: imageContentDigest(revision.tools) };
  await f.uow.run(async (s) => { await s.versions.insert(version); await s.builds.update({ ...(await s.builds.get(build.id))!, state: 'succeeded', versionId: version.id }); });
  return version;
}

export async function passedValidation(f: RuntimeImageFixture, versionId: string, target: RuntimeImageValidationTarget = { usage: 'task' }) {
  const result = await f.api.startValidation(f.developer, f.project, versionId, { requestKey: newResourceId(), target });
  await f.uow.run(async (s) => {
    await s.validations.update({ ...(await s.validations.get(result.id))!, state: 'passed', observedImageId: `registry.test/project/tools@${digest}` });
    const ref = (await s.references.get(versionId, 'validation', result.id))!;
    await s.references.remove(ref.id);
  });
  return result;
}
