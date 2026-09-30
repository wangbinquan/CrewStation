import { useState } from 'react';
import { Dialog } from '../../../../apps/console/src/shared/ui/dialog/Dialog';
import { ConfirmDialog } from '../../../../apps/console/src/shared/ui/dialog/ConfirmDialog';
import { ActionNote } from '../../../../apps/console/src/shared/ui/ActionNote';
import { ActionRow } from '../../../../apps/console/src/shared/ui/ActionRow';
import { Button } from '../../../../apps/console/src/shared/ui/Button';
import { Badge } from '../../../../apps/console/src/shared/ui/Badge';
import { DELETION_ITEMS } from './model';

export function DeletionDialog({ name, slug, onClose }: { name: string; slug: string; onClose(): void }) {
  const [confirm, setConfirm] = useState(false), [accepted, setAccepted] = useState(false);
  return <>
    <Dialog title="删除项目前确认" size="medium" onClose={onClose} footer={<ActionRow><Button variant="danger" disabled={accepted} onClick={() => setConfirm(true)}>继续删除…</Button><Button variant="ghost" onClick={onClose}>取消</Button></ActionRow>}>
      <div className="deletion-target"><div><strong>{name}</strong><code>{slug}</code></div><Badge tone="danger">不可恢复</Badge></div>
      <p className="dialog-intro">永久删除会停止项目，并清理源码、业务数据与所有项目独占资源。</p>
      <div className="deletion-items">{DELETION_ITEMS.map(([title, text, count]) => <div key={title}><strong>{title}</strong><p>{text}</p><small>{count}</small></div>)}</div>
      <ActionNote tone="neutral">平台共享的算力、存储后端和其他项目保留。资源实际清完后，才会显示删除完成。</ActionNote>
      {accepted ? <ActionNote tone="success">二次确认已通过（演示）。没有删除任何真实项目。</ActionNote> : null}
    </Dialog>
    {confirm ? <ConfirmDialog title="永久删除项目" question={`确认永久删除“${name}”（${slug}）？`} confirmWord="delete" confirmLabel="永久删除项目" onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); setAccepted(true); }}>
      <p>源码仓库、开发与生产数据库、对象文件、未推送代码和任务工作盘都将被清理。</p>
      <p>受理后无法撤销；清理失败时只能继续，无法恢复项目。</p>
    </ConfirmDialog> : null}
  </>;
}
