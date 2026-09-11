export interface ScratchDir {
  readonly path: string;
  remove(): Promise<void>;
}

/** 建仓时的临时工作目录；用完即删。 */
export interface ScratchDirs {
  create(prefix: string): Promise<ScratchDir>;
}
