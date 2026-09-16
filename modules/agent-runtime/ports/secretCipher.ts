/** 凭据值的加解密；密钥来自安装配置（与 config 模块同一把 SecretBox 密钥），模块只见密文。 */
export interface SecretCipher {
  encrypt(plain: string): Promise<string>;
  decrypt(cipher: string): Promise<string>;
}
