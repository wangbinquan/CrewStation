import type { Actor, RegistryPushCredential, RuntimeImagesInfo } from '@crewstation/contracts';
import type { RegistryVerdict } from '../api/moduleApi';
import type { PushGrant } from '../domain/pushGrant';
import { registryDecision, signGrant, verifyGrant } from '../domain/pushGrant';
import type { AgentRuntimeUseCaseDeps } from './dependencies';
import { adminOnly } from './toDto';

export interface PushCredentialSettings {
  /** 签名密钥（派生自平台密钥），只在本进程内存里。 */
  readonly signingKey: Uint8Array;
  /** 平台底座镜像的标签：安装与升级时按平台版本推送。 */
  readonly baseTag: string;
  /** 推送凭据的有效期（秒）。 */
  readonly ttlSeconds: number;
}

/**
 * 镜像页（RFC-006 §7）：底座镜像的引用与摘要、推送地址与示例 Dockerfile；按需签发有期限的推送凭据，
 * 口令只出现在签发这一次响应里。网关对仓库主机的每个请求经 authorize 裁定。
 */
export function runtimeImageUseCases(deps: AgentRuntimeUseCaseDeps, settings: PushCredentialSettings) {
  const { registry: { layout }, clock } = deps;
  const pushPrefixes = [layout.runtimePrefix];
  const pullPrefixes = [layout.runtimePrefix, layout.baseRepository];
  return {
    runtimeImages: async (actor: Actor): Promise<RuntimeImagesInfo> => {
      adminOnly(actor);
      const base = `${layout.baseRepository}:${settings.baseTag}`;
      const digest = await deps.registry.resolveDigest(layout.baseRepository, { tag: settings.baseTag }).then((d) => ({ digest: d }), (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
      const from = 'digest' in digest ? `${layout.pushHost}/${layout.baseRepository}@${digest.digest}` : `${layout.pushHost}/${base}`;
      return {
        pushHost: layout.pushHost, repositoryPrefix: layout.runtimePrefix, pullReference: `${layout.pullBase}/${layout.runtimePrefix}`,
        baseImage: { reference: `${layout.pullBase}/${base}`, pushHostReference: `${layout.pushHost}/${base}`, ...digest },
        sampleDockerfile: [
          `FROM ${from}`,
          'COPY my-cli /opt/my-cli/bin/my-cli',
          '# 不要修改 USER、ENTRYPOINT、CMD：平台显式以 root 启动 Runner，Runner 再降权启动 Agent。',
          `# 构建后推送：docker push ${layout.pushHost}/${layout.runtimePrefix}my-cli:1.0，档位的镜像填 ${layout.runtimePrefix}my-cli:1.0，二进制路径填 /opt/my-cli/bin/my-cli。`,
          '',
        ].join('\n'),
      };
    },
    issuePushCredential: async (actor: Actor): Promise<RegistryPushCredential> => {
      adminOnly(actor);
      const exp = Math.floor(clock.now().getTime() / 1000) + settings.ttlSeconds;
      const grant: PushGrant = { sub: actor.userId, exp, push: pushPrefixes, pull: pullPrefixes };
      deps.logger.info('registry push credential issued', { userId: actor.userId, expiresAt: new Date(exp * 1000).toISOString() });
      return { pushHost: layout.pushHost, username: actor.userId, password: signGrant(grant, settings.signingKey), expiresAt: new Date(exp * 1000).toISOString(), pushPrefixes, pullPrefixes };
    },
    authorizeRegistryRequest: (input: { authorization?: string; method: string; uri: string }): RegistryVerdict => {
      const basic = /^Basic\s+(.+)$/i.exec(input.authorization ?? '')?.[1];
      if (!basic) return { status: 401, reason: '需要平台签发的推送凭据：请在平台管理的镜像页签发后 docker login' };
      const decoded = Buffer.from(basic, 'base64').toString('utf8');
      const colon = decoded.indexOf(':');
      const grant = colon > 0 ? verifyGrant(decoded.slice(colon + 1), settings.signingKey, Math.floor(clock.now().getTime() / 1000)) : undefined;
      if (!grant || grant.sub !== decoded.slice(0, colon)) return { status: 401, reason: '推送凭据无效或已过期，请重新签发' };
      return registryDecision(grant, input.method, input.uri) === 'allow' ? { status: 200 } : { status: 403, reason: `凭据只允许推送 ${grant.push.join('、')} 前缀、拉取 ${grant.pull.join('、')}` };
    },
  };
}
