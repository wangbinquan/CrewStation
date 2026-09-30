import { useRef, useState } from 'react';
import { INITIAL_ENTRIES, INITIAL_REQUESTS } from './fixtures';
import { changesFor, changeSummary } from './fields';
import type { Draft, Entry, ResourceRequest, ViewRole } from './model';
import { pendingFor } from './model';

function applyRequest(entry: Entry, request: ResourceRequest): Entry {
  if (request.target === 'service-large' && entry.id === 'service-policy') return { ...entry, source: '默认继承 + 项目授权', settings: { ...entry.settings, scope: '继承平台默认 + 高内存服务规格' } };
  if (request.target === 'service-policy' && entry.id === 'service-large') {
    const owned = request.changes?.some((c) => c.key === 'scope' && String(c.after).includes(' + '));
    return { ...entry, access: owned ? 'owned' : 'requestable', source: owned ? '项目显式授权' : '平台明确开放申请', state: 'idle', stateText: owned ? '已授权 · 未使用' : '尚未授权' };
  }
  if (request.target === 'finance-api' && entry.id === 'application') return { ...entry, metrics: [['接口', '2 个已授权'], ...entry.metrics.slice(1)] };
  if (entry.id !== request.target) return entry;
  if (request.type === 'grant') return { ...entry, access: 'owned', source: '项目显式授权', stateText: '已授权 · 未使用', state: 'idle' };
  const settings = { ...entry.settings, ...Object.fromEntries((request.approvedChanges ?? request.changes ?? []).map((c) => [c.key, c.after])) };
  const quantity = request.approvedQuantity ?? request.quantity;
  return { ...entry, source: settings.scope === '继承平台默认' ? '继承平台默认' : '项目显式配置', settings,
    ...(entry.quota && quantity !== undefined ? { quota: { ...entry.quota, limit: quantity } } : {}),
    ...(entry.id === 'execution-quota' && quantity !== undefined ? { stateText: quantity < 5 ? '超配 · 暂停新增' : `余量 ${quantity - 5}` } : {}),
  };
}
export function useWorkspace() {
  const generation = useRef(0);
  const [role, setRole] = useState<ViewRole>('owner');
  const [entries, setEntries] = useState(INITIAL_ENTRIES);
  const [requests, setRequests] = useState(INITIAL_REQUESTS);
  const [scenario, setScenario] = useState('normal');
  const [message, setMessage] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selected, setSelected] = useState<string>();
  const [changing, setChanging] = useState<string>();
  const [requestId, setRequestId] = useState<string>();
  const [catalog, setCatalog] = useState<'grant' | 'quota'>();
  const updateRequest = (id: string, patch: Partial<ResourceRequest>) => setRequests((all) => all.map((r) => r.id === id ? { ...r, ...patch } : r));
  const apply = (request: ResourceRequest) => {
    const epoch = generation.current;
    updateRequest(request.id, { state: 'applying' });
    setMessage(`${request.title}：等待所属能力确认生效。`);
    window.setTimeout(() => {
      if (epoch !== generation.current) return;
      if (scenario === 'failure') {
        updateRequest(request.id, { state: 'apply-failed', decision: '授权已记录，资源适配器暂不可用。可以在原页重试，旧值仍然有效。' });
        setMessage('模拟生效失败：当前配额保持原值，可在申请详情重试。');
      } else {
        setEntries((all) => all.map((entry) => applyRequest(entry, request)));
        updateRequest(request.id, { state: 'applied' });
        setMessage(`${request.title}已生效；已有运行实例保持原状。`);
      }
    }, 1800);
  };
  const submit = (entry: Entry, draft: Draft) => {
    if (role === 'developer' || pendingFor(requests, entry.id)) return;
    const grant = entry.access === 'requestable', changes = changesFor(entry, draft);
    const request: ResourceRequest = { id: `RQ-${1043 + requests.length - INITIAL_REQUESTS.length}`, target: entry.id, type: grant ? 'grant' : 'quota', state: 'pending',
      title: `${grant ? role === 'admin' ? '分配' : '申请' : '调整'}${entry.title}`, before: grant ? '未授权' : changeSummary(changes, 'before'), after: grant ? '允许本项目使用' : changeSummary(changes, 'after'),
      quantity: typeof draft.values.limit === 'number' ? draft.values.limit : undefined, changes, reason: draft.reason,
      requester: role === 'admin' ? '李悦 · 平台管理员' : '张明 · 项目负责人', createdAt: '刚刚', direct: role === 'admin',
      ...(role === 'admin' ? { decision: '管理员直接管理，已记录变更理由。' } : {}),
    };
    setRequests((all) => [request, ...all]);
    setChanging(undefined); setCatalog(undefined);
    setDrafts((all) => { const copy = { ...all }; delete copy[entry.id]; return copy; });
    if (role === 'admin') apply(request); else setMessage('申请已提交给平台管理员。当前授权和配额继续有效。');
  };
  const decide = (request: ResourceRequest, action: 'approve' | 'reject' | 'cancel' | 'retry', reason: string, approved?: Partial<ResourceRequest>) => {
    if (action !== 'cancel' && role !== 'admin') return;
    if (action === 'cancel' && role !== 'owner') return;
    if (action === 'reject' || action === 'cancel') {
      updateRequest(request.id, { state: action === 'reject' ? 'rejected' : 'cancelled', decision: reason });
      setMessage(action === 'reject' ? '申请已驳回，已保留审批意见。' : '申请已撤回，当前资源不变。');
    } else if (scenario === 'conflict' && action === 'approve') {
      updateRequest(request.id, { state: 'needs-review', decision: '审批期间有效配置发生变化。请重新核对最新配额，原申请未应用。' });
      setMessage('检测到配置版本变化：本次审批未覆盖当前配置。');
    } else { updateRequest(request.id, { ...approved, decision: reason || '管理员批准。' }); apply({ ...request, ...approved }); }
  };
  const reset = () => { generation.current += 1; setEntries(INITIAL_ENTRIES); setRequests(INITIAL_REQUESTS); setDrafts({}); setScenario('normal'); setMessage('已恢复原型示例。'); };
  return { role, setRole, entries, requests, scenario, setScenario, message, setMessage, drafts, setDrafts, selected, setSelected, changing, setChanging, requestId, setRequestId, catalog, setCatalog, submit, decide, reset };
}
export type Workspace = ReturnType<typeof useWorkspace>;
