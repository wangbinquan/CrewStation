import type { Messages } from '../../../shared/lib/i18n';

export const messages = {
  'devSession.title': '开发会话',
  'devSession.line1': '一个项目同时最多一个开发会话：一个长期运行的开发容器，内含常驻 TaskRunner（独立 UID），默认连接开发数据库。',
  'devSession.line2': '这里将提供多个并行的流式交互 Agent、Web 终端、编辑器、预览、日志页与发布控件；会话空闲只触发提醒。',
  'devSession.emptyTitle': '尚无开发会话',
  'devSession.emptyDescription': '启动后此处显示 Agent 会话、终端、编辑器与预览。',
} satisfies Messages;
