/** session 模块对外能力；每个用例在此增加一个方法签名，实现放在 application/。 */
export interface SessionModuleApi {
  readonly name: 'session';
}
