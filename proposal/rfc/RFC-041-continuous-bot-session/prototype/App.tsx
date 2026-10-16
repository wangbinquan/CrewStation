import { useEffect, useState } from 'react';
import { Brand } from '../../../../apps/console/src/shared/ui/Brand';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { Badge } from '../../../../apps/console/src/shared/ui/Badge';
import { Segmented } from '../../../../apps/console/src/shared/ui/Segmented';
import { ConfirmationDialog } from '../../../../apps/console/src/shared/ui/dialog/ConfirmationDialog';
import { BotTranscript } from '../../../../apps/console/src/features/dev-session/components/bot/BotTranscript';
import { BotComposer } from '../../../../apps/console/src/features/dev-session/components/bot/BotComposer';
import { HistoryDialog } from './HistoryDialog';
import { Preview } from './Preview';
import { line, readDemo, saveDemo } from './fixture';
import type { DemoStatus } from './fixture';

export function App() {
  const [state, setState] = useState(readDemo), [mode, setMode] = useState('bot'), [pane, setPane] = useState('chat');
  const [history, setHistory] = useState(false), [fresh, setFresh] = useState(false);
  useEffect(() => saveDemo(state), [state]);
  const running = state.status === 'running';
  const edit = (draft: string) => setState(s => ({ ...s, draft }));
  const send = () => setState(s => !s.draft.trim() || s.status === 'missing' || s.status === 'running' ? s : ({ ...s, draft: '', status: 'running', executions: s.executions + (s.status === 'interrupted' ? 1 : 0), lines: [...s.lines, line(crypto.randomUUID(), 'user-message', s.draft)] }));
  const finish = () => setState(s => ({ ...s, status: 'ready', lines: [...s.lines, line(crypto.randomUUID(), 'text', '已按你的补充继续调整。\n\n这是原型的模拟回答：当前仍是同一条 Bot 对话，停止本轮、切换界面都不会清空此前上下文。')] }));
  const freshContext = () => { setState(s => ({ ...s, epoch: s.epoch + 1, status: 'ready', executions: s.executions + 1, lines: [...s.lines, line(crypto.randomUUID(), 'status', '新的上下文从这里开始。此前记录保留，模型不再沿用旧上下文。')] })); setHistory(false); setFresh(false); };
  const scene = (status: DemoStatus) => setState(s => ({ ...s, status }));
  const names = { ready: '等待你的下一步', running: '正在执行', interrupted: '已停止本轮', missing: '上下文不可恢复' };
  return <div className="prototypeShell">
    <header className="brandHeader"><Brand /><nav>应用<span>项目开发</span>平台管理</nav><Badge tone="warning">RFC-041 · 交互原型</Badge></header>
    <aside className="projectNav"><small>← 项目开发</small><strong>贪吃蛇</strong><span>snake-bot-20261014</span><p>概览</p><p className="navActive">开发</p><p>发布与上线</p><p>运行与管理 ›</p></aside>
    <main className="prototypeMain"><header className="developmentHeader"><h1>开发会话</h1><Segmented label="开发方式" value={mode} onChange={setMode} items={[{value:'cli',label:'CLI'},{value:'bot',label:'Bot 聊天'}]} /><span className="branch">main</span></header>
      <div className="mobilePane"><Segmented label="工作区面板" value={pane} onChange={setPane} items={[{value:'chat',label:'对话'},{value:'preview',label:'预览'}]} /></div>
      <div className="developmentGrid" data-pane={pane}>
        <section className="chatPanel" aria-label={mode === 'bot' ? '持续 Bot 对话' : 'CLI 独立会话'}>
          <div hidden={mode !== 'bot'} className="botPanel"><header className="botHeader"><div className="botIdentity"><span className="botMark">✦</span><div><strong>Crew Bot</strong><small>贪吃蛇 · 持续开发</small></div></div><Badge tone={state.status === 'missing' ? 'warning' : running ? 'info' : 'success'}>{names[state.status]}</Badge><Button size="small" variant="ghost" onClick={() => setHistory(true)}>历史与设置</Button></header>
            <BotTranscript lines={state.lines} running={running} hasConversation onSuggestion={edit} />
            {state.epoch > 1 ? <div className="continuityNotice" role="status"><strong>当前使用新的上下文</strong><span>此前记录保留供查看，模型不会自动继承旧上下文。</span></div> : null}
            {state.status === 'interrupted' ? <div className="continuityNotice" role="status"><strong>本轮已停止，上下文已保留</strong><span>继续输入即可接着聊。已完成的操作不会自动撤销或重做。</span></div> : null}
            {state.status === 'missing' ? <div className="continuityNotice unavailableNotice" role="alert"><strong>历史记录还在，但原上下文不可恢复</strong><span>这次执行的原生会话文件未保存，无法无损接续。</span><Button size="small" onClick={() => setFresh(true)}>以新上下文继续</Button></div> : null}
            <BotComposer disabled={state.status === 'missing' || running} sending={false} draft={state.draft} onDraftChange={edit} onSend={send} compute="OpenCode" canCancel={running} onCancel={() => scene('interrupted')} />
          </div>
          <div hidden={mode !== 'cli'} className="cliPanel"><header>OpenCode · CLI 独立会话<Badge>示意</Badge></header><pre>{'~/snake-bot  main\n\nCLI 会话保持独立。\n切换到 Bot 不会提交命令或改变这里的上下文。\n\n❯ '}</pre><p>此原型不启动终端、不执行命令。</p></div>
        </section><Preview />
      </div>
    </main>
    <footer className="reviewBar"><span>本地模拟 · 未部署 · 不发送模型请求</span><div><Button size="small" onClick={() => scene('running')}>模拟执行中</Button><Button size="small" onClick={() => scene('interrupted')}>模拟中断</Button><Button size="small" onClick={() => scene('missing')}>模拟上下文缺失</Button>{running ? <Button size="small" onClick={finish}>模拟完成本轮</Button> : <Button size="small" onClick={() => scene('ready')}>正常状态</Button>}</div></footer>
    {history ? <HistoryDialog state={state} onClose={() => setHistory(false)} onFresh={freshContext} /> : null}
    {fresh ? <ConfirmationDialog title="以新上下文继续" question="接下来的消息将使用新的模型上下文。" hint="此前记录保留，但不能据此恢复模型未保存的内部上下文。" confirmLabel="以新上下文继续" cancelLabel="保留当前记录" onCancel={() => setFresh(false)} onConfirm={freshContext} /> : null}
  </div>;
}
