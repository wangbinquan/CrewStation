export interface NativeWorkSettings {
  readonly registry: { readonly imageDigest: string };
  readonly buildkit: { readonly imageDigest: string; readonly configIdentity: string; readonly args: readonly string[] };
}
/** Deployment pins original native images and BuildKit configuration. Requests
 * never choose a daemon, command, filesystem root or privilege. */
export function nativeWorkSettings(raw: string | undefined): NativeWorkSettings | undefined {
  if (raw === undefined) return undefined;
  try {
    const value = JSON.parse(raw), digest = /^sha256:[a-f0-9]{64}$/;
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== 'buildkit,registry'
      || !value.registry || Object.keys(value.registry).join() !== 'imageDigest' || !digest.test(value.registry.imageDigest)
      || !value.buildkit || Object.keys(value.buildkit).sort().join() !== 'args,configIdentity,imageDigest' || !digest.test(value.buildkit.imageDigest)
      || !/^[a-f0-9]{64}$/.test(value.buildkit.configIdentity) || !Array.isArray(value.buildkit.args) || !value.buildkit.args.length
      || value.buildkit.args.some((arg: unknown) => typeof arg !== 'string' || !arg || arg.length > 1024)) throw Error();
    return { registry: { imageDigest: value.registry.imageDigest }, buildkit: { imageDigest: value.buildkit.imageDigest, configIdentity: value.buildkit.configIdentity, args: [...value.buildkit.args] } };
  } catch { throw Error('永久删除原 Registry、BuildKit 镜像与入口配置不完整'); }
}
