import type { Messages } from '../../shared/lib/i18n';

/** app 级文案：导航、顶栏、语言、404。页面文案在各 feature 的 i18n/ 中。 */
export const messages = {
  'app.brand': 'CrewStation',
  'app.workbench': '工作台',
  'nav.aria': '主导航',
  'nav.platform': '平台',
  'nav.projects': '项目',
  'nav.admin': '管理员',
  'nav.currentProject': '当前项目',
  'nav.overview': '概览',
  'nav.devSession': '开发会话',
  'nav.release': '发布',
  'nav.config': '配置',
  'nav.catalog': '接口目录',
  'nav.events': '事件',
  'nav.logs': '日志',
  'nav.capabilities': '能力说明',
  'topBar.project': '项目 {projectId}',
  'topBar.userPlaceholder': '当前用户（占位）',
  'topBar.userHint': '登录与身份注入由网关（cs-auth）在用户域完成，工作台不写登录代码；接入后此处显示真实用户。',
  'locale.label': '界面语言',
  'locale.zh-CN': '中文',
  'locale.en-US': 'English',
  'notFound.title': '页面不存在',
  'notFound.description': '该地址不对应工作台中的任何页面。',
  'notFound.backToProjects': '返回项目列表',
} satisfies Messages;
