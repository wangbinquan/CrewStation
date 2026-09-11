export type UnitKind = 'app' | 'module' | 'package' | 'runtime' | 'tool';

export interface PackageJson {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  exports?: unknown;
  crewstation?: { layer?: number };
}

export interface Unit {
  name: string;
  shortName: string;
  kind: UnitKind;
  dir: string;
  relDir: string;
  layer: number | undefined;
  pkg: PackageJson;
  files: SourceFile[];
}

export type LayerDir =
  | 'api' | 'domain' | 'application' | 'ports' | 'adapters' | 'http' | 'workers' | 'tests'
  | 'wiring' | 'index' | 'other';

export interface SourceFile {
  path: string;
  rel: string;
  unit: Unit;
  lines: number;
  isTest: boolean;
  isGenerated: boolean;
  layerDir: LayerDir;
  imports: ImportRef[];
}

export type ImportKind = 'relative' | 'workspace' | 'npm' | 'builtin';

export interface ImportRef {
  spec: string;
  line: number;
  kind: ImportKind;
  targetFile?: SourceFile;
  targetUnit?: Unit;
  subpath?: string;
  npmName?: string;
}

export interface Violation {
  rule: string;
  file: string;
  message: string;
}

export interface Workspace {
  root: string;
  units: Unit[];
  files: SourceFile[];
  byPath: Map<string, SourceFile>;
}

export type Rule = (ws: Workspace) => Violation[];
