import type { StaticGlassVariables } from '../../staticGlassCapsule';

export type DrawingFramePresentation = {
  active: boolean;
  saving: boolean;
  langCode: string;
  autoFocus?: boolean;
  editorBackground?: string;
  theme?: 'light' | 'dark';
  staticGlass?: StaticGlassVariables;
};
export type DrawingFrameOptions = DrawingFramePresentation & {
  content: string | null;
  platform?: string;
  onReady: () => void;
  onDirty: () => void;
  onError: (message: string) => void;
  onSave: () => void;
  onWorkspaceShortcut: (index: number) => void;
};

// Same-origin renderer-only interface. File access stays in the parent editor and
// the Workspace store; this page receives drawing data and UI callbacks only.
export interface DrawingFrameController {
  initialize(options: DrawingFrameOptions): Promise<void>;
  present(presentation: DrawingFramePresentation): void;
  serialize(commitText?: boolean): string;
  focus(): void;
}

declare global { interface Window { hulalaDrawingFrame?: DrawingFrameController; } }
