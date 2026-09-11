/** Secret 值的加解密；密钥由安装配置提供，模块只见密文。 */
export interface SecretCipher {
  encrypt(plain: string): Promise<string>;
  decrypt(cipher: string): Promise<string>;
}
