import type { FileEntry } from '@crewstation/contracts';
import type { ReactElement } from 'react';
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
  return (
    <li>
      <button
        type="button"
        className={[styles.node, path === openPath ? styles.active : ''].filter(Boolean).join(' ')}
        style={{ paddingLeft: `calc(var(--cs-space-2) + ${depth} * var(--cs-space-3))` }}
        onClick={activate}
        disabled={!isDir && props.disabled}
      >
        <span className={styles.marker} aria-hidden="true">
          {isDir ? (expanded ? '▾' : '▸') : '·'}
        </span>
        <span className={styles.name}>{entry.name}</span>
      </button>
      {isDir && expanded ? <Nodes {...props} dir={path} depth={depth + 1} /> : null}
    </li>
  );
}

function Nodes(props: NodesProps): ReactElement {
  const entries = props.tree.entriesByDir[props.dir] ?? [];
  return (
    <ul className={styles.list}>
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
