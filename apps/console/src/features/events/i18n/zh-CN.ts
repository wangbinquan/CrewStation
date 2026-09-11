import type { Messages } from '../../../shared/lib/i18n';

export const messages = {
  'events.title': '事件',
  'events.line1': '公司 webhook 经服务域进入 EventProducer 接入容器，转成平台事件交给 cs-events：去重、持久化，再带来源令牌与 trace_id 经服务域推送到 active prod 槽的处理路径。',
  'events.line2': '这里查看本服务的事件订阅与投递状态；第一版没有业务自定义事件，也没有平台调度器。',
  'events.emptyTitle': '尚无事件订阅',
  'events.emptyDescription': 'Manifest 登记的订阅与每次投递的状态将在此显示。',
} satisfies Messages;
