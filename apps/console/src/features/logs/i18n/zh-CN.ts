import type { Messages } from '../../../shared/lib/i18n';

export const messages = {
  'logs.title': '日志',
  'logs.line1': '服务与任务容器的日志集中聚合到此页；同时显示两个部署槽的健康态。',
  'logs.line2': '按来源与部署槽拉取一页，页内再用关键字过滤；“跟随”打开时每 5 秒取一次最新一页。',


  'logs.health.title': '部署健康态',
  'logs.health.replicas': '就绪副本',
  'logs.health.restarts': '重启次数',
  'logs.health.lastTransitionAt': '最近变化',
  'logs.health.emptyTitle': '暂无健康态',
  'logs.health.emptyDescription': '服务发布到部署槽后，这里显示两个槽各自的副本与健康状态。',
  'logs.healthState.healthy': '健康',
  'logs.healthState.degraded': '降级',
  'logs.healthState.crash-looping': '反复重启',
  'logs.healthState.unhealthy': '不健康',
  'logs.healthState.unknown': '未知',

  'logs.filters.source': '来源',
  'logs.filters.slot': '部署槽',
  'logs.filters.slotAll': '全部',
  'logs.filters.limit': '每页条数',
  'logs.filters.text': '关键字',
  'logs.filters.textPlaceholder': '在本页内过滤',
  'logs.filters.slotHint': '只有来源为部署槽时生效。',
  'logs.source.slot': '部署槽',
  'logs.source.dev-session': '开发会话',
  'logs.source.business-task': '业务任务',
  'logs.source.build': '构建',
  'logs.source.migration': '迁移',
  'logs.slot.preview': 'preview',
  'logs.slot.prod': 'prod',

  'logs.follow.on': '跟随中',
  'logs.follow.off': '跟随',
  'logs.follow.hint': '跟随时每 5 秒取一次最新一页，并保持滚到底部；向上滚动会暂停自动置底。',

  'logs.list.title': '日志',
  'logs.list.count': '本页 {shown} / {total} 条',
  'logs.list.emptyTitle': '尚无日志',
  'logs.list.emptyDescription': '换一个来源或部署槽再试；接口尚未就绪时会显示读取失败。',
  'logs.list.noMatchTitle': '本页没有匹配的行',
  'logs.list.noMatchDescription': '关键字只在已取回的这一页内过滤，清空关键字可看到全部。',
  'logs.list.noPagingHint': '只能看最新一页：首版日志直接读 Pod 日志尾部，那个接口没有游标；往前翻页要等日志采集与保留落地。',


  'logs.level.error': 'ERROR',
  'logs.level.warn': 'WARN',
  'logs.level.info': 'INFO',
  'logs.level.debug': 'DEBUG',
} satisfies Messages;
