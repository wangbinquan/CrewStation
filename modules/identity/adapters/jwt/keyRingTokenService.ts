import type { JwksDocument } from '@crewstation/contracts';
import type { KeyRing, KeyRingMaterial } from '@crewstation/jwt';
import { createKeyRing, describeKeyRing, generateSigningKey, isTokenVerificationError, parseKeyRing, rotateKeyRing, serializeKeyRing } from '@crewstation/jwt';
import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger } from '@crewstation/kernel';
import type { KeyStore } from '../../ports/keyStore';
import type { TokenService, VerifiedToken } from '../../ports/tokenService';

export interface KeyRingTokenServiceOptions {
  keyStore: KeyStore;
  issuer: string;
  clock: Clock;
  logger?: Logger;
  /** 轮换后保留的旧钥数量（重叠期）。 */
  keepPrevious?: number;
  /** 遇到未知 kid 时重读 KeyStore 的最小间隔，防止用垃圾令牌打穿数据库。 */
  reloadIntervalMs?: number;
}

interface Loaded {
  material: KeyRingMaterial;
  ring: KeyRing;
}

/**
 * jose 密钥环 + KeyStore：首次启动生成密钥（多副本竞争时以先写入者为准），
 * 验签遇到未知 kid 时重读一次以吸收其他副本的轮换；日志里只出现 kid。
 */
export function keyRingTokenService(options: KeyRingTokenServiceOptions): TokenService {
  const logger = options.logger ?? noopLogger;
  const reloadIntervalMs = options.reloadIntervalMs ?? 5_000;
  let loaded: Promise<Loaded> | undefined;
  let lastReloadAt = 0;

  const build = (material: KeyRingMaterial): Loaded => ({ material, ring: createKeyRing(material, { issuer: options.issuer, clock: options.clock }) });
  const load = async (): Promise<Loaded> => {
    const stored = await options.keyStore.load();
    if (stored) return build(parseKeyRing(stored));
    const fresh: KeyRingMaterial = { active: await generateSigningKey(), previous: [] };
    if (await options.keyStore.create(serializeKeyRing(fresh))) {
      logger.info('signing key generated', describeKeyRing(fresh));
      return build(fresh);
    }
    const winner = await options.keyStore.load();
    if (!winner) throw new Error('签名密钥写入竞争后仍未读到密钥环');
    return build(parseKeyRing(winner));
  };
  const current = (): Promise<Loaded> => {
    loaded ??= load().catch((error: unknown) => {
      loaded = undefined;
      throw error;
    });
    return loaded;
  };
  const reloadIfDue = async (): Promise<Loaded | undefined> => {
    const now = options.clock.now().getTime();
    if (now - lastReloadAt < reloadIntervalMs) return undefined;
    lastReloadAt = now;
    loaded = undefined;
    return current();
  };
  const tryVerify = async (ring: KeyRing, token: string, audience: string): Promise<VerifiedToken | 'unknown-key' | undefined> => {
    try {
      const verified = await ring.verify(token, { audience });
      return { subject: verified.subject, audience: verified.audience, expiresAt: verified.expiresAt, claims: verified.claims };
    } catch (error) {
      if (!isTokenVerificationError(error)) throw error;
      return error.reason === 'unknown-key' ? 'unknown-key' : undefined;
    }
  };

  return {
    sign: async (input) => (await current()).ring.sign(input.claims, { subject: input.subject, audience: input.audience, expiresInSeconds: input.expiresInSeconds }),
    verify: async (token, expected) => {
      const first = await tryVerify((await current()).ring, token, expected.audience);
      if (first !== 'unknown-key') return first;
      const reloaded = await reloadIfDue();
      if (!reloaded) return undefined;
      const second = await tryVerify(reloaded.ring, token, expected.audience);
      return second === 'unknown-key' ? undefined : second;
    },
    jwks: async (): Promise<JwksDocument> => (await current()).ring.jwks(),
    rotate: async () => {
      const { material } = await current();
      const next = rotateKeyRing(material, await generateSigningKey(), options.keepPrevious ?? 2);
      await options.keyStore.replace(serializeKeyRing(next));
      loaded = Promise.resolve(build(next));
      logger.info('signing key rotated', describeKeyRing(next));
      return { kid: next.active.kid };
    },
  };
}
