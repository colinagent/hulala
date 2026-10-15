import type { EditorView, Panel } from '@codemirror/view';

/**
 * CodeMirror 的搜索高亮插件只有在 search panel 打开(panel=true)时才会画 .cm-searchMatch。
 * UI 由 React 的 EditorSearchOverlay 渲染,这里仅提供一个不可见的 CM panel
 * 来激活内置 search highlighter,不占布局、不抢焦点。
 */
export function createHiddenSearchPanel(_view: EditorView): Panel {
  const dom = document.createElement('div');
  dom.className = 'cm-op-hidden-search-panel';
  dom.setAttribute('aria-hidden', 'true');
  dom.style.display = 'none';
  return { dom, top: true };
}
