export type FileTreeContext =
  | {
      kind: 'blank';
      dir: string;
      depthForCreate: number;
    }
  | {
      kind: 'entry';
      path: string;
      isDir: boolean;
      isPackage?: boolean;
      parentDir: string;
      depth: number;
      depthForCreate: number;
    };

export type ContextMenuState = {
  open: boolean;
  x: number;
  y: number;
  ctx: FileTreeContext | null;
};

export type InlineCreateState = {
  dir: string;
  kind: 'file' | 'folder';
  depth: number;
  value: string;
  error?: string;
};
