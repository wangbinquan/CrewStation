/** 一条存着的角色口令：只有密文（I28：data-control 生成、平台密钥加密、按记录 ID 存）。 */
export interface StoredCredential {
  readonly resourceId: string;
  readonly role: string;
  readonly secretBox: string;
}

export interface CredentialStore {
  get(resourceId: string): Promise<StoredCredential | undefined>;
  /** 不在才存，返回存着的那一条——并发时后到的拿到先到的口令，建角色用的与存下的一定是同一个。 */
  putIfAbsent(credential: StoredCredential): Promise<StoredCredential>;
}

export interface SecretCipher {
  encrypt(plain: string): Promise<string>;
  decrypt(boxed: string): Promise<string>;
}
