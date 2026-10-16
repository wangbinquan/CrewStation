import { useState } from 'react';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { Badge } from '../../../../apps/console/src/shared/ui/Badge';
import { Dialog } from '../../../../apps/console/src/shared/ui/dialog/Dialog';
import { ConfirmationDialog } from '../../../../apps/console/src/shared/ui/dialog/ConfirmationDialog';
import { BotTranscript } from '../../../../apps/console/src/features/dev-session/components/bot/BotTranscript';
import { line } from './fixture';
import type { DemoState } from './fixture';

export function HistoryDialog({ state, onClose, onFresh }: { state: DemoState; onClose: () => void; onFresh: () => void }) {
  const [fresh, setFresh] = useState(false), [old, setOld] = useState<string>();
  return <Dialog title="历史与设置" size="large" onClose={onClose}>
    <section className="historyCurrent"><div><strong>当前 Bot 对话</strong><p>贪吃蛇 · 持续开发</p></div><Badge tone="success">当前</Badge></section>
    <dl className="sessionFacts"><dt>上下文</dt><dd>{state.status === 'missing' ? '原生上下文不可恢复' : '沿用本对话的原生上下文'}</dd><dt>执行记录</dt><dd>{state.executions} 次执行 · 均保留在当前对话</dd><dt>CLI</dt><dd>独立会话，共享项目文件</dd></dl>
    <div className="historySection"><strong>此前单独创建的会话</strong><p>各自有独立上下文，查看不会合并到当前对话。</p>
      {['最初的开发尝试', '发布前的只读验收'].map((title, index) => <div className="historyRow" key={title}><div><strong>{title}</strong><small>{index ? '独立的验收记录' : '已结束 · 原上下文未保存'}</small></div><Button size="small" onClick={() => setOld(title)}>查看记录</Button></div>)}
    </div>
    <div className="historySection"><strong>新的上下文</strong><p>仅当你主动想重新开始时使用。原记录保留，模型将不再沿用此前上下文。</p><Button onClick={() => setFresh(true)} disabled={state.status === 'running'}>开始新的上下文</Button></div>
    {old ? <Dialog title={old} size="large" onClose={() => setOld(undefined)}><div className="historyTranscript"><BotTranscript hasConversation running={false} onSuggestion={() => undefined} lines={[line('old-u', 'user-message', '检查贪吃蛇的预览状态。'), line('old-a', 'text', '这是此前单独执行的历史示例。查看这条记录不会更改当前 Bot 对话或草稿。')]} /></div></Dialog> : null}
    {fresh ? <ConfirmationDialog title="开始新的上下文" question="模型将不再沿用当前对话的上下文。" hint="旧记录继续保留。后续消息会清楚标出新的上下文开始位置。" confirmLabel="开始新的上下文" cancelLabel="继续当前对话" onCancel={() => setFresh(false)} onConfirm={onFresh} /> : null}
  </Dialog>;
}
