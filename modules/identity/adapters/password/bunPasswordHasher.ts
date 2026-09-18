import type { PasswordHasher } from '../../ports/passwordHasher';

/**
 * argon2id（Bun.password 自带），参数按 OWASP 2024 对 argon2id 的建议：内存约 19 MiB、时间成本 2。
 * 不引入原生依赖，控制面镜像里只有 Bun。
 */
const HASH_OPTIONS = { algorithm: 'argon2id', memoryCost: 19_456, timeCost: 2 } as const;

/**
 * 常量哈希在模块加载时算好并复用：**第一次**被拒绝的登录也要和「口令不对」花一样的时间，
 * 否则冷路径本身就是一个可区分信号（账号是否存在）。
 */
const dummyHash = Bun.password.hash('crewstation-constant-time-dummy', HASH_OPTIONS);
void dummyHash.catch(() => undefined);

export function bunPasswordHasher(): PasswordHasher {
  return {
    hash: (plaintext) => Bun.password.hash(plaintext, HASH_OPTIONS),
    verify: async (plaintext, hash) => {
      if (!hash) return false;
      try {
        return await Bun.password.verify(plaintext, hash);
      } catch {
        return false;
      }
    },
    verifyDummy: async (plaintext) => {
      try {
        await Bun.password.verify(plaintext, await dummyHash);
      } catch {
        // 目的是花掉同样的时间，结果无关。
      }
      return false;
    },
  };
}
