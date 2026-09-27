import { precondition } from '@crewstation/kernel';
import type { ImageRevision } from '../domain/records';
import type { RuntimeBuildCredentials } from '../ports/buildCredentials';
import type { RuntimeBuildIntents } from '../ports/buildLedger';

export function runtimeImageBuildSecretValues(intents: RuntimeBuildIntents, credentials: RuntimeBuildCredentials, getRevision: (id: string) => Promise<ImageRevision | undefined>) {
  return async (input: { recordId: string; buildId: string; executionEpoch: number }): Promise<Readonly<Record<string, string>>> => {
    const build = await intents.get(input.buildId);
    if (!build?.resourcePlan || build.resourceId !== input.recordId || build.executionEpoch !== input.executionEpoch || build.pendingOutcome || ['cancelling', 'cancelled', 'succeeded', 'failed'].includes(build.state)) throw precondition('构建已结束或身份已变化');
    const revision = await getRevision(build.revisionId);
    if (!revision || revision.source.kind === 'existing') throw precondition('构建修订不存在');
    const git = revision.source.kind === 'source' ? await credentials.issueGit(build, revision) : undefined;
    try {
      if (git && !await intents.addCredential(build.id, build.executionEpoch, git.id)) throw precondition('构建已取消');
      const push = await credentials.push(build, revision), packages = await credentials.packages(build, revision);
      if (!build.resourcePlan.destination.startsWith(`${push.host}/`)) throw precondition('构建推送地址与凭据范围不一致');
      const values: Record<string, string> = { ...(git ? { 'git-token': git.token } : {}), 'docker-config': JSON.stringify({ auths: { [push.host]: { auth: Buffer.from(`${push.username}:${push.password}`).toString('base64') } } }) };
      if (revision.source.kind === 'inline') {
        if (build.resourcePlan.inlineFileCount !== revision.source.files.length) throw precondition('构建文件与固定修订不匹配');
        values['context-dockerfile'] = revision.source.dockerfileContent;
        for (const [index, file] of revision.source.files.entries()) values[`context-file-${index}`] = file.contentBase64;
      }
      for (const id of build.resourcePlan.secretIds) {
        if (packages[id] === undefined) throw precondition('构建 Secret 不可用');
        values[`package-${id}`] = packages[id]!;
      }
      const current = await intents.get(build.id);
      if (!current || current.pendingOutcome || ['cancelling', 'cancelled', 'succeeded', 'failed'].includes(current.state)) throw precondition('构建已结束');
      return values;
    } catch (error) { if (git) await credentials.revokeGit(revision, git.id); throw error; }
  };
}
