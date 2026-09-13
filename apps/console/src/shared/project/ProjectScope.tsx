import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

export interface ProjectScope {
  readonly projectId: string;
  readonly space: 'workbench' | 'admin';
}

const Context = createContext<ProjectScope | null>(null);

/** 项目页面由 app 装配上下文，业务 feature 不依赖某一棵父路由。 */
export function ProjectScopeProvider({ value, children }: { readonly value: ProjectScope; readonly children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useProjectScope(): ProjectScope {
  const scope = useContext(Context);
  if (!scope) throw new Error('Project page requires ProjectScopeProvider');
  return scope;
}
