import type { FileEntry } from '@crewstation/contracts';
import type { CSSProperties, ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import type { WorkspaceTree } from '../../hooks/useWorkspaceTree';
import { WORKSPACE_ROOT, isEditable, joinPath } from '../../model/workspacePath';
import styles from './FileTree.module.css';

interface NodesProps {
  readonly tree: WorkspaceTree;
  readonly dir: string;
  readonly depth: number;
  readonly openPath: string | undefined;
  readonly onOpen: (path: string) => void;
  readonly disabled?: boolean;
}

function Node({ entry, path, props }: { readonly entry: FileEntry; readonly path: string; readonly props: NodesProps }): ReactElement {
  const { tree, depth, openPath, onOpen } = props;
  const isDir = entry.kind === 'dir';
  const expanded = tree.expanded.has(path);
  const activate = (): void => {
    if (isDir) tree.toggle(path);
    else if (isEditable(entry)) onOpen(path);
  };
  // 缩进线由每层 <ul> 自己画（见 .list），这里只按层数给左内边距。
  return (
    <li>
      <button
        type="button"
        className={[styles.node, isDir ? styles.dir : '', path === openPath ? styles.active : '', entry.name.startsWith('.') ? styles.hidden : ''].filter(Boolean).join(' ')}
        style={{ paddingLeft: `calc(var(--cs-space-2) + ${depth} * 16px)` }}
        onClick={activate}
        disabled={!isDir && props.disabled}
        title={path}
        aria-expanded={isDir ? expanded : undefined}
      >
        <span className={[styles.chevron, expanded ? styles.open : ''].filter(Boolean).join(' ')} aria-hidden="true">{isDir ? <ChevronIcon /> : null}</span>
        <span className={styles.icon} aria-hidden="true">{isDir ? <FolderIcon open={expanded} /> : <FileIcon />}</span>
        <span className={styles.name}>{entry.name}</span>
      </button>
      {isDir && expanded ? <Nodes {...props} dir={path} depth={depth + 1} /> : null}
    </li>
  );
}

function ChevronIcon(): ReactElement {
  return <svg viewBox="0 0 16 16" width="12" height="12"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function FolderIcon({ open }: { readonly open: boolean }): ReactElement {
  return <svg viewBox="0 0 16 16" width="16" height="16">{open
    ? <path d="M1.5 4.5v8h11l2-5.5H4l-2 5.5M1.5 4.5V3h4l1.5 1.5h6V7" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    : <path d="M1.5 3h4l1.5 1.5h7.5v8h-13z" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />}</svg>;
}

function FileIcon(): ReactElement {
  return <svg viewBox="0 0 16 16" width="16" height="16"><path d="M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>;
}

function Nodes(props: NodesProps): ReactElement {
  const entries = props.tree.entriesByDir[props.dir] ?? [];
  return (
    <ul className={styles.list} style={{ '--tree-guide': `calc(var(--cs-space-2) + ${props.depth - 1} * 16px + 8px)` } as CSSProperties} data-root={props.depth === 0 ? '' : undefined}>
      {entries.map((entry) => (
        <Node key={entry.name} entry={entry} path={joinPath(props.dir, entry.name)} props={props} />
      ))}
    </ul>
  );
}

/** 工作目录文件树：目录按需展开，点文件在右侧打开。 */
export function FileTree({ tree, openPath, onOpen, disabled }: Omit<NodesProps, 'dir' | 'depth'>): ReactElement {
  const t = useT();
  return (
    <nav className={styles.tree} aria-label={t('devSession.editor.treeLabel')}>
      <Nodes tree={tree} dir={WORKSPACE_ROOT} depth={0} openPath={openPath} onOpen={onOpen} disabled={disabled} />
    </nav>
  );
}
