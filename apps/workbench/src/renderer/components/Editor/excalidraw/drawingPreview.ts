import type { DrawingFileAccess } from './drawingDocument';
import { readDrawingFile } from './drawingDocument';
import { renderDrawingSvg } from './drawingRuntime';

type Preview = { svg: string | null; missing: boolean };
type PreviewAccess = DrawingFileAccess & {
  documents?: ReadonlyArray<{ filePath?: string; content: string }>;
};
type Scope = { cache: Map<string, { content: string | null; preview: Promise<Preview> }>; events: EventTarget };
const scopes = new WeakMap<object, Scope>();

function getScope(owner: object): Scope {
  let scope = scopes.get(owner);
  if (!scope) {
    scope = { cache: new Map(), events: new EventTarget() };
    scopes.set(owner, scope);
  }
  return scope;
}

export async function loadDrawingPreview(owner: object, access: PreviewAccess, path: string): Promise<Preview> {
  const { cache } = getScope(owner);
  // The user can return to Markdown before the drawing tab finishes autosaving.
  const document = access.documents?.find((item) => item.filePath === path);
  const content = document ? document.content : await readDrawingFile(access, path);
  const cached = cache.get(path);
  if (cached?.content === content) return cached.preview;
  const request = Promise.resolve().then(async () => ({
    missing: content === null,
    svg: content === null ? null : await renderDrawingSvg(content),
  })).catch((error) => {
    if (cache.get(path)?.preview === request) cache.delete(path);
    throw error;
  });
  cache.set(path, { content, preview: request });
  if (cache.size > 32) cache.delete(cache.keys().next().value!);
  return request;
}

export function invalidateDrawingPreview(owner: object, path: string): void {
  const scope = getScope(owner);
  scope.cache.delete(path);
  scope.events.dispatchEvent(new CustomEvent('changed', { detail: path }));
}

export function subscribeDrawingPreview(owner: object, path: string, callback: () => void): () => void {
  const events = getScope(owner).events;
  const listener = (event: Event) => { if ((event as CustomEvent<string>).detail === path) callback(); };
  events.addEventListener('changed', listener);
  return () => events.removeEventListener('changed', listener);
}
