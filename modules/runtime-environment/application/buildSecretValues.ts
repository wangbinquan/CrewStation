import { precondition } from '@crewstation/kernel';
import type { ImageRevision } from '../domain/records';
import type { RuntimeBuildCredentials } from '../ports/buildCredentials';
import type { RuntimeBuildIntents } from '../ports/buildLedger';

export function runtimeImageBuildSecretValues(intents: RuntimeBuildIntents, credentials: RuntimeBuildCredentials, getRevision: (id: string) => Promise<ImageRevision | undefined>) {
  return async (input: { recordId: string; buildId: string; executionEpoch: number }): Promise<Readonly<Record<string, string>>> => {
    const build = await intents.get(input.buildId);
    if (!build?.resourcePlan || build.resourceId !== input.recordId || build.executionEpoch !== input.executionEpoch || build.pendingOutcome || ['cancelling', 'cancelled', 'succeeded', 'failed'].includes(build.state)) throw precondition('构建已结束或身份已变化');
    const revision = await getRevision(build.revisionId);
    if (!revision || revision.source.kind !== 'source') throw precondition('源码修订不存在');
    const git = await credentials.issueGit(build, revision);
    try {
      if (!await intents.addCredential(build.id, build.executionEpoch, git.id)) throw precondition('构建已取消');
      const push = await credentials.push(build, revision), packages = await credentials.packages(build, revision);
      if (!build.resourcePlan.destination.startsWith(`${push.host}/`)) throw precondition('构建推送地址与凭据范围不一致');
      const values: Record<string, string> = { 'git-token': git.token, 'docker-config': JSON.stringify({ auths: { [push.host]: { auth: Buffer.from(`${push.username}:${push.password}`).toString('base64') } } }) };
      for (const id of build.resourcePlan.secretIds) {
        if (packages[id] === undefined) throw precondition('构建 Secret 不可用');
        values[`package-${id}`] = packages[id]!;
      }
      const current = await intents.get(build.id);
      if (!current || current.pendingOutcome || ['cancelling', 'cancelled', 'succeeded', 'failed'].includes(current.state)) throw precondition('构建已结束');
      return values;
    } catch (error) { await credentials.revokeGit(revision, git.id); throw error; }
  };
}
