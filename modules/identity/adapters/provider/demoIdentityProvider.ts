import { DemoLoginRequestSchema } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import { DEMO_EXTERNAL_ID_PREFIX } from '../../domain/user';
import type { IdentityProvider } from '../../ports/identityProvider';
import { renderDemoLoginPage } from './demoLoginPage';

/** 演示身份邮箱缺省落在保留域 `.invalid`，不会与任何真实邮箱撞车。 */
export const DEMO_EMAIL_DOMAIN = 'demo.invalid';

/**
 * 演示身份适配器：用户名即身份，外部标识 `demo:<username>`。只用于本地演示与开发；
 * 正式环境由 OIDC 适配器替代，工作台按 AuthStatusDto.provider 与 CurrentUserDto.demoIdentity 标注。
 */
export function demoIdentityProvider(): IdentityProvider {
  return {
    kind: 'demo',
    loginPage: async ({ returnTo }) => ({ kind: 'html', html: renderDemoLoginPage({ returnTo }) }),
    handleLogin: async (input) => {
      const parsed = DemoLoginRequestSchema.safeParse(withoutBlankFields(input));
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
        throw validation(`演示登录参数不正确：${issues.map((i) => `${i.path || '$'}: ${i.message}`).join('；')}`, { issues });
      }
      const { username, displayName, email, returnTo } = parsed.data;
      return {
        principal: { externalId: `${DEMO_EXTERNAL_ID_PREFIX}${username}`, name: displayName ?? username, email: email ?? `${username}@${DEMO_EMAIL_DOMAIN}` },
        ...(returnTo === undefined ? {} : { returnTo }),
      };
    },
  };
}

/** 浏览器表单把未填的可选字段提交为空串；按缺省处理。 */
function withoutBlankFields(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => !(typeof value === 'string' && value.trim() === '')));
}
