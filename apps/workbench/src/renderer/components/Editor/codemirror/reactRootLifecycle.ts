import type { Root } from 'react-dom/client';

export function deferReactRootUnmount(root: Root | null): void {
  if (!root) {
    return;
  }

  // CodeMirror plugins are destroyed from the parent MarkdownEditor cleanup.
  // Defer nested-root teardown until that React commit has finished.
  globalThis.setTimeout(() => root.unmount(), 0);
}
