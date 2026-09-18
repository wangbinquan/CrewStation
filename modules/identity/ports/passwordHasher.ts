/** 本地口令的哈希与校验；实现用 Bun.password 的 argon2id，不引入原生依赖。 */
export interface PasswordHasher {
  hash(plaintext: string): Promise<string>;
  verify(plaintext: string, hash: string): Promise<boolean>;
  /**
   * 对着一个常量哈希做一次真实校验并固定返回 false。
   * 用户不存在、没有口令、账户不可用这些分支都要调它，否则响应时间会泄露账号是否存在。
   */
  verifyDummy(plaintext: string): Promise<false>;
}
