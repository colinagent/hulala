import { parseDrawingDocument } from './drawingDocument';

let runtime: Promise<typeof import('@excalidraw/excalidraw')> | undefined;
declare global { interface Window { EXCALIDRAW_ASSET_PATH?: string; } }

export function loadDrawingRuntime() {
  // Resolved relative to index.html in both the Vite server and packaged Electron.
  window.EXCALIDRAW_ASSET_PATH = new URL('/excalidraw/', window.location.origin).href;
  return runtime ??= import('@excalidraw/excalidraw').catch((error) => {
    runtime = undefined;
    throw error;
  });
}

export async function restoreDrawing(content: string) {
  const sdk = await loadDrawingRuntime();
  parseDrawingDocument(content);
  return sdk.loadFromBlob(new Blob([content], { type: 'application/vnd.excalidraw+json' }), null, null);
}

export async function renderDrawingSvg(content: string): Promise<string | null> {
  const sdk = await loadDrawingRuntime();
  const scene = await restoreDrawing(content);
  const elements = scene.elements.filter((element) => !element.isDeleted);
  if (!elements.length) return null;
  const svg = await sdk.exportToSvg({
    elements,
    appState: { ...scene.appState, exportBackground: true, exportWithDarkMode: false },
    files: scene.files,
    exportPadding: 24,
  });
  return new XMLSerializer().serializeToString(svg);
}
