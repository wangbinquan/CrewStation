import type { Messages } from '../../../shared/lib/i18n';

export const messages = {
  'config.title': '配置',
  'config.line1': '配置与密钥是平台对象，在 Manifest 的 env 段声明，分开发与生产两组值；生产值由项目负责人维护。',
  'config.line2': '以环境变量注入任务容器与服务，并随 Release 版本化。',
  'config.emptyTitle': '尚无配置项',
  'config.emptyDescription': 'Manifest env 段登记后，配置项与两组值在此维护。',
} satisfies Messages;
