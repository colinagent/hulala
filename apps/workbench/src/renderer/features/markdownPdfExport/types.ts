export type MarkdownPdfExportRemoteSession = {
  hostLabel: string;
  workspaceDir: string;
  instanceId: string;
  runtimeVersion: string;
  platform: string;
  arch: string;
};

export type MarkdownPdfExportPayload = {
  title: string;
  content: string;
  sourcePath?: string;
  currentDir?: string;
  remoteSession?: MarkdownPdfExportRemoteSession | null;
  baseDir?: string;
  workspaceRootDir?: string;
  instanceID?: string;
};
