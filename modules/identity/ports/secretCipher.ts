/** Provider 的 client_secret 封存；实现用 packages/secretbox（AES-256-GCM，密钥来自安装配置）。 */
export interface SecretCipher {
  seal(plaintext: string): Promise<string>;
  /** 解不开（换了密钥、密文被截断）时抛错；调用方按「凭据不可用」处理，不把原文或密钥写进日志。 */
  open(boxed: string): Promise<string>;
}
