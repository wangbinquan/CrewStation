import { PlatformError } from '@crewstation/kernel';
import type { IdentityProvider } from '../ports/identityProvider';

export const PROVIDER_UNAVAILABLE_MESSAGE = '未配置身份提供者';

/** cs-api 等只挂管理面的进程不配置登录适配器；登录相关用例在那里回 503 而不是崩溃。 */
export function requireProvider(provider: IdentityProvider | undefined): IdentityProvider {
  if (!provider) throw new PlatformError('unavailable', PROVIDER_UNAVAILABLE_MESSAGE);
  return provider;
}
