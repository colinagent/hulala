import {
  getRenderUrlForReference,
  resolveResourceTargetFromRef,
} from '../../../../services/resourceService';
import { trackPdfExportTask } from '../../../../services/pdfExportReadiness';
import { resourceTargetKey } from '../../../../core/resource/uri';

const resolvedRenderUrlCache = new Map<string, string>();
const pendingRenderUrlCache = new Map<string, Promise<string>>();

function renderCacheKey(documentPath: string | null | undefined, rawRef: string, workspaceViewId?: string): string {
  const trimmedRef = (rawRef || '').trim();
  try {
    return resourceTargetKey(resolveResourceTargetFromRef(documentPath || null, trimmedRef, workspaceViewId));
  } catch {
    return JSON.stringify(['reference', documentPath || '', trimmedRef]);
  }
}

export function peekRenderUrlForReference(documentPath: string | null | undefined, rawRef: string, workspaceViewId?: string): string | null {
  const cached = resolvedRenderUrlCache.get(renderCacheKey(documentPath, rawRef, workspaceViewId));
  return cached ?? null;
}

export function loadRenderUrlForReference(documentPath: string | null | undefined, rawRef: string, workspaceViewId?: string): Promise<string> {
  const key = renderCacheKey(documentPath, rawRef, workspaceViewId);
  const pending = pendingRenderUrlCache.get(key);
  if (pending) {
    return pending;
  }

  const request = trackPdfExportTask(getRenderUrlForReference(documentPath || null, rawRef, workspaceViewId))
    .then((url) => {
      resolvedRenderUrlCache.set(key, url);
      return url;
    })
    .finally(() => {
      pendingRenderUrlCache.delete(key);
    });

  pendingRenderUrlCache.set(key, request);
  return request;
}
