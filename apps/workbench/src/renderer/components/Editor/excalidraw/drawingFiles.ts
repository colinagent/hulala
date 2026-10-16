import { readDrawingFile, saveDrawingFile, type DrawingFileAccess } from './drawingDocument';

const EMPTY_DRAWING = JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} });

export async function createDrawingFile(access: DrawingFileAccess, path: string): Promise<void> {
  await saveDrawingFile(access, path, null, EMPTY_DRAWING);
}

export async function openDrawingFile(access: DrawingFileAccess & {
  openFile(path: string, options: { focusEditor: boolean }): Promise<void>;
}, path: string): Promise<void> {
  if (await readDrawingFile(access, path) === null) await createDrawingFile(access, path);
  await access.openFile(path, { focusEditor: true });
}
