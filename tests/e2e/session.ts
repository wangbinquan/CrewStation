import type { Browser, Page } from './cdp';
import { apiGet, connectBrowser, signIn } from './consoleSession';

export interface DiscoveredProject {
  readonly id: string;
  readonly name: string;
}

export interface AdminSession {
  readonly browser: Browser;
  readonly admin: Page;
  /** 环境里可用于项目空间验收的数字人项目；全新集群里没有，取不到就是 undefined。 */
  readonly project: DiscoveredProject | undefined;
  readonly close: () => Promise<void>;
}

interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly state?: string;
  readonly serviceId?: string;
  readonly kind?: string;
}

/**
 * 以管理员登录并发现一个可用项目。
 *
 * 在模块加载期做这件事，是为了让「环境里没有项目」表现成一组显式跳过，而不是让断言在
 * 「没有对象」上失败——`describe.skipIf` 只能在注册时判断，beforeAll 里发现就来不及了。
 * 任何一步出错都返回 undefined，让整套用例跳过而不是崩在加载期。
 */
export async function openAdminSession(): Promise<AdminSession | undefined> {
  let browser: Browser | undefined;
  try {
    browser = await connectBrowser();
    const admin = await signIn(browser, 'admin', 'CrewStation Admin');
    const page = await apiGet<{ items?: ProjectRow[] }>(admin, '/v1/projects?limit=50');
    // 必须是已开通且有服务的数字人项目：开通失败或半截的项目页面构成不同，拿它断言只会得出假结论。
    const usable = (page.items ?? []).find(
      (row) => row.state === 'active' && typeof row.serviceId === 'string' && row.kind === 'DigitalWorker',
    );
    const owned = browser;
    return {
      browser: owned,
      admin,
      project: usable ? { id: usable.id, name: usable.name } : undefined,
      close: async () => {
        await admin.close().catch(() => undefined);
        owned.close();
      },
    };
  } catch {
    browser?.close();
    return undefined;
  }
}
